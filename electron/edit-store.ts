import { createHash, randomUUID } from 'node:crypto';
import type { SQLInputValue } from 'node:sqlite';
import { z } from 'zod';
import { editActionSchema, editCommitSchema, type EditAction, type EditSummary, type EditBatch } from '../src/shared/bulk';
import { type CastOption } from '../src/shared/contracts';
import { AppStore } from './store';
import { ResourceStore } from './resource-store';
import { transaction } from './migrations';
import { UserInputError } from './errors';

// Only these application-owned tables may be journaled. No renderer-provided SQL.
const tables = {
  card_definitions: ['id'], card_tags: ['card_id','tag_id'], deck_cards: ['deck_id','card_id'],
  resource_instances: ['id'], resource_templates: ['id'], character_cost_overrides: ['character_id','card_id'], card_bindings: ['id'],
} as const;
type Table = keyof typeof tables;
type Row = Record<string, SQLInputValue>;
interface Patch { table: Table; key: Row; before: Row | null; after: Row | null }
interface JournalRow { id: string; label: string; action_json: string; summary_json: string; patches_json: string; created_at: string; restored_at: string | null }
const json = (v: unknown) => JSON.stringify(v);
const hash = (v: unknown) => createHash('sha256').update(json(v)).digest('hex');
const requireValue = <T>(v: T | undefined, message: string): T => { if (!v) throw new UserInputError(message); return v; };

export class EditStore {
  private db;
  private resources;
  constructor(store: AppStore) { this.db = store.db; this.resources = new ResourceStore(store); }
  private rows() {
    return Object.fromEntries((Object.keys(tables) as Table[]).map(table => [table, this.db.prepare(`SELECT * FROM ${table} ORDER BY ${tables[table].join(',')}`).all() as Row[]])) as Record<Table, Row[]>;
  }
  private diff(before: Record<Table, Row[]>, after: Record<Table, Row[]>): Patch[] {
    return (Object.keys(tables) as Table[]).flatMap(table => {
      const key = (row: Row) => json(tables[table].map(k => row[k]));
      const a = new Map(before[table].map(row => [key(row), row])); const b = new Map(after[table].map(row => [key(row), row]));
      return [...new Set([...a.keys(),...b.keys()])].flatMap(id => {
        const old = a.get(id) ?? null; const next = b.get(id) ?? null;
        return json(old) === json(next) ? [] : [{ table, key: Object.fromEntries(tables[table].map(k => [k,(old ?? next)![k]])), before: old, after: next }];
      });
    });
  }
  private profile(id: string) { return requireValue(this.db.prepare('SELECT * FROM character_profiles WHERE id=?').get(id), '캐릭터를 찾을 수 없습니다.'); }
  private resourceGuard(characterId:string,resourceIds:string[]) {
    const p=this.profile(characterId);
    return hash({classId:p.class_id,level:p.level,ruleset:p.ruleset,abilities:p.ability_scores_json,templates:resourceIds.map(id=>this.db.prepare('SELECT t.* FROM resource_templates t JOIN resource_instances i ON i.template_id=t.id WHERE i.id=?').get(id))});
  }
  private card(id: string) { return requireValue(this.db.prepare('SELECT * FROM card_definitions WHERE id=? AND archived_at IS NULL').get(id), '현재 라이브러리에 없는 카드입니다.'); }
  private cardUsers(cardIds: string[]): string[] {
    return [...new Set(cardIds.flatMap(id => (this.db.prepare(`SELECT character_id FROM decks JOIN deck_cards ON decks.id=deck_cards.deck_id WHERE card_id=? UNION SELECT character_id FROM card_bindings WHERE card_id=? UNION SELECT character_id FROM character_cost_overrides WHERE card_id=?`).all(id,id,id) as { character_id: string }[]).map(row => row.character_id)))];
  }
  private names(ids: string[]) { return [...new Set(ids)].map(id => String(this.profile(id).name)); }
  private barrier(characterId: string, label: string) {
    const payload = {engineVersion:1,label,changes:[],barrier:true,reversible:false};
    this.db.prepare("INSERT INTO play_events VALUES (?,?,'profile_changed',?,?)").run(randomUUID(),characterId,json(payload),new Date().toISOString());
    this.db.prepare('INSERT INTO resource_revisions VALUES (?,1) ON CONFLICT(character_id) DO UPDATE SET revision=revision+1').run(characterId);
  }
  private restore(id: string): EditSummary {
    const batch = requireValue(this.db.prepare('SELECT * FROM edit_batches WHERE id=? AND restored_at IS NULL').get(id) as unknown as JournalRow | undefined, '복원 가능한 일괄 기록이 없습니다.');
    const patches: Patch[] = JSON.parse(batch.patches_json); const summary: EditSummary = JSON.parse(batch.summary_json);
    // Compare every row first. Later edits/spending must never be overwritten.
    for (const patch of patches) {
      const row = this.db.prepare(`SELECT * FROM ${patch.table} WHERE ${Object.keys(patch.key).map(k => `${k}=?`).join(' AND ')}`).get(...Object.values(patch.key)) ?? null;
      if (json(row) !== json(patch.after)) throw new UserInputError('이후 변경과 충돌하여 복원하지 않았습니다. 최신 일괄 작업부터 복원하거나 항목을 수동으로 확인해 주세요.');
      if (patch.table === 'resource_instances' && patch.before) {
        if(patch.before.preset_key&&this.db.prepare('SELECT id FROM resource_instances WHERE character_id=? AND preset_key=? AND archived_at IS NULL AND id<>?').get(patch.before.character_id,patch.before.preset_key,patch.before.id)) throw new UserInputError('같은 프리셋의 새 자원이 있어 중복 복원하지 않았습니다. 자원 연결을 수동으로 확인해 주세요.');
        const action = JSON.parse(batch.action_json) as EditAction;
        // Reattaching a preset after a class change needs a fresh class preview.
        if (action.type === 'disconnect_resources') {
          const guard = (JSON.parse(batch.summary_json) as EditSummary & {profileGuard?:string}).profileGuard;
          if (guard !== this.resourceGuard(action.characterId,action.resourceIds)) throw new UserInputError('클래스·레벨 또는 템플릿 설정이 바뀌어 자원을 자동 복원할 수 없습니다.');
        }
      }
    }
    // Remove relationship rows before reinserting original ordered memberships.
    for (const patch of patches) if (patch.after && !patch.before || patch.table === 'deck_cards' || patch.table === 'card_bindings' || patch.table === 'card_tags') {
      this.db.prepare(`DELETE FROM ${patch.table} WHERE ${Object.keys(patch.key).map(k => `${k}=?`).join(' AND ')}`).run(...Object.values(patch.key));
    }
    for (const patch of patches) if (patch.before) {
      const cols = Object.keys(patch.before);
      this.db.prepare(`INSERT INTO ${patch.table} (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')}) ON CONFLICT (${tables[patch.table].join(',')}) DO UPDATE SET ${cols.map(c=>`${c}=excluded.${c}`).join(',')}`).run(...Object.values(patch.before));
    }
    const action = JSON.parse(batch.action_json) as EditAction;
    if(action.type==='card_tags'||action.type==='costs'&&(action.rules.scope==='shared'||action.rules.spellLevel!==undefined)) {
      const users=this.cardUsers(action.type==='card_tags'?action.cardIds:[action.rules.cardId]);
      summary.characters=this.names(users);
      summary.requiresImpact=action.type==='card_tags'?users.length>0:users.some(id=>id!==action.characterId);
    }
    if (action.type === 'costs' || action.type === 'disconnect_resources') this.barrier(action.characterId, `${batch.label} · 일괄 편집 복원`);
    this.db.prepare('UPDATE edit_batches SET restored_at=? WHERE id=?').run(new Date().toISOString(),id);
    return {...summary,label:`복원: ${batch.label}`,details:[...summary.details,'변경 전 상태로 복원합니다. 자원 사용 Undo와 별도입니다.']};
  }
  private execute(action: EditAction): EditSummary {
    const details: string[] = []; let characters: string[] = []; let targets: string[] = []; let label = ''; let requiresImpact = false;
    if (action.type === 'restore') return this.restore(action.batchId);
    if (action.type === 'costs') {
      const card = this.card(action.rules.cardId); const snap = this.resources.snapshot(action.characterId);
      const old: CastOption[] = action.rules.scope === 'character' ? snap.costOverrides?.find(o=>o.cardId===card.id)?.castOptions ?? JSON.parse(String(card.attributes_json)).castOptions : JSON.parse(String(card.attributes_json)).castOptions;
      const next = action.rules.castOptions;
      label = action.intent === 'convert_slots' ? '자동 슬롯 선택으로 전환' : '카드 사용 규칙 일괄 정리'; targets = [String(card.name)];
      details.push(`${old.length} → ${next.length}개 사용 방식`, `${old.reduce((n,o)=>n+o.costs.length,0)} → ${next.reduce((n,o)=>n+o.costs.length,0)}개 비용`, action.rules.scope === 'character' ? '현재 캐릭터 전용 비용' : '공통 카드 비용 · 다른 캐릭터의 전용 재정의와 자원 연결은 유지');
      const users = action.rules.scope === 'shared' || action.rules.spellLevel !== undefined ? this.cardUsers([String(card.id)]) : [action.characterId];
      characters = this.names(users); requiresImpact = users.some(id=>id!==action.characterId);
      this.resources.change({requestId:randomUUID(),characterId:action.characterId,expectedRevision:snap.revision,action:{...action.rules,confirmShared:true}},true);
    } else if (action.type === 'disconnect_resources') {
      const snap = this.resources.snapshot(action.characterId); label = '자원 연결 일괄 해제'; characters = this.names([action.characterId]);
      for (const id of action.resourceIds) {
        const r = requireValue(snap.resources.find(r=>r.id===id),'현재 캐릭터에 연결된 자원만 선택하세요.'); targets.push(r.name);
        const count = Number(this.db.prepare('SELECT count(DISTINCT card_id) AS n FROM card_bindings WHERE resource_instance_id=?').get(id)!.n);
        details.push(`${r.name}: 카드 ${count}장 연결 유지 · 복원 전 사용 불가`);
        this.db.prepare('UPDATE resource_instances SET archived_at=? WHERE id=?').run(new Date().toISOString(),id);
      }
      details.unshift(`${targets.length}개 자원 · 템플릿과 현재량은 보존`); this.barrier(action.characterId,label);
    } else if (action.type === 'archive_templates') {
      label = '자원 템플릿 일괄 삭제'; const users: string[] = [];
      for (const id of action.templateIds) {
        const t = requireValue(this.db.prepare('SELECT * FROM resource_templates WHERE id=? AND archived_at IS NULL').get(id),'활성 템플릿이 아닙니다.'); targets.push(String(t.name));
        const instances = this.db.prepare('SELECT id,character_id FROM resource_instances WHERE template_id=? AND archived_at IS NULL').all(id) as {id:string;character_id:string}[];
        users.push(...instances.map(i=>i.character_id));
        const cards = Number(this.db.prepare('SELECT count(DISTINCT card_id) AS n FROM card_bindings JOIN resource_instances ON resource_instance_id=resource_instances.id WHERE template_id=?').get(id)!.n);
        details.push(`${t.name}: 기존 연결 ${instances.length}개 / 참조 카드 ${cards}장 유지`);
        this.db.prepare('UPDATE resource_templates SET archived_at=? WHERE id=?').run(new Date().toISOString(),id);
      }
      characters = this.names(users); requiresImpact = users.length > 0; details.unshift(`${targets.length}개 템플릿 · 새 장착 목록에서 숨김 · 기존 자원은 계속 사용 가능`);
    } else if (action.type === 'card_tags') {
      label = '카드 태그 일괄 변경'; const changedIds:string[]=[];
      if (action.addTagIds.some(id=>action.removeTagIds.includes(id))) throw new UserInputError('같은 태그를 추가·제거할 수 없습니다.');
      for (const id of [...action.addTagIds,...action.removeTagIds]) requireValue(this.db.prepare('SELECT id FROM tags WHERE id=?').get(id),'태그가 삭제되었거나 존재하지 않습니다.');
      const tagNames=(ids:string[])=>ids.map(id=>String(this.db.prepare('SELECT name FROM tags WHERE id=?').get(id)!.name)).join(' · ')||'없음';
      details.push(`추가 태그: ${tagNames(action.addTagIds)} / 제거 태그: ${tagNames(action.removeTagIds)}`);
      for (const id of action.cardIds) {
        const card = this.card(id); targets.push(String(card.name)); const before = (this.db.prepare('SELECT tag_id FROM card_tags WHERE card_id=? ORDER BY tag_id').all(id) as {tag_id:string}[]).map(t=>t.tag_id);
        const next = [...new Set([...before.filter(t=>!action.removeTagIds.includes(t)),...action.addTagIds])].sort();
        if (next.length > 100) throw new UserInputError('카드 태그는 100개까지 지정할 수 있습니다.');
        if (json(before) !== json(next)) {
          changedIds.push(id);
          this.db.prepare('DELETE FROM card_tags WHERE card_id=?').run(id);
          for (const tag of next) this.db.prepare('INSERT INTO card_tags VALUES (?,?)').run(id,tag);
          this.db.prepare("UPDATE card_definitions SET attributes_json=json_set(attributes_json,'$.tags',json(?)),updated_at=? WHERE id=?").run(json(next),new Date().toISOString(),id);
        }
      }
      characters = this.names(this.cardUsers(changedIds)); requiresImpact = characters.length>0;
      details.push(`선택 ${targets.length}장 중 실제 변경 ${changedIds.length}장 · 태그 ${action.addTagIds.length}개 추가 / ${action.removeTagIds.length}개 제거`, '공통 카드 정의에 적용 · 카드 ID·이미지·사용 기록 보존');
    } else {
      const deck = requireValue(this.db.prepare('SELECT * FROM decks WHERE id=?').get(action.deckId),'덱이 없습니다.'); characters = this.names([String(deck.character_id)]);
      const before = (this.db.prepare('SELECT card_id FROM deck_cards WHERE deck_id=? ORDER BY position').all(action.deckId) as {card_id:string}[]).map(r=>r.card_id);
      for (const id of action.cardIds) targets.push(String(this.card(id).name));
      const next = action.operation === 'add' ? [...new Set([...before,...action.cardIds])] : before.filter(id=>!action.cardIds.includes(id));
      if (next.length>5000) throw new UserInputError('덱은 5000장까지 지원합니다.');
      label = action.operation === 'add' ? '선택 카드 덱에 일괄 추가' : '선택 카드 덱에서 일괄 제거';
      details.push(`${deck.name}: ${before.length} → ${next.length}장 · 실제 ${Math.abs(next.length-before.length)}장 변경`, '라이브러리 원본 카드·이미지·사용 이력은 유지');
      this.db.prepare('DELETE FROM deck_cards WHERE deck_id=?').run(action.deckId);
      next.forEach((id,position)=>this.db.prepare('INSERT INTO deck_cards VALUES (?,?,?)').run(action.deckId,id,position));
    }
    return {label,details,characters,targets,requiresImpact,...(action.type==='disconnect_resources'?{profileGuard:this.resourceGuard(action.characterId,action.resourceIds)}:{})};
  }
  private plan(action: EditAction) {
    const before = this.rows();
    const guard = action.type === 'restore' ? this.db.prepare('SELECT * FROM edit_batches WHERE id=?').get(action.batchId) : this.db.prepare('SELECT * FROM character_profiles ORDER BY id').all();
    this.db.exec('SAVEPOINT edit_preview');
    try {
      const summary = this.execute(action); const patches = this.diff(before,this.rows());
      if (!patches.length && action.type !== 'restore') throw new UserInputError('실제로 변경되는 항목이 없습니다.');
      return {summary,patches,quote:hash({action,before,guard,summary})};
    } finally { this.db.exec('ROLLBACK TO edit_preview; RELEASE edit_preview'); }
  }
  preview(input: unknown) { const action = editActionSchema.parse(input); return transaction(this.db,()=> { const p = this.plan(action); return {...p.summary,quote:p.quote}; }); }
  apply(input: unknown) {
    const request = editCommitSchema.parse(input);
    return transaction(this.db,()=> {
      const fingerprint = hash(request); const prior = this.db.prepare('SELECT * FROM edit_requests WHERE request_id=?').get(request.requestId);
      if (prior) { if (prior.fingerprint !== fingerprint) throw new UserInputError('요청 ID가 다른 내용에 사용되었습니다.'); return {batchId:String(prior.batch_id),replayed:true}; }
      const p = this.plan(request.action);
      if (p.quote !== request.quote) throw new UserInputError('변경 범위가 달라졌습니다. 미리보기를 다시 열어 주세요.');
      if (p.summary.requiresImpact && !request.confirmImpact) throw new UserInputError('다른 캐릭터와 공통 데이터에 미치는 영향을 확인해 주세요.');
      const before = this.rows(); const summary = this.execute(request.action); const patches = this.diff(before,this.rows());
      const batchId = request.action.type === 'restore' ? request.action.batchId : randomUUID(); const now = new Date().toISOString();
      if (request.action.type !== 'restore') this.db.prepare('INSERT INTO edit_batches VALUES (?,?,?,?,?,?,NULL)').run(batchId,summary.label,json(request.action),json(summary),json(patches),now);
      this.db.prepare('INSERT INTO edit_requests VALUES (?,?,?,?)').run(request.requestId,fingerprint,batchId,now);
      return {batchId,replayed:false};
    });
  }
  history(input?: unknown): EditBatch[] { z.undefined().parse(input); return (this.db.prepare('SELECT * FROM edit_batches ORDER BY rowid DESC').all() as unknown as JournalRow[]).map(row=>({...JSON.parse(row.summary_json),id:row.id,createdAt:row.created_at,restoredAt:row.restored_at??undefined})); }
}
