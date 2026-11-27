import { useHistoryInputSchema, type UseHistory } from '../src/shared/trash';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppStore } from './store';
import { LibraryStore } from './library-store';
import { UserInputError } from './errors';
import { transaction } from './migrations';
import { cardSchema, idSchema } from '../src/shared/contracts';
import { templateDraftSchema, resourceDefinitionSchema, overrideSchema, resourceInteger, previewRequestSchema, resourceRequestSchema,
  type ResourceSnapshot, type ResourceTemplate, type ResourceView, type ResourceEvent, type ResourceChange,
  type ResourceOverrides, type ResourcePlan, type ResourcePreview, type ResourceResult, type TemplateDraft } from '../src/shared/resources';
import { ClassStore, type ClassUndo } from './class-store';
import { classInputSchema } from '../src/shared/class-contracts';
import type { ClassInput } from '../src/shared/class-contracts';
import { ResourceError, maximums, assertResource, planUse, planRecovery, planAdjustment, applyChanges, type CapacityProfile } from '../src/shared/resource-engine';
import { resolveCastOption, resolveCostResource } from '../src/shared/casting';

interface TemplateRow { id: string; key: string; name: string; kind: 'counter'|'slot_track'; source: 'class_2014'|'user'; version: number; definition_json: string }
interface InstanceRow { id: string; character_id: string; template_id: string; overrides_json: string; current_state_json: string; preset_key?: string | null; definition_id?: string; owner_card_name?: string | null; active?: number; retired?: number }
interface EventRow { id: string; character_id: string; event_type: string; payload_json: string; occurred_at: string }
const stateSchema = z.union([z.strictObject({ remaining: resourceInteger }),z.strictObject({ remainingByLevel: z.record(z.string().regex(/^[1-9]$/), resourceInteger) })]);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');

export class ResourceStore {
  readonly db; readonly library;
  constructor(store: AppStore) { this.db = store.db; this.library = new LibraryStore(store); }
  private classes() { return new ClassStore(this.db,id=>this.snapshot(id)); }
  previewClass(input:unknown) { try{const value=z.strictObject({characterId:idSchema,configuration:classInputSchema}).parse(input); return this.classes().preview(value.characterId,value.configuration);}catch(error){if(error instanceof ResourceError)throw new UserInputError(error.message);throw error;} }
  private profile(id: string): CapacityProfile {
    const row = this.db.prepare('SELECT level,ability_scores_json FROM character_profiles WHERE id=? AND id NOT IN (SELECT profile_id FROM profile_trash)').get(id) as { level: number; ability_scores_json: string | null } | undefined;
    if (!row) throw new UserInputError('먼저 캐릭터를 선택해 주세요.');
    return { level: row.level, abilityScores: row.ability_scores_json ? JSON.parse(row.ability_scores_json) : undefined };
  }
  private template(row: TemplateRow): ResourceTemplate {
    const raw = JSON.parse(row.definition_json);
    const draft = templateDraftSchema.parse({ id: row.id, name: row.name, kind: row.kind, unit: raw.unit ?? '점', unlimited:raw.unlimited, matchKey:raw.matchKey, slotKind:raw.slotKind, capacity: raw.capacity, slotCapacity: raw.slotCapacity, slotCapacityByClassLevel: raw.slotCapacityByClassLevel, recovery: raw.recovery ?? [] });
    return { ...draft, id: row.id, key: row.key, source: row.source, version: row.version,
      ...(raw.definitionOnly === true ? {definitionOnly:true} : {}) };
  }
  private getTemplate(id: string): ResourceTemplate {
    const row = this.db.prepare('SELECT * FROM resource_templates WHERE id=?').get(id) as unknown as TemplateRow | undefined;
    if (!row) throw new UserInputError('자원 템플릿을 찾을 수 없습니다.'); return this.template(row);
  }
  private readInstance(row: InstanceRow, profile: CapacityProfile): ResourceView {
    const template = this.getTemplate(row.template_id); const overrides = overrideSchema.parse(JSON.parse(row.overrides_json));
    const state = stateSchema.parse(JSON.parse(row.current_state_json));
    const view: ResourceView = { id: row.id, characterId: row.character_id, templateId: row.template_id, presetKey:row.preset_key??undefined, unlimited:overrides.unlimitedOverride??template.unlimited, name: overrides.nameOverride ?? template.name, unit: template.unit, kind: template.kind, template, overrides, ...(row.definition_id ? { ownedDefinitionId: row.definition_id, ownerCardName: row.owner_card_name ?? undefined, inactive: !row.active, retired: !!row.retired } : {}), ...maximums(template, profile, overrides), ...state };
    if ((view.kind === 'counter') !== ('remaining' in state)) throw new ResourceError('자원 종류와 현재 상태가 일치하지 않습니다.');
    assertResource(view); return view;
  }
  private readEvent(row: EventRow): ResourceEvent {
    const raw = JSON.parse(row.payload_json);
    return { id: row.id, characterId: row.character_id, type: row.event_type, timestamp: row.occurred_at,
      label: typeof raw.label === 'string' ? raw.label : '이전 버전 기록', changes: Array.isArray(raw.changes) ? raw.changes : [],
      reversible: raw.engineVersion === 1 && raw.reversible === true, barrier: raw.engineVersion !== 1 || raw.barrier === true,
      classUndo:raw.classUndo, costSnapshot:raw.costSnapshot, selectedSlotLevels:raw.selectedSlotLevels, castingLevel:raw.castingLevel, engineVersion: raw.engineVersion, cardId: raw.cardId, castOptionId: raw.castOptionId, undoesEventId: raw.undoesEventId, override: raw.override };
  }
  history(input:unknown):UseHistory {
    const {characterId,beforeRow}=useHistoryInputSchema.parse(input);this.profile(characterId);
    const rows=this.db.prepare("SELECT rowid AS history_row,* FROM play_events WHERE character_id=? AND event_type='card_used' AND rowid<? ORDER BY rowid DESC LIMIT 51").all(characterId,beforeRow??Number.MAX_SAFE_INTEGER) as unknown as (EventRow & {history_row:number})[];
    return {events:rows.slice(0,50).map(row=>this.readEvent(row)),nextRow:rows.length>50?rows[49].history_row:undefined};
  }
  private undoTarget(characterId: string): ResourceEvent | undefined {
    const rows = this.db.prepare(`SELECT p.* FROM play_events p LEFT JOIN resource_undos u ON u.target_event_id=p.id
      WHERE p.character_id=? AND u.target_event_id IS NULL ORDER BY p.rowid DESC`).iterate(characterId);
    for (const row of rows) {
      const event = this.readEvent(row as unknown as EventRow);
      if (event.type === 'undo') continue;
      if (event.barrier) return;
      if (event.reversible && (event.changes.length || event.classUndo)) return event;
    }
  }
  snapshot(input: unknown): ResourceSnapshot {
    const characterId = idSchema.parse(input); const profile = this.profile(characterId); const warnings: string[] = [];
    const templates: ResourceTemplate[] = [];
    for (const row of this.db.prepare("SELECT * FROM resource_templates WHERE archived_at IS NULL AND key NOT LIKE 'card-owned:%' AND (source='user' OR id IN (SELECT template_id FROM resource_instances WHERE character_id=? AND archived_at IS NULL)) ORDER BY rowid").all(characterId) as unknown as TemplateRow[]) {
      try { templates.push(this.template(row)); } catch { warnings.push(`“${row.name}” 템플릿 설정이 불완전합니다. 기존 데이터는 보존했습니다.`); }
    }
    const resources: ResourceView[] = [];
    for (const row of this.db.prepare(`SELECT i.*, m.definition_id, owner.name AS owner_card_name,
      CASE WHEN m.instance_id IS NOT NULL AND def.definition_id IS NULL THEN 1 ELSE 0 END AS retired,
      EXISTS(SELECT 1 FROM deck_cards dc JOIN character_profiles p ON p.id=i.character_id
        JOIN card_definitions c ON c.id=dc.card_id
        WHERE dc.deck_id=p.active_deck_id AND dc.card_id=m.card_id AND c.archived_at IS NULL AND def.definition_id IS NOT NULL) AS active
      FROM resource_instances i LEFT JOIN card_owned_resources m ON m.instance_id=i.id
      LEFT JOIN card_definitions owner ON owner.id=m.card_id
      LEFT JOIN card_owned_definitions def ON def.card_id=m.card_id AND def.definition_id=m.definition_id
      WHERE i.character_id=? AND i.archived_at IS NULL ORDER BY i.rowid`).all(characterId) as unknown as InstanceRow[]) {
      try { resources.push(this.readInstance(row, profile)); } catch { warnings.push(`자원 ${row.id}의 설정/현재량을 확인해 주세요. 초기화하지 않았습니다.`); }
    }
    const revision = (this.db.prepare('SELECT revision FROM resource_revisions WHERE character_id=?').get(characterId) as { revision: number } | undefined)?.revision ?? 0;
    const bindings = (this.db.prepare('SELECT * FROM card_bindings WHERE character_id=?').all(characterId) as { id: string; character_id: string; card_id: string; cost_key: string; resource_instance_id: string }[]).map(row => ({ id: row.id, characterId: row.character_id, cardId: row.card_id, costKey: row.cost_key, resourceInstanceId: row.resource_instance_id }));
    const events = (this.db.prepare('SELECT * FROM play_events WHERE character_id=? ORDER BY rowid DESC LIMIT 40').all(characterId) as unknown as EventRow[]).map(row => this.readEvent(row));
    const costOverrides=(this.db.prepare('SELECT card_id,cast_options_json FROM character_cost_overrides WHERE character_id=?').all(characterId) as {card_id:string;cast_options_json:string}[]).map(row=>({cardId:row.card_id,castOptions:cardSchema.shape.castOptions.parse(JSON.parse(row.cast_options_json))}));
    const users=this.db.prepare(`SELECT card_id,COUNT(DISTINCT character_id) AS n FROM (SELECT card_id,character_id FROM card_bindings WHERE character_id<>? UNION SELECT dc.card_id,d.character_id FROM deck_cards dc JOIN decks d ON d.id=dc.deck_id WHERE d.character_id<>?) GROUP BY card_id`).all(characterId,characterId) as {card_id:string;n:number}[];
    return { profile:this.classes().profile(characterId),costOverrides,sharedCostUsers:Object.fromEntries(users.map(row=>[row.card_id,row.n])),characterId, revision, resources, templates, bindings, events, warnings, undoTargetId: this.undoTarget(characterId)?.id };
  }
  private getCard(id: string, characterId?:string) {
    const card = this.library.getLibrary().cards.find(card => card.id === id);
    if (!card) throw new UserInputError('등록된 카드를 찾을 수 없습니다.');
    const row=characterId?this.db.prepare('SELECT cast_options_json FROM character_cost_overrides WHERE character_id=? AND card_id=?').get(characterId,id) as {cast_options_json:string}|undefined:undefined;
    return row?{...card,costStatus:'configured' as const,castOptions:cardSchema.shape.castOptions.parse(JSON.parse(row.cast_options_json))}:card;
  }
  private checkScope(overrides: ResourceOverrides): void {
    if (overrides.scope === 'character') { if (overrides.ownerCardId) throw new UserInputError('캐릭터 공유 자원에는 소유 카드를 지정하지 않습니다.'); return; }
    if (!overrides.ownerCardId) throw new UserInputError('소유 카드/아이템을 선택해 주세요.');
    const card = this.getCard(overrides.ownerCardId);
    if (overrides.scope === 'item' && card.kind !== 'item') throw new UserInputError('아이템 범위에는 아이템 유형 카드를 선택해 주세요.');
  }
  private plan(snapshot: ResourceSnapshot, action: z.output<typeof previewRequestSchema>['action']): ResourcePlan {
    if (action.type === 'recover') return planRecovery(snapshot.resources, action.trigger);
    if (action.type === 'adjust') {
      const resource = snapshot.resources.find(resource => resource.id === action.resourceId); if (!resource) throw new UserInputError('현재 캐릭터의 자원이 아닙니다.');
      return planAdjustment(resource, action.delta, action.slotLevel);
    }
    const card = this.getCard(action.cardId,snapshot.characterId);
    const plan = planUse(card, action.optionId, snapshot.resources, snapshot.bindings, action.choices, action.castingLevel, action.ritual);
    const option = resolveCastOption(card, action.optionId, !!action.ritual, snapshot.resources, snapshot.bindings);
    const keys = new Set(option.costs.map(cost => cost.costKey));
    for (const binding of snapshot.bindings.filter(binding => binding.cardId === card.id && keys.has(binding.costKey))) {
      const resource = snapshot.resources.find(resource => resource.id === binding.resourceInstanceId);
      if (resource?.overrides.scope === 'item') this.checkScope(resource.overrides);
    }
    return plan;
  }
  private quote(snapshot: ResourceSnapshot, action: z.output<typeof previewRequestSchema>['action']): string {
    return digest({ characterId: snapshot.characterId, revision: snapshot.revision, action, card: action.type === 'use' ? this.getCard(action.cardId,snapshot.characterId) : undefined, bindings: snapshot.bindings, resources: snapshot.resources });
  }
  preview(input: unknown): ResourcePreview {
    try {
      const { characterId, action } = previewRequestSchema.parse(input); const snapshot = this.snapshot(characterId);
      try { return { ...this.plan(snapshot, action), revision: snapshot.revision, quote: this.quote(snapshot, action) }; }
      catch (error) { if (!(error instanceof ResourceError || error instanceof UserInputError)) throw error; return { changes: [], label: '사용 불가', canUse: false, canOverride: false, reason: error.message, revision: snapshot.revision, quote: this.quote(snapshot, action) }; }
    } catch (error) { if (error instanceof ResourceError) throw new UserInputError(error.message); throw error; }
  }
  definitions(): ResourceTemplate[] {
    return (this.db.prepare("SELECT * FROM resource_templates WHERE archived_at IS NULL AND key NOT LIKE 'card-owned:%' ORDER BY name,rowid")
      .all() as unknown as TemplateRow[]).flatMap(row=>{
        try{return [this.template(row)];}catch{return [];}
      });
  }
  createDefinition(input: unknown): ResourceTemplate {
    const { name, type } = resourceDefinitionSchema.parse(input);
    const counter = type==='uses'||type==='points';
    const draft = templateDraftSchema.parse(counter
      ? {name,kind:'counter',unit:type==='uses'?'회':'점',capacity:{type:'fixed',value:0},recovery:[]}
      : {name,kind:'slot_track',unit:'슬롯',slotKind:type,slotCapacity:{},recovery:[]});
    return transaction(this.db,()=>this.getTemplate(this.saveTemplate(draft,true)));
  }
  private saveTemplate(draft: TemplateDraft, definitionOnly = false): string {
    const existing = draft.id ? this.db.prepare('SELECT * FROM resource_templates WHERE id=? AND archived_at IS NULL').get(draft.id) as unknown as TemplateRow | undefined : undefined;
    if (draft.id && !existing) throw new UserInputError('템플릿을 찾을 수 없습니다.');
    if (existing?.key.startsWith('card-owned:')) throw new UserInputError('고유 자원 정의는 카드 정보에서 수정하세요.');
    if (existing && this.db.prepare('SELECT id FROM resource_instances WHERE template_id=? AND archived_at IS NULL').get(existing.id)) throw new UserInputError('장착 중인 템플릿은 복제해서 편집해 주세요. 현재량은 변경하지 않았습니다.');
    const id = existing?.id ?? randomUUID(); const template = { ...draft, id, key: existing?.key ?? `user_${id}`, source: existing?.source ?? 'user', version: (existing?.version ?? 0) + 1,
      ...(definitionOnly ? {definitionOnly:true} : {}) };
    this.db.prepare(`INSERT INTO resource_templates(id,key,name,kind,definition_json,source,version) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,definition_json=excluded.definition_json,version=excluded.version`).run(id,template.key,template.name,template.kind,JSON.stringify(template),template.source,template.version);
    return id;
  }
  private attach(characterId: string, templateId: string, overrides: ResourceOverrides): void {
    if (!this.db.prepare("SELECT id FROM resource_templates WHERE id=? AND archived_at IS NULL AND key NOT LIKE 'card-owned:%'").get(templateId)) throw new UserInputError('보관 해제된 템플릿은 새로 장착할 수 없습니다.');
    this.checkScope(overrides); const template = this.getTemplate(templateId); const max = maximums(template, this.profile(characterId), overrides);
    if (template.definitionOnly) throw new UserInputError('먼저 자원의 최대량과 회복 조건을 설정해 주세요.');
    const state = template.kind === 'counter' ? { remaining: max.capacity } : { remainingByLevel: max.capacityByLevel };
    this.db.prepare('INSERT INTO resource_instances(id,character_id,template_id,overrides_json,current_state_json) VALUES (?,?,?,?,?)').run(randomUUID(),characterId,templateId,JSON.stringify(overrides),JSON.stringify(state));
  }
  private writeStates(resources: ResourceView[], changes: ResourceChange[], characterId: string): void {
    for (const id of new Set(changes.map(change => change.resourceInstanceId))) {
      const resource = resources.find(resource => resource.id === id)!;
      const state = resource.kind === 'counter' ? { remaining: resource.remaining } : { remainingByLevel: resource.remainingByLevel };
      this.db.prepare('UPDATE resource_instances SET current_state_json=? WHERE id=? AND character_id=? AND archived_at IS NULL').run(JSON.stringify(state), id, characterId);
    }
  }
  change(input: unknown, withinTransaction = false, newCardRegistration = false): ResourceResult {
    const request = resourceRequestSchema.parse(input); const { characterId, action } = request; const fingerprint = digest(request);
    if (newCardRegistration && (!withinTransaction || action.type !== 'save_costs')) throw new UserInputError('잘못된 초기 규칙 저장 요청입니다.');
    try {
      const execute = () => {
        const prior = this.db.prepare('SELECT fingerprint,event_id FROM resource_requests WHERE request_id=?').get(request.requestId) as { fingerprint: string; event_id: string | null } | undefined;
        if (prior) { if (prior.fingerprint !== fingerprint) throw new UserInputError('같은 요청 ID로 다른 내용을 처리할 수 없습니다.'); return { snapshot: this.snapshot(characterId), eventId: prior.event_id ?? undefined, replayed: true }; }
        const snapshot = this.snapshot(characterId);
        if (snapshot.revision !== request.expectedRevision) throw new UserInputError('자원 상태가 바뀌었습니다. 최신 상태에서 다시 확인해 주세요.');
        let changes: ResourceChange[] = []; let label = ''; let eventType = 'profile_changed'; let barrier = true; let undoId: string | undefined; let configuration: unknown; let classUndo:ClassUndo|undefined; let usePlan:ResourcePlan|undefined;
        if(action.type==='configure_class'){
          const result=this.classes().apply(characterId,action.configuration as ClassInput,action.quote,action.confirmRetire);classUndo=result.undo;label=result.label;barrier=false;
        }else if(action.type==='clear_cost_override'){
          this.getCard(action.cardId);this.db.prepare('DELETE FROM character_cost_overrides WHERE character_id=? AND card_id=?').run(characterId,action.cardId);label='캐릭터 전용 비용 해제 · 공통 정의 사용';
        }else if (action.type === 'create_resource') {
          if (action.template.id) {
            const previous = this.getTemplate(action.template.id);
            if (!previous.definitionOnly) throw new UserInputError('기존 템플릿은 장착을 이용하세요.');
            if (previous.kind!==action.template.kind || (previous.slotKind??'generic')!==(action.template.slotKind??'generic') ||
                previous.matchKey!==action.template.matchKey || action.scope!=='character') {
              throw new UserInputError('등록한 공유 자원의 종류를 유지해 주세요.');
            }
          }
          const templateId = this.saveTemplate(action.template); this.attach(characterId, templateId, { scope: action.scope, ownerCardId: action.ownerCardId }); label = `${action.template.name} 자원 생성`;
        } else if (action.type === 'save_template') { this.saveTemplate(action.template); label = `${action.template.name} 템플릿 저장`;
        } else if (action.type === 'archive_template') {
          if (!this.db.prepare("SELECT id FROM resource_templates WHERE id=? AND archived_at IS NULL AND key NOT LIKE 'card-owned:%'").get(action.templateId)) throw new UserInputError('템플릿을 찾을 수 없습니다.');
          this.db.prepare('UPDATE resource_templates SET archived_at=? WHERE id=?').run(new Date().toISOString(),action.templateId); label = '템플릿 보관 해제 · 장착 자원 유지';
        } else if (action.type === 'attach') { this.attach(characterId,action.templateId,{ scope: action.scope, ownerCardId: action.ownerCardId }); label = '자원 장착';
        } else if (action.type === 'edit_resource') {
          const old = snapshot.resources.find(resource => resource.id === action.resourceId); if (!old) throw new UserInputError('현재 캐릭터의 자원이 아닙니다.');
          if (old.ownedDefinitionId) throw new UserInputError('고유 자원 정의는 카드 정보에서 수정하세요.');
          this.checkScope(action.overrides);
          if (old.kind === 'counter' && action.overrides.slotCapacityOverride || old.kind === 'slot_track' && action.overrides.capacityOverride !== undefined) throw new UserInputError('자원 종류에 맞는 최대치를 지정하세요.');
          const max = maximums(old.template, this.profile(characterId), action.overrides);
          const state = old.kind === 'counter' ? { remaining: Math.max(0, max.capacity! - (old.capacity! - old.remaining!)) } : { remainingByLevel: Object.fromEntries(Object.entries(max.capacityByLevel!).map(([level, capacity]) => [level, Math.max(0, capacity - ((old.capacityByLevel![level] ?? capacity) - (old.remainingByLevel![level] ?? capacity)))])) };
          this.db.prepare('UPDATE resource_instances SET overrides_json=?,current_state_json=? WHERE id=? AND character_id=?').run(JSON.stringify(action.overrides),JSON.stringify(state),old.id,characterId);
          const next = this.readInstance(this.db.prepare('SELECT * FROM resource_instances WHERE id=?').get(old.id) as unknown as InstanceRow, this.profile(characterId));
          const levels = old.kind === 'counter' ? [undefined] : [...new Set([...Object.keys(old.capacityByLevel!),...Object.keys(next.capacityByLevel!)])].map(Number);
          changes = levels.flatMap(slotLevel => {
            const before = slotLevel === undefined ? old.remaining! : old.remainingByLevel![String(slotLevel)] ?? 0;
            const after = slotLevel === undefined ? next.remaining! : next.remainingByLevel![String(slotLevel)] ?? 0;
            return before === after ? [] : [{ resourceInstanceId: old.id, slotLevel, before, after }];
          });
          configuration = { resourceInstanceId: old.id, before: { overrides: old.overrides, capacity: old.capacity, capacityByLevel: old.capacityByLevel }, after: { overrides: next.overrides, capacity: next.capacity, capacityByLevel: next.capacityByLevel } };
          label = `${old.name} 설정 변경`;
        } else if (action.type === 'delete_resource') {
          const resource = snapshot.resources.find(resource => resource.id === action.resourceId); if (!resource) throw new UserInputError('현재 캐릭터의 자원이 아닙니다.');
          if (resource.ownedDefinitionId) throw new UserInputError('고유 자원은 카드의 덱 소속으로 관리합니다.');
          this.db.prepare('UPDATE resource_instances SET archived_at=? WHERE id=? AND character_id=?').run(new Date().toISOString(),resource.id,characterId); label = `${resource.name} 연결 해제`;
        } else if (action.type === 'save_costs') {
          barrier = !newCardRegistration;
          const card = this.getCard(action.cardId,snapshot.characterId); const options = cardSchema.shape.castOptions.max(12).parse(action.castOptions);
          if (new Set(options.map(option => option.id)).size !== options.length) throw new UserInputError('사용 방식 ID가 중복됩니다.');
          const keys = new Set(options.flatMap(option => option.costs.map(cost => cost.costKey)));
          if (new Set(action.bindings.map(binding => binding.costKey)).size !== action.bindings.length) throw new UserInputError('비용별 연결이 중복됩니다.');
          for (const binding of action.bindings) {
            if (!keys.has(binding.costKey)) throw new UserInputError('사용 방식에 없는 비용 연결입니다.');
            const resource = snapshot.resources.find(resource => resource.id === binding.resourceInstanceId);
            if (!resource || resource.ownedDefinitionId) throw new UserInputError('현재 캐릭터에서 직접 연결할 수 있는 활성 자원을 고르세요.');
            this.checkScope(resource.overrides);
            if (resource.overrides.scope === 'card' && resource.overrides.ownerCardId !== card.id) throw new UserInputError('다른 카드 전용 자원입니다.');
            for (const cost of options.flatMap(option => option.costs)) {
              if (cost.costKey !== binding.costKey || !cost.requirement) continue;
              try { resolveCostResource(card.id, cost, snapshot.resources, [{ ...binding, id: binding.costKey, cardId: card.id, characterId }]); }
              catch (error) { throw new UserInputError((error as Error).message); }
            }
          }
          const shared=this.getCard(card.id);
          if(action.expectedCardVersion!==undefined&&action.expectedCardVersion!==shared.updatedAt)throw new UserInputError('공통 카드가 변경됐습니다. 비용 설정을 다시 열어 주세요.');
          const baseChanged=action.spellLevel!==undefined&&action.spellLevel!==shared.spellLevel;
          if(action.spellLevel!==undefined&&shared.kind!=='spell')throw new UserInputError('주문 카드에만 기본 주문 레벨을 지정할 수 있습니다.');
          if((baseChanged||action.scope==='shared'&&(shared.costStatus==='unconfigured'||JSON.stringify(shared.castOptions)!==JSON.stringify(options)))&&(snapshot.sharedCostUsers?.[card.id]??0)>0&&!action.confirmShared)throw new UserInputError('다른 캐릭터에 영향을 주는 공통 비용/기본 주문 레벨 수정에 동의해 주세요.');
          configuration={cardId:card.id,scope:action.scope,before:{spellLevel:shared.spellLevel,castOptions:action.scope==='shared'?shared.castOptions:card.castOptions,bindings:snapshot.bindings.filter(binding=>binding.cardId===card.id)},after:{spellLevel:action.spellLevel??shared.spellLevel,castOptions:options,bindings:action.bindings}};
          if(baseChanged)this.db.prepare('UPDATE card_definitions SET spell_level=?,updated_at=? WHERE id=?').run(action.spellLevel!,new Date().toISOString(),card.id);
          if(action.scope==='shared'){
            const attributes=shared.costStatus===undefined?"json_set(attributes_json,'$.castOptions',json(?))":"json_set(attributes_json,'$.castOptions',json(?),'$.costStatus','configured')";
            this.db.prepare(`UPDATE card_definitions SET attributes_json=${attributes},updated_at=? WHERE id=?`).run(JSON.stringify(options),new Date().toISOString(),card.id);
          }else this.db.prepare('INSERT INTO character_cost_overrides VALUES (?,?,?,?) ON CONFLICT(character_id,card_id) DO UPDATE SET cast_options_json=excluded.cast_options_json,updated_at=excluded.updated_at').run(characterId,card.id,JSON.stringify(options),new Date().toISOString());
          this.db.prepare('DELETE FROM card_bindings WHERE character_id=? AND card_id=?').run(characterId,card.id);
          for (const binding of action.bindings) this.db.prepare('INSERT INTO card_bindings(id,character_id,card_id,cost_key,resource_instance_id) VALUES (?,?,?,?,?)').run(randomUUID(),characterId,card.id,binding.costKey,binding.resourceInstanceId);
          label = `${card.name} 사용 방식/비용 연결`;
        } else if (action.type === 'undo') {
          const target = this.undoTarget(characterId); if (!target) throw new UserInputError('되돌릴 자원 변경이 없습니다. 설정 변경 이전 기록은 되돌리지 않습니다.');
          if(target.classUndo)this.classes().undo(characterId,target.classUndo as ClassUndo);
          changes = target.changes.map(change => {
            const resource = snapshot.resources.find(value => value.id === change.resourceInstanceId);
            if (!resource?.ownedDefinitionId) return { ...change, before: change.after, after: change.before };
            const current = resource.remaining!;
            // Capacity changes may have clamped the stored amount since the event.
            return { ...change, before: current, after: Math.max(0, Math.min(resource.capacity!, current + change.before - change.after)) };
          });
          if(!target.classUndo)this.writeStates(applyChanges(snapshot.resources, changes),changes,characterId); label = `${target.label} 실행 취소`; eventType = 'undo'; barrier = false; undoId = target.id;
        } else {
          const previewAction = action.type === 'use' ? { type: 'use' as const, cardId: action.cardId, optionId: action.optionId, choices: action.choices,castingLevel:action.castingLevel,ritual:action.ritual } : action;
          const plan = this.plan(snapshot, previewAction);usePlan=plan;
          if (action.type === 'use') {
            if (action.quote !== this.quote(snapshot,previewAction)) throw new UserInputError('카드 비용 또는 자원이 바뀌었습니다. 비용을 다시 확인해 주세요.');
            if (!plan.canUse && !(action.override && plan.canOverride)) throw new UserInputError(plan.reason ?? '사용할 수 없습니다.');
            if (action.override && !plan.canOverride) throw new UserInputError('자원 부족일 때만 별도 예외 사용을 허용합니다.');
            changes = action.override ? [] : plan.changes; eventType = 'card_used';
          } else { changes = plan.changes; eventType = action.type === 'recover' ? 'recovery' : 'manual_adjustment'; }
          this.writeStates(applyChanges(snapshot.resources, changes), changes, characterId); label = plan.label; barrier = false;
        }
        const shouldRecord = barrier || changes.length > 0 || action.type === 'use' || action.type==='configure_class' || undoId!==undefined;
        let eventId: string | undefined;
        if (shouldRecord) {
          eventId = randomUUID();
          const usedCard=action.type==='use'?this.getCard(action.cardId,characterId):undefined;
          const event = { classUndo,costSnapshot:usedCard&&action.type==='use'?{name:usedCard.name,spellLevel:usedCard.spellLevel,option:resolveCastOption(usedCard,action.optionId,!!action.ritual,snapshot.resources,snapshot.bindings)}:undefined,selectedSlotLevels:usePlan?.selectedSlotLevels,castingLevel:usePlan?.castingLevel,engineVersion: 1, label, changes, reversible: !barrier && eventType !== 'undo' && (changes.length > 0 || !!classUndo), barrier,
            cardId: action.type === 'use' ? action.cardId : undefined, castOptionId: action.type === 'use' ? action.optionId : undefined,
            configuration, choices: action.type === 'use' ? action.choices : undefined, override: action.type === 'use' ? action.override : undefined, undoesEventId: undoId };
          this.db.prepare('INSERT INTO play_events(id,character_id,event_type,payload_json,occurred_at) VALUES (?,?,?,?,?)').run(eventId,characterId,eventType,JSON.stringify(event),new Date().toISOString());
          if (undoId) this.db.prepare('INSERT INTO resource_undos(target_event_id,undo_event_id) VALUES (?,?)').run(undoId,eventId);
          this.db.prepare('INSERT INTO resource_revisions(character_id,revision) VALUES (?,1) ON CONFLICT(character_id) DO UPDATE SET revision=revision+1').run(characterId);
        }
        this.db.prepare('INSERT INTO resource_requests(request_id,character_id,fingerprint,event_id,occurred_at) VALUES (?,?,?,?,?)').run(request.requestId,characterId,fingerprint,eventId ?? null,new Date().toISOString());
        return { snapshot: this.snapshot(characterId), replayed: false, eventId };
      };
      return withinTransaction ? execute() : transaction(this.db, execute);
    } catch (error) { if (error instanceof ResourceError) throw new UserInputError(error.message); throw error; }
  }
}
