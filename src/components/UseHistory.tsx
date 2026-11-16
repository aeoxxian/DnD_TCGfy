import { useEffect, useState } from 'react';
import type { UseHistory as History } from '../shared/trash';
import { Modal } from './Modal';
import { cardSchema } from '../shared/contracts';

export function UseHistory({characterId,onClose}:{characterId:string;onClose:()=>void}) {
  const [history,setHistory]=useState<History>();const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  useEffect(()=>{let live=true;void window.desktop.getUseHistory({characterId}).then(r=>{if(live){if(r.ok)setHistory(r.value);else setError(r.error);}}).catch(()=>{if(live)setError('사용 기록을 읽지 못했습니다.');});return()=>{live=false;};},[characterId]);
  async function more(){if(!history?.nextRow||busy)return;setBusy(true);try{const r=await window.desktop.getUseHistory({characterId,beforeRow:history.nextRow});if(r.ok)setHistory({events:[...history.events,...r.value.events],nextRow:r.value.nextRow});else setError(r.error);}catch{setError('사용 기록을 더 읽지 못했습니다.');}finally{setBusy(false);}}
  return <Modal title="카드 사용 기록" wide onClose={onClose}><p>휴지통 이동·영구 삭제와 관계없이 당시 사용 기록을 표시합니다.</p>{history?.events.length===0&&<p>카드 사용 기록이 없습니다.</p>}<ol className="use-history-list">{history?.events.map(event=>{
    const parsed=cardSchema.shape.castOptions.element.safeParse(event.costSnapshot?.option);
    const option=parsed.success?parsed.data:undefined;
    return <li key={event.id}><h3>{typeof event.costSnapshot?.name==='string'?event.costSnapshot.name:event.label}</h3>{event.costSnapshot?.nameAtDeletion&&<p>이전 기록에 이름이 없어 삭제 시점의 카드 이름을 표시합니다.</p>}<p>{new Date(event.timestamp).toLocaleString()} · {option?.label??'당시 비용 정보 없음'}</p>{!option||event.costSnapshot?.unavailable?<p>이전 기록의 당시 비용이 없거나 불완전하여 복원할 수 없습니다.</p>:<p>당시 비용: {option.costs.map(cost=>cost.type==='slot'?`${cost.slotSelection==='pact'?'계약':'일반'} 슬롯 1개`:cost.type==='fixed'?`${cost.slotLevel?cost.slotLevel+'레벨 ':''}${cost.amount} 소모`:`선택형 ${cost.min}~${cost.max}`).join(' + ')||'무소모'}</p>}{event.selectedSlotLevels&&Object.keys(event.selectedSlotLevels).length>0&&<p>시전 슬롯: {Object.values(event.selectedSlotLevels).join(' / ')}레벨</p>}{event.changes.map((change,i)=><p key={i}>실제 자원{change.slotLevel?` ${change.slotLevel}레벨`:''}: {change.before} → {change.after}</p>)}</li>;
  })}</ol>{history?.nextRow&&<button disabled={busy} onClick={()=>void more()}>이전 사용 기록 더 보기</button>}{error&&<p role="alert">{error}</p>}</Modal>;
}
