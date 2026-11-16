import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { cardSchema, type CardDefinition } from '../src/shared/contracts';
import { trashActionSchema, trashCommitSchema, type TrashAction, type TrashDeck, type TrashState, type TrashResult, type TrashPreview } from '../src/shared/trash';
import type { AppStore } from './store';
import { transaction } from './migrations';
import { UserInputError } from './errors';

type Row=Record<string,string|number|null>;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function moveCardsToTrash(db:DatabaseSync,ids:string[],batchId:string) {
  const now=new Date().toISOString();
  for(const id of ids){
    if(!db.prepare('SELECT id FROM card_definitions WHERE id=? AND archived_at IS NULL').get(id))throw new UserInputError('현재 라이브러리에 없는 카드입니다.');
    const decks=db.prepare('SELECT d.id,d.name,d.character_id AS characterId,p.name AS characterName,dc.position FROM deck_cards dc JOIN decks d ON d.id=dc.deck_id JOIN character_profiles p ON p.id=d.character_id WHERE dc.card_id=? ORDER BY d.id').all(id);
    db.prepare('INSERT INTO card_trash VALUES (?,?,?,?)').run(id,now,batchId,JSON.stringify(decks));
    db.prepare('UPDATE card_definitions SET archived_at=? WHERE id=?').run(now,id);
    db.prepare('DELETE FROM deck_cards WHERE card_id=?').run(id);
  }
}

export class TrashStore {
  readonly db;
  constructor(store:AppStore){this.db=store.db;}
  private card(id:string,trashed:boolean):Row {
    const row=this.db.prepare(`SELECT c.* FROM card_definitions c ${trashed?'JOIN card_trash t ON t.card_id=c.id':''} WHERE c.id=? AND c.archived_at IS ${trashed?'NOT ':''}NULL`).get(id) as Row|undefined;
    if(!row)throw new UserInputError(trashed?'휴지통에 없는 카드입니다.':'현재 라이브러리에 없는 카드입니다.');return row;
  }
  private readCard(row:Row):CardDefinition {
    return cardSchema.parse({...JSON.parse(String(row.attributes_json)),id:row.id,name:row.name,kind:row.kind,imageAssetId:row.image_asset_id??undefined,spellLevel:row.spell_level??undefined,tags:(this.db.prepare('SELECT tag_id FROM card_tags WHERE card_id=? ORDER BY rowid').all(row.id) as {tag_id:string}[]).map(t=>t.tag_id),createdAt:row.created_at,updatedAt:row.updated_at});
  }
  private decks(id:string,trashed:boolean):TrashDeck[] {
    return trashed?JSON.parse(String(this.db.prepare('SELECT decks_json FROM card_trash WHERE card_id=?').get(id)!.decks_json)):this.db.prepare('SELECT d.id,d.name,d.character_id AS characterId,p.name AS characterName,dc.position FROM deck_cards dc JOIN decks d ON d.id=dc.deck_id JOIN character_profiles p ON p.id=d.character_id WHERE dc.card_id=? ORDER BY d.id').all(id) as unknown as TrashDeck[];
  }
  state(input?:unknown):TrashState {
    z.undefined().parse(input);const warnings:string[]=[];const cards:TrashState['cards']=[];
    for(const row of this.db.prepare('SELECT c.*,t.deleted_at,t.decks_json FROM card_trash t JOIN card_definitions c ON c.id=t.card_id WHERE c.archived_at IS NOT NULL ORDER BY t.deleted_at DESC,c.id').all() as Row[]){
      try{cards.push({card:this.readCard(row),deletedAt:String(row.deleted_at),decks:JSON.parse(String(row.decks_json))});}catch{warnings.push(`“${row.name}”의 저장 정보가 불완전합니다. 데이터는 보존했습니다.`);}
    }
    return{cards,warnings,pendingImages:Number(this.db.prepare('SELECT count(*) AS n FROM asset_cleanup').get()!.n)};
  }
  private ids(action:TrashAction):string[]{return action.type==='empty'?(this.db.prepare('SELECT card_id FROM card_trash ORDER BY card_id').all() as {card_id:string}[]).map(r=>r.card_id):action.cardIds;}
  private batches(ids:string[]) {
    return (this.db.prepare('SELECT * FROM edit_batches WHERE invalidated_at IS NULL').all() as Row[]).filter(row=>{
      const visit=(value:unknown):boolean=>typeof value==='string'?ids.includes(value):Array.isArray(value)?value.some(visit):!!value&&typeof value==='object'?Object.values(value).some(visit):false;
      return visit(JSON.parse(String(row.action_json)))||visit(JSON.parse(String(row.patches_json)));
    });
  }
  private assets(ids:string[]) {
    const candidates=new Set(ids.flatMap(id=>(this.db.prepare('SELECT asset_id FROM card_asset_history WHERE card_id=? UNION SELECT image_asset_id FROM card_definitions WHERE id=? AND image_asset_id IS NOT NULL').all(id,id) as {asset_id:string}[]).map(r=>r.asset_id)));
    const removable:string[]=[];const shared:string[]=[];
    for(const id of candidates){const users=this.db.prepare('SELECT card_id FROM card_asset_history WHERE asset_id=? UNION SELECT id FROM card_definitions WHERE image_asset_id=?').all(id,id) as {card_id:string}[];(users.some(row=>!ids.includes(row.card_id))?shared:removable).push(id);}
    return{removable,shared};
  }
  private plan(action:TrashAction):TrashPreview & {ids:string[]} {
    const ids=this.ids(action);if(!ids.length)throw new UserInputError('휴지통이 비어 있습니다.');
    const rows=ids.map(id=>this.card(id,action.type!=='move'));const originalDecks=ids.flatMap(id=>this.decks(id,action.type!=='move'));
    const currentDecks=this.db.prepare('SELECT * FROM decks ORDER BY id').all();const membership=this.db.prepare('SELECT * FROM deck_cards ORDER BY deck_id,position').all();
    const characters=new Set(originalDecks.map(d=>d.characterName));
    for(const id of ids)for(const row of this.db.prepare('SELECT DISTINCT p.name FROM character_profiles p JOIN card_bindings b ON b.character_id=p.id WHERE b.card_id=? UNION SELECT p.name FROM character_profiles p JOIN character_cost_overrides o ON o.character_id=p.id WHERE o.card_id=?').all(id,id))characters.add(String(row.name));
    const purging=action.type==='purge'||action.type==='empty';const assets=purging?this.assets(ids):{removable:[],shared:[]};const batches=purging?this.batches(ids):[];
    const notes=action.type==='move'?['선택 카드가 일반 라이브러리와 모든 덱·플레이 보드에서 일시적으로 사라집니다.','카드 정보·이미지·비용·이전 덱 소속·사용 이력과 자원 상태는 보존합니다.']:action.type==='restore'?['카드 ID·메타데이터·비용을 유지하여 복원합니다. 현재 덱 구성은 덮어쓰지 않습니다.','존재하는 원래 덱에 빠진 연결만 추가합니다. 사라진 덱은 건너뛰고 안내합니다.']:['영구 삭제하면 앱에서 복원할 수 없으며 자원 사용 Undo의 대상이 아닙니다.','카드 메타데이터·태그 연결·비용 재정의·덱/자원 연결과 비공유 관리 이미지를 제거합니다. 과거 사용 기록과 당시 이름·비용 스냅샷, 자원 현재량은 보존합니다.',`관리 이미지 ${assets.removable.length}개 정리 / 공유 이미지 ${assets.shared.length}개 보존. 파일 삭제 실패는 대기열에서 재시도합니다.`,`관련 일괄 편집 기록 ${batches.length}건은 재생성을 막기 위해 내용을 지우고 복원 불가로 표시합니다. 혼합 작업의 복원도 제한됩니다.`,'앱 외부의 가져오기 원본과 기존 별도 백업, 소속을 판별할 수 없는 과거 미참조 파일은 변경하지 않습니다.'];
    const existing=new Set(currentDecks.map(d=>String(d.id)));if(action.type==='restore')for(const deck of originalDecks)if(!existing.has(deck.id))notes.push(`사라진 덱: ${deck.characterName} · ${deck.name} — 카드만 복원합니다.`);
    const names=rows.map(row=>String(row.name));const decks=[...new Set(originalDecks.map(d=>`${d.characterName} · ${d.name}`))];
    const costs=ids.map(id=>({bindings:this.db.prepare('SELECT * FROM card_bindings WHERE card_id=? ORDER BY id').all(id),overrides:this.db.prepare('SELECT * FROM character_cost_overrides WHERE card_id=? ORDER BY character_id').all(id)}));
    const quote=digest({action,ids,rows,originalDecks,currentDecks,membership,assets,batches,costs,characters:[...characters]});
    return{ids,quote,count:ids.length,names,characters:[...characters],decks,notes,requiresPhrase:purging&&(ids.length>1||action.type==='empty'),assetCount:assets.removable.length,sharedAssets:assets.shared.length,invalidatedBatches:batches.length};
  }
  preview(input:unknown):TrashPreview {const action=trashActionSchema.parse(input);return transaction(this.db,()=>{const {ids:_,...preview}=this.plan(action);void _;return preview;});}
  private preserveHistory(id:string,row:Row) {
    for(const event of this.db.prepare("SELECT id,payload_json FROM play_events WHERE event_type='card_used' AND json_extract(payload_json,'$.cardId')=?").all(id)){
      const payload=JSON.parse(String(event.payload_json));
      if(payload.costSnapshot?.name&&payload.costSnapshot?.option)continue;
      payload.costSnapshot={...payload.costSnapshot,nameAtDeletion:!payload.costSnapshot?.name,name:payload.costSnapshot?.name??row.name,spellLevel:payload.costSnapshot?.spellLevel??row.spell_level??undefined,option:payload.costSnapshot?.option??{id:'legacy-unknown',label:'당시 비용 정보 없음',costs:[]},unavailable:!payload.costSnapshot?.option};
      this.db.prepare('UPDATE play_events SET payload_json=? WHERE id=?').run(JSON.stringify(payload),String(event.id));
    }
  }
  change(input:unknown):TrashResult {
    const request=trashCommitSchema.parse(input);const fingerprint=digest(request);
    return transaction(this.db,()=>{
      const prior=this.db.prepare('SELECT * FROM trash_requests WHERE request_id=?').get(request.requestId);
      if(prior){if(prior.fingerprint!==fingerprint)throw new UserInputError('동일 요청 ID의 내용이 다릅니다.');return{...JSON.parse(String(prior.result_json)),replayed:true};}
      const p=this.plan(request.action);if(p.quote!==request.quote)throw new UserInputError('카드나 덱 연결이 바뀌었습니다. 확인 창을 다시 열어 주세요.');
      if(p.requiresPhrase&&request.phrase!=='영구 삭제')throw new UserInputError('확인 문구 “영구 삭제”를 정확히 입력해 주세요.');
      const warnings:string[]=[];const now=new Date().toISOString();
      if(request.action.type==='move')moveCardsToTrash(this.db,p.ids,request.requestId);
      else if(request.action.type==='restore')for(const id of p.ids){
        for(const deck of this.decks(id,true)){
          if(!this.db.prepare('SELECT id FROM decks WHERE id=? AND character_id=?').get(deck.id,deck.characterId)){warnings.push(`“${deck.name}” 덱이 없어 카드만 복원했습니다.`);continue;}
          if(!this.db.prepare('SELECT 1 FROM deck_cards WHERE deck_id=? AND card_id=?').get(deck.id,id))this.db.prepare('INSERT INTO deck_cards VALUES (?,?,(SELECT COALESCE(MAX(position),-1)+1 FROM deck_cards WHERE deck_id=?))').run(deck.id,id,deck.id);
        }
        this.db.prepare('UPDATE card_definitions SET archived_at=NULL WHERE id=?').run(id);this.db.prepare('DELETE FROM card_trash WHERE card_id=?').run(id);
      }
      else {
        const assets=this.assets(p.ids);const batches=this.batches(p.ids);
        for(const id of p.ids){const row=this.card(id,true);this.preserveHistory(id,row);
          this.db.prepare('DELETE FROM card_bindings WHERE card_id=?').run(id);this.db.prepare('DELETE FROM character_cost_overrides WHERE card_id=?').run(id);this.db.prepare('DELETE FROM deck_cards WHERE card_id=?').run(id);
          this.db.prepare('INSERT INTO purged_card_ids VALUES (?,?)').run(id,now);this.db.prepare('DELETE FROM card_definitions WHERE id=?').run(id);
        }
        for(const batch of batches){const summary={label:'영구 삭제에 관련된 일괄 기록',details:['카드 영구 삭제로 내용이 정리되어 이 작업은 복원할 수 없습니다.'],targets:[],characters:[],requiresImpact:false};this.db.prepare("UPDATE edit_batches SET action_json='{}',patches_json='[]',summary_json=?,label=?,invalidated_at=? WHERE id=?").run(JSON.stringify(summary),summary.label,now,String(batch.id));}
        for(const assetId of assets.removable)this.db.prepare('INSERT OR IGNORE INTO asset_cleanup(asset_id,queued_at) VALUES (?,?)').run(assetId,now);
      }
      const result:TrashResult={count:p.count,cardIds:p.ids,type:request.action.type,warnings:[...new Set(warnings)],replayed:false};
      this.db.prepare('INSERT INTO trash_requests VALUES (?,?,?,?,?)').run(request.requestId,fingerprint,JSON.stringify(request.action),JSON.stringify(result),now);return result;
    });
  }
}
