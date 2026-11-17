import { UseHistory } from './UseHistory';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ResourceAction, ResourceSnapshot, ResourcePreview, RecoveryTrigger, ResourceView } from '../shared/resources';
import { CLASS_NAMES } from '../shared/class-contracts';
import { Modal } from './Modal';

export function useResources(characterId?: string) {
  const [stored, setStored] = useState<ResourceSnapshot>(); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const pending = useRef(false); const live = useRef(characterId); live.current = characterId;
  const snapshot = stored?.characterId === characterId ? stored : undefined;
  const latest = useRef(snapshot); latest.current = snapshot;
  const refresh = useCallback(async () => {
    if (!characterId) return;
    try { const result = await window.desktop.getResources(characterId); if (live.current !== characterId) return; if (result.ok) { setStored(result.value); setError(''); } else setError(result.error); }
    catch { if (live.current === characterId) setError('자원 상태를 읽지 못했습니다. 다시 불러와 주세요.'); }
  }, [characterId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const perform = useCallback(async (action: ResourceAction, revision?: number): Promise<boolean> => {
    const current = latest.current;
    if (pending.current || !current || !characterId) return false;
    pending.current = true; setBusy(true); setError('');
    try {
      const result = await window.desktop.changeResource({ requestId: crypto.randomUUID(), characterId, expectedRevision: revision ?? current.revision, action });
      if (live.current === characterId) { if (result.ok) setStored(result.value.snapshot); else { setError(result.error); await refresh(); setError(result.error); } }
      return result.ok;
    } catch { if (live.current === characterId) setError('자원 변경 결과를 확인하지 못했습니다. 다시 불러온 상태를 확인해 주세요.'); await refresh(); return false; }
    finally { pending.current = false; setBusy(false); }
  }, [characterId, refresh]);
  return { snapshot, busy, error: characterId ? error : '', perform, refresh };
}
export type ResourceController = ReturnType<typeof useResources>;
export function ChangeList({ preview, resources }: { preview: { changes: ResourcePreview['changes'] }; resources: ResourceView[] }) {
  return preview.changes.length ? <ul className="change-list">{preview.changes.map(change => <li key={`${change.resourceInstanceId}-${change.slotLevel}`}><span>{resources.find(resource => resource.id === change.resourceInstanceId)?.name ?? '자원'}{change.slotLevel !== undefined ? ` · ${change.slotLevel}레벨` : ''}</span><strong><small>{change.after<change.before?'−':'+'}{Math.abs(change.after-change.before)}</small> {change.before} → {change.after < 0 ? '부족' : change.after}</strong></li>)}</ul> : <p className="muted">현재량 변경이 없습니다.</p>;
}
export function ResourcePanel({ controller }: { controller: ResourceController }) {
  const rowPrefix=useId();const [expanded,setExpanded]=useState<Set<string>>(()=>new Set());
  const [historyOpen,setHistoryOpen]=useState(false);
  const { snapshot, busy, error, perform } = controller;
  const [recovery, setRecovery] = useState<{ trigger: RecoveryTrigger; preview: ResourcePreview }>();
  const [manual, setManual] = useState<{ resource: ResourceView; slotLevel?: number; before: number; maximum: number; revision: number }>();
  const [manualValue, setManualValue] = useState(0); const [localError, setLocalError] = useState('');
  async function rest(trigger: RecoveryTrigger) {
    if (!snapshot || busy) return; setLocalError('');
    try { const result = await window.desktop.previewResource({ characterId: snapshot.characterId, action: { type: 'recover', trigger } }); if (result.ok) setRecovery({ trigger, preview: result.value }); else setLocalError(result.error); }
    catch { setLocalError('회복 미리보기를 읽지 못했습니다.'); }
  }
  function track(resource: ResourceView, current: number, maximum: number, slotLevel?: number) {
    const key=`${resource.id}:${slotLevel??'counter'}`;const open=expanded.has(key);const name=`${resource.name}${slotLevel!==undefined?` ${slotLevel}레벨`:''}`;const controls=`${rowPrefix}-${encodeURIComponent(key)}`;
    return <div className={`resource-track ${open?'expanded':''}`} key={key}><button className="resource-status-row" aria-label={`${name} 상태·수정`} aria-expanded={open} aria-controls={controls} onClick={()=>setExpanded(previous=>{const next=new Set(previous);if(next.has(key))next.delete(key);else next.add(key);return next;})}><span className="resource-name">{slotLevel!==undefined?`${slotLevel}레벨`:resource.name}</span><strong aria-label={`${name} 현재량`}>{resource.unlimited?'∞':`${current} / ${maximum}`}</strong>{!resource.unlimited&&<meter min={0} max={Math.max(1,maximum)} value={current} aria-label={`${name} 잔여량`}>{current} / {maximum}</meter>}{!resource.unlimited&&current===0&&<small className="exhausted-label">소진</small>}<span aria-hidden="true">{open?'⌃':'⌄'}</span></button>{open&&<div className="resource-expanded" id={controls}><p>{resource.unlimited?'무제한 · 현재량을 차감하지 않습니다.':`${resource.unit} · ${resource.overrides.scope==='character'?'캐릭터 공유':resource.overrides.scope==='card'?'카드 전용':'아이템 소유'}`}</p><p>회복: {resource.template.recovery.flatMap(rule=>rule.triggers.map(t=>({short_rest:'짧은 휴식',long_rest:'긴 휴식',dawn:'새벽 경과',manual:'수동 회복'})[t])).join(' · ')||'수동 조정만'}</p>{!resource.unlimited&&<div className="resource-adjust"><button disabled={busy||current===0} aria-label={`${name} 1 감소`} onClick={()=>void perform({type:'adjust',resourceId:resource.id,slotLevel,delta:-1})}>−</button><button disabled={busy||current>=maximum} aria-label={`${name} 1 증가`} onClick={()=>void perform({type:'adjust',resourceId:resource.id,slotLevel,delta:1})}>+</button><button disabled={busy} onClick={()=>{setManual({resource,slotLevel,before:current,maximum,revision:snapshot!.revision});setManualValue(current);}}>수동 조정</button></div>}</div>}</div>;
  }
  const groups=[{key:'standard',name:'일반 주문 슬롯'},{key:'pact',name:'계약 마법 슬롯'},{key:'counter',name:'횟수·포인트'},{key:'generic',name:'기타 자원 트랙'}];
  return <div className="live-resources">
    {snapshot?.profile&&<p className="class-summary">{CLASS_NAMES[snapshot.profile.classId as keyof typeof CLASS_NAMES]??'홈브루 / 미지정'} · {snapshot.profile.level}레벨</p>}
    {!snapshot?<p className="empty-state">캐릭터를 선택하면 자원을 확인할 수 있습니다.</p>:<>
      <div className="resource-scroll" aria-label="자원 목록 스크롤"><div className="resource-list">{snapshot.resources.length?groups.map(group=>{
        const items=snapshot.resources.filter(r=>(r.kind==='counter'?'counter':r.template.slotKind??'generic')===group.key);if(!items.length)return null;
        return <details open className="resource-group" key={group.key}><summary>{group.name}<small>{items.length}개 자원</small></summary>{items.map(resource=><section className="resource-entry" key={resource.id}>{resource.kind==='slot_track'&&<h3>{resource.name}</h3>}{resource.kind==='counter'?track(resource,resource.remaining??0,resource.capacity??0):Object.keys(resource.capacityByLevel!).map(level=>track(resource,resource.remainingByLevel![level],resource.capacityByLevel![level],Number(level)))}</section>)}</details>;
      }):<p className="empty-state">상단 관리 메뉴에서 자원을 만들거나 장착하세요.</p>}</div>
      <details className="resource-history"><summary>최근 작업 · {snapshot.events.length}</summary><ol>{snapshot.events.slice(0,12).map(event=><li key={event.id}><strong>{event.label}{event.classUndo?' · 클래스 변경':''}{event.override?' · 예외 미차감':''}</strong>{event.selectedSlotLevels&&Object.keys(event.selectedSlotLevels).length>0&&<small>시전 슬롯 {Object.values(event.selectedSlotLevels).join(' / ')}레벨</small>}<span>{new Date(event.timestamp).toLocaleTimeString('ko-KR')}</span>{event.changes.map((change,i)=><small key={i}>{snapshot.resources.find(r=>r.id===change.resourceInstanceId)?.name??'이전 자원'}{change.slotLevel?` ${change.slotLevel}레벨`:''}: {change.before} → {change.after}</small>)}</li>)}</ol><button onClick={()=>setHistoryOpen(true)}>전체 카드 사용 기록</button></details>
      {snapshot.warnings.map((warning,i)=><p className="resource-error" key={i}>{warning}</p>)}</div>
      <div className="resource-footer"><div className="rest-buttons">{(['short_rest','long_rest','dawn','manual']as RecoveryTrigger[]).map(trigger=><button key={trigger} disabled={busy} onClick={()=>void rest(trigger)}>{({short_rest:'짧은 휴식',long_rest:'긴 휴식',dawn:'새벽 경과',manual:'수동 회복'})[trigger]}</button>)}</div><button className="undo-button" disabled={busy||!snapshot.undoTargetId} onClick={()=>void perform({type:'undo'})}>직전 자원 변경 실행 취소</button></div>
    </>}
    {(error || localError) && <p role="alert" className="resource-error">{error || localError}<button onClick={() => void controller.refresh()}>다시 불러오기</button></p>}
    {historyOpen&&snapshot&&<UseHistory characterId={snapshot.characterId} onClose={()=>setHistoryOpen(false)}/>}
    {recovery && snapshot && <Modal title={`${recovery.preview.label} 확인`} onClose={() => setRecovery(undefined)}><ChangeList preview={recovery.preview} resources={snapshot.resources} /><p className="muted">게임 내 회복 이벤트를 지금 적용합니다.</p><div className="modal-actions"><button onClick={() => setRecovery(undefined)}>취소</button><button disabled={busy} onClick={async () => { if (await perform({ type: 'recover', trigger: recovery.trigger },recovery.preview.revision)) setRecovery(undefined); }}>회복 확정</button></div>{error && <p role="alert" className="error-banner">{error}</p>}</Modal>}
    {manual && <Modal title="자원 수동 조정" onClose={() => setManual(undefined)}><p>{manual.resource.name}{manual.slotLevel ? ` ${manual.slotLevel}레벨` : ''}: {manual.before} / {manual.maximum}</p><label className="form-field">새 현재량<input type="number" min={0} max={manual.maximum} step={1} value={manualValue} onChange={event => setManualValue(Number(event.target.value))} /></label><div className="modal-actions"><button onClick={() => setManual(undefined)}>취소</button><button disabled={busy || !Number.isInteger(manualValue) || manualValue < 0 || manualValue > manual.maximum} onClick={async () => { if (await perform({ type: 'adjust', resourceId: manual.resource.id, slotLevel: manual.slotLevel, delta: manualValue - manual.before },manual.revision)) setManual(undefined); }}>현재량 변경 확정</button></div>{error && <p role="alert" className="error-banner">{error}</p>}</Modal>}
  </div>;
}
