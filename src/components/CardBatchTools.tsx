import { TrashReview } from './TrashManager';
import type { TrashAction, TrashResult } from '../shared/trash';
import { useState } from 'react';
import type { Deck, Tag } from '../shared/contracts';
import type { EditAction } from '../shared/bulk';
import { BatchReview } from './BatchEdits';

/**
 * Selection-management bar. The first row is always visible (select all / clear / end selection);
 * card edits and the move to the trash only appear once "선택 카드 일괄 작업" is expanded.
 */
export function CardBatchTools({ids,visibleCount,scopeLabel,tags,decks,activeDeck,onAll,onClear,onExit,onSaved,onTrashed}:{ids:string[];visibleCount:number;scopeLabel:string;tags:Tag[];decks:Deck[];activeDeck?:Deck;onAll:()=>void;onClear:()=>void;onExit:()=>void;onSaved:()=>Promise<void>;onTrashed:(result:TrashResult)=>Promise<void>}) {
  const [trashAction,setTrashAction]=useState<TrashAction>();
  const [add,setAdd]=useState<string[]>([]);const [remove,setRemove]=useState<string[]>([]);const [deckId,setDeckId]=useState('');const [action,setAction]=useState<EditAction>();
  const members=ids.filter(id=>activeDeck?.cardIds.includes(id));
  return <section className="batch-tools" aria-label="카드 선택 관리">
    <p role="status">현재 필터 {visibleCount}장 중 {ids.length}장 선택 · 전체 선택은 현재 표시 카드만 포함합니다.</p>
    <div className="batch-actions"><button onClick={onAll}>표시 카드 전체 선택</button><button onClick={onClear}>카드 선택 해제</button><button className="batch-exit" onClick={onExit}>선택 관리 종료</button></div>
    <details><summary>선택 카드 일괄 작업</summary>
      <fieldset><legend>태그 추가·제거 · 공통 카드 정의</legend>{tags.map(tag=><div className="batch-tag" key={tag.id}><strong>{tag.name}</strong><label><input type="checkbox" checked={add.includes(tag.id)} onChange={e=>{setAdd(e.target.checked?[...add,tag.id]:add.filter(id=>id!==tag.id));setRemove(remove.filter(id=>id!==tag.id));}}/>추가</label><label><input type="checkbox" checked={remove.includes(tag.id)} onChange={e=>{setRemove(e.target.checked?[...remove,tag.id]:remove.filter(id=>id!==tag.id));setAdd(add.filter(id=>id!==tag.id));}}/>제거</label></div>)}{!tags.length&&<p>태그 관리에서 태그를 먼저 등록해 주세요.</p>}<button disabled={!ids.length||!add.length&&!remove.length} onClick={()=>setAction({type:'card_tags',cardIds:ids,addTagIds:add,removeTagIds:remove})}>선택 카드 태그 변경</button></fieldset>
      <div className="batch-actions"><button disabled={!activeDeck||!members.length} onClick={()=>activeDeck&&setAction({type:'deck_cards',deckId:activeDeck.id,operation:'remove',cardIds:members})}>현재 덱에서 {members.length}장 제거</button><label>추가할 덱<select aria-label="일괄 추가할 덱" value={deckId} onChange={e=>setDeckId(e.target.value)}><option value="">다른 덱 선택</option>{decks.filter(d=>d.id!==activeDeck?.id).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><button disabled={!ids.length||!deckId} onClick={()=>setAction({type:'deck_cards',deckId,operation:'add',cardIds:ids})}>선택 카드 다른 덱에 추가</button></div>
      <fieldset className="batch-trash"><legend>휴지통 이동</legend>
        <p className="batch-trash-scope" aria-live="polite">대상 <strong>{ids.length}장</strong> · 범위: {scopeLabel}의 현재 필터 결과 {visibleCount}장 중 선택한 카드</p>
        <button className="trash-move" disabled={!ids.length} onClick={()=>setTrashAction({type:'move',cardIds:ids})}>선택 카드 휴지통으로 이동</button>
        <p className="muted">이동 전에 확인 창에서 카드·캐릭터·덱 영향을 보여 줍니다. 휴지통에서 원래 ID와 설정 그대로 복원할 수 있습니다.</p>
      </fieldset>
    </details>
    {action&&<BatchReview action={action} onClose={()=>setAction(undefined)} onSaved={onSaved}/>}{trashAction&&<TrashReview action={trashAction} onDone={onTrashed} onClose={()=>setTrashAction(undefined)}/>}
  </section>;
}
