import { useEffect, useRef, useState } from 'react';
import type { EditAction, EditBatch, EditPreview } from '../shared/bulk';
import { Modal } from './Modal';

export function BatchReview({action,onSaved,onClose}:{action:EditAction;onSaved:()=>Promise<void>;onClose:()=>void}) {
  const [preview,setPreview]=useState<EditPreview>(); const [error,setError]=useState(''); const [confirmed,setConfirmed]=useState(false); const [busy,setBusy]=useState(false);
  const requestId=useRef(crypto.randomUUID()); const pending=useRef(false);
  useEffect(()=>{let live=true; void window.desktop.previewEdit(action).then(result=>{if(live){if(result.ok)setPreview(result.value);else setError(result.error);}}).catch(()=>{if(live)setError('변경 범위를 불러오지 못했습니다.');});return()=>{live=false;};},[action]);
  async function commit(){
    if(!preview||pending.current)return;pending.current=true;setBusy(true);setError('');
    try{const result=await window.desktop.applyEdit({requestId:requestId.current,action,quote:preview.quote,confirmImpact:confirmed});if(!result.ok){setError(result.error);return;}await onSaved();onClose();}
    catch{setError('처리 결과를 확인하지 못했습니다. 복원 기록과 현재 상태를 확인해 주세요.');}
    finally{pending.current=false;setBusy(false);}
  }
  return <Modal title="일괄 변경 미리보기" onClose={()=>{if(!busy)onClose();}}><div aria-busy={!preview&&!error}>
    {!preview&&!error&&<p>변경 범위를 확인하는 중…</p>}
    {preview&&<><h3>{preview.label}</h3><ul>{preview.details.map((detail,i)=><li key={i}>{detail}</li>)}</ul><p>선택 대상 {preview.targets.length}개: {preview.targets.join(' · ')}</p><p>영향 캐릭터 {preview.characters.length}명: {preview.characters.join(' · ')||'현재 참조 없음'}</p><p className="manager-help">한 번의 일괄 편집 기록으로 저장합니다. 환경 설정의 ‘일괄 편집 복원’에서 되돌릴 수 있습니다. 이후 변경과 충돌하면 복원하지 않습니다.</p>{preview.requiresImpact&&<label className="checkbox-line"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>공통 데이터와 다른 캐릭터에 미치는 영향을 확인했습니다.</label>}</>}
    {error&&<p role="alert" className="error-banner">{error}</p>}<div className="modal-actions"><button disabled={busy} onClick={onClose}>취소</button><button disabled={!preview||busy||!!error||preview.requiresImpact&&!confirmed} onClick={()=>void commit()}>{action.type==='restore'?'일괄 편집 복원 확정':'일괄 변경 확정'}</button></div>
  </div></Modal>;
}

export function EditHistory({onSaved,onClose}:{onSaved:()=>Promise<void>;onClose:()=>void}) {
  const [batches,setBatches]=useState<EditBatch[]>([]); const [error,setError]=useState(''); const [action,setAction]=useState<EditAction>();
  async function refresh(){try{const result=await window.desktop.getEditHistory();if(result.ok)setBatches(result.value);else setError(result.error);}catch{setError('일괄 편집 기록을 읽지 못했습니다.');}}
  useEffect(()=>{let live=true;void window.desktop.getEditHistory().then(r=>{if(live){if(r.ok)setBatches(r.value);else setError(r.error);}}).catch(()=>{if(live)setError('일괄 편집 기록을 읽지 못했습니다.');});return()=>{live=false;};},[]);
  return <Modal title="일괄 편집 복원" wide onClose={onClose}><p>카드·덱·자원 설정의 일괄 작업 기록입니다. 자원 사용·수동 조정의 Undo는 왼쪽 자원 패널에서 수행하세요.</p>{error&&<p role="alert">{error}</p>}{!batches.length&&<p>일괄 편집 기록이 없습니다.</p>}<div className="module-list">{batches.map(batch=><section className="module-row" key={batch.id}><div><strong>{batch.label}</strong><p>{new Date(batch.createdAt).toLocaleString()} · {batch.targets.length}개 대상</p><p>{batch.details.join(' / ')}</p></div><button disabled={!!batch.restoredAt} onClick={()=>setAction({type:'restore',batchId:batch.id})}>{batch.restoredAt?'복원 완료':'이 작업 복원'}</button></section>)}</div>{action&&<BatchReview action={action} onClose={()=>setAction(undefined)} onSaved={async()=>{await refresh();await onSaved();}}/>}</Modal>;
}
