import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { classInputSchema, CLASS_NAMES, type CharacterConfiguration, type ClassPreview, type ClassInput } from '../src/shared/class-contracts';
import { classResources } from '../src/shared/presets';
import type { ResourceSnapshot, ResourceView, ResourceTemplate } from '../src/shared/resources';
import { maximums, assertResource } from '../src/shared/resource-engine';
import { UserInputError } from './errors';

interface InstanceRow { id:string; character_id:string; template_id:string; overrides_json:string; current_state_json:string; archived_at:string|null; preset_key:string|null }
interface ProfileRow { class_id:string|null; level:number; ruleset:'dnd5e_2014'|'homebrew'; ability_scores_json:string|null }
interface ClassState { profile:ProfileRow; rows:InstanceRow[] }
export interface ClassUndo { before:ClassState; after:ClassState }
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)??'undefined').digest('hex');
function stableId(value:string){const h=hash(value);return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
export function preserveSpent(old:ResourceView|undefined,next:ResourceView):ResourceView {
  if(next.unlimited)next.remaining=0;
  if(!old)return next;
  if(old.kind!==next.kind)throw new UserInputError('자원 종류가 바뀌었습니다. 기존 자원을 보존하고 새 자원으로 연결해 주세요.');
  if(next.kind==='counter')next.remaining=next.unlimited?0:old.unlimited?0:Math.max(0,next.capacity!-(old.capacity!-old.remaining!));
  else if(next.template.slotKind==='pact'){
    const spent=Object.values(old.capacityByLevel!).reduce((a,b)=>a+b,0)-Object.values(old.remainingByLevel!).reduce((a,b)=>a+b,0);
    const levels=Object.keys(next.capacityByLevel!);if(levels.length!==1)throw new UserInputError('계약 슬롯 단계는 하나여야 합니다. 수동 최대치 설정을 확인해 주세요.');
    next.remainingByLevel={[levels[0]]:Math.max(0,next.capacityByLevel![levels[0]]-spent)};
  }else next.remainingByLevel=Object.fromEntries(Object.entries(next.capacityByLevel!).map(([level,max])=>[level,Math.max(0,max-((old.capacityByLevel![level]??0)-(old.remainingByLevel![level]??0)))]));
  assertResource(next);return next;
}
export class ClassStore {
  constructor(readonly db:DatabaseSync,readonly readSnapshot:(characterId:string)=>ResourceSnapshot){}
  profile(characterId:string):CharacterConfiguration {
    const row=this.db.prepare('SELECT class_id,level,ruleset,ability_scores_json FROM character_profiles WHERE id=?').get(characterId) as unknown as ProfileRow|undefined;
    if(!row)throw new UserInputError('캐릭터를 찾을 수 없습니다.');
    return {classId:row.class_id??undefined,level:row.level,ruleset:row.ruleset,abilityScores:row.ability_scores_json?JSON.parse(row.ability_scores_json):undefined};
  }
  private capture(characterId:string):ClassState {
    return {profile:this.db.prepare('SELECT class_id,level,ruleset,ability_scores_json FROM character_profiles WHERE id=?').get(characterId) as unknown as ProfileRow,rows:this.db.prepare('SELECT * FROM resource_instances WHERE character_id=? ORDER BY id').all(characterId) as unknown as InstanceRow[]};
  }
  preview(characterId:string,input:ClassInput):ClassPreview {
    const configuration=classInputSchema.parse(input);const snapshot=this.readSnapshot(characterId);const before=this.profile(characterId);
    const rows=this.capture(characterId).rows;
    if(rows.filter(row=>!row.archived_at).length!==snapshot.resources.length)throw new UserInputError('읽을 수 없는 기존 자원 설정이 있습니다. 원본을 보존했으므로 자원 설정을 먼저 확인해 주세요.');
    const abilityScores={...before.abilityScores,...(configuration.charisma!==undefined?{CHA:configuration.charisma}:{})};
    const after:CharacterConfiguration={classId:configuration.classId==='homebrew'?(before.classId&&!(before.classId in CLASS_NAMES)?before.classId:undefined):configuration.classId,level:configuration.level,ruleset:configuration.classId==='homebrew'?'homebrew':'dnd5e_2014',abilityScores:Object.keys(abilityScores).length?abilityScores:undefined};
    const requested=classResources(configuration);const resources:ClassPreview['resources']=[];const warnings:string[]=[];
    for(const {key,template:draft}of requested){
      const old=snapshot.resources.find(resource=>resource.presetKey===key);
      const template:ResourceTemplate={...draft,id:stableId(`${characterId}:${snapshot.revision}:${key}:template`),key:key,source:'class_2014',version:1};
      const overrides=old?.overrides??{scope:'character' as const};const max=maximums(template,after,overrides);
      const next:ResourceView={id:old?.id??stableId(`${characterId}:${snapshot.revision}:${key}:instance`),characterId,templateId:template.id,presetKey:key,template,overrides,name:overrides.nameOverride??template.name,unit:template.unit,kind:template.kind,unlimited:overrides.unlimitedOverride??template.unlimited,...max,...(template.kind==='counter'?{remaining:max.capacity}:{remainingByLevel:max.capacityByLevel})};
      preserveSpent(old,next);resources.push({id:next.id,name:next.name,disposition:old?'update':'create',before:old,after:next});
      if(old&&(overrides.capacityOverride!==undefined||overrides.slotCapacityOverride))warnings.push(`${old.name}: 수동 최대치 설정을 유지합니다.`);
      if(old?.unlimited&&!next.unlimited)warnings.push(`${old.name}: 무제한에서 유한으로 변경하여 현재량 0으로 시작합니다.`);
    }
    const keys=new Set(requested.map(resource=>resource.key));
    for(const old of snapshot.resources.filter(resource=>!keys.has(resource.presetKey??''))){
      if(old.presetKey){
        const next=structuredClone(old);delete next.presetKey;
        if(next.kind==='counter')next.overrides.capacityOverride=next.capacity;else next.overrides.slotCapacityOverride=next.capacityByLevel;
        resources.push({id:old.id,name:old.name,before:old,after:configuration.retire==='keep'?next:undefined,disposition:configuration.retire==='keep'?'keep':'archive'});
      }else{
        const max=maximums(old.template,after,old.overrides);const next=preserveSpent(old,{...structuredClone(old),...max});
        resources.push({id:old.id,name:old.name,before:old,after:next,disposition:'keep'});
      }
    }
    const quote=hash({configuration,before,rows,resources,revision:snapshot.revision});
    if(configuration.retire==='keep'&&resources.some(resource=>resource.before?.presetKey&&!resource.after?.presetKey))warnings.push('이전 클래스/레벨에서 사라지는 자원은 수동 자원으로 유지합니다. 현재 클래스의 규칙상 사용 가능 여부는 직접 확인하세요.');
    return {revision:snapshot.revision,quote,before,after,resources,warnings,requiresRetireConfirmation:resources.some(resource=>resource.disposition==='archive')};
  }
  apply(characterId:string,input:ClassInput,quote:string,confirmRetire:boolean):{undo:ClassUndo;label:string} {
    const preview=this.preview(characterId,input);
    if(preview.quote!==quote)throw new UserInputError('클래스/자원 설정이 바뀌었습니다. 변경 미리보기를 다시 확인해 주세요.');
    if(preview.requiresRetireConfirmation&&!confirmRetire)throw new UserInputError('기존 자원 연결 해제에 별도로 동의해 주세요.');
    const before=this.capture(characterId);
    this.db.prepare('UPDATE character_profiles SET class_id=?,level=?,ruleset=?,ability_scores_json=? WHERE id=?').run(preview.after.classId??null,preview.after.level,preview.after.ruleset,preview.after.abilityScores?JSON.stringify(preview.after.abilityScores):null,characterId);
    for(const item of preview.resources){
      const resource=item.after;
      if(!resource){this.db.prepare('UPDATE resource_instances SET archived_at=? WHERE id=? AND character_id=?').run(new Date().toISOString(),item.id,characterId);continue;}
      if(item.disposition==='create'||item.disposition==='update')this.db.prepare('INSERT INTO resource_templates(id,key,name,kind,definition_json,source,version) VALUES (?,?,?,?,?,?,?)').run(resource.template.id,resource.template.key,resource.template.name,resource.template.kind,JSON.stringify(resource.template),'class_2014',1);
      const state=resource.kind==='counter'?{remaining:resource.remaining}:{remainingByLevel:resource.remainingByLevel};
      this.db.prepare(`INSERT INTO resource_instances(id,character_id,template_id,overrides_json,current_state_json,preset_key) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET template_id=excluded.template_id,overrides_json=excluded.overrides_json,current_state_json=excluded.current_state_json,preset_key=excluded.preset_key`).run(resource.id,characterId,resource.templateId,JSON.stringify(resource.overrides),JSON.stringify(state),resource.presetKey??null);
    }
    return {undo:{before,after:this.capture(characterId)},label:`${preview.after.classId?CLASS_NAMES[preview.after.classId as keyof typeof CLASS_NAMES]??'홈브루':'홈브루'} ${preview.after.level}레벨 적용`};
  }
  undo(characterId:string,undo:ClassUndo):void {
    const current=this.capture(characterId);const expected=new Map(undo.after.rows.map(row=>[row.id,row]));
    if(hash(current.profile)!==hash(undo.after.profile)||undo.after.rows.some(row=>hash(current.rows.find(value=>value.id===row.id))!==hash(row))||current.rows.some(row=>!row.archived_at&&!expected.has(row.id)))throw new UserInputError('클래스 변경 이후 상태가 일치하지 않아 실행 취소할 수 없습니다.');
    this.db.prepare('UPDATE character_profiles SET class_id=?,level=?,ruleset=?,ability_scores_json=? WHERE id=?').run(undo.before.profile.class_id,undo.before.profile.level,undo.before.profile.ruleset,undo.before.profile.ability_scores_json,characterId);
    const oldIds=new Set(undo.before.rows.map(row=>row.id));
    for(const row of undo.after.rows)if(!oldIds.has(row.id))this.db.prepare('UPDATE resource_instances SET archived_at=?,preset_key=NULL WHERE id=? AND character_id=?').run(new Date().toISOString(),row.id,characterId);
    // Clear ownership before restoration to avoid a transient partial unique-index conflict.
    this.db.prepare('UPDATE resource_instances SET preset_key=NULL WHERE character_id=?').run(characterId);
    for(const row of undo.before.rows)this.db.prepare('UPDATE resource_instances SET template_id=?,overrides_json=?,current_state_json=?,archived_at=?,preset_key=? WHERE id=? AND character_id=?').run(row.template_id,row.overrides_json,row.current_state_json,row.archived_at,row.preset_key,row.id,characterId);
  }
}
