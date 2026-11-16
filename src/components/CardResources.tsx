import { useEffect, useState, type FormEvent } from 'react';
import type { CardDefinition, CastOption } from '../shared/contracts';
import type { ResourcePreview, ResourceSnapshot } from '../shared/resources';
import { planUse } from '../shared/resource-engine';
import { ChangeList, type ResourceController } from './ResourcePanel';
import { Modal } from './Modal';

export function cardResourceNote(card: CardDefinition, snapshot?: ResourceSnapshot): string {
  if (!snapshot) return '';
  let insufficient = false;
  for (const option of card.castOptions) {
    const choices = Object.fromEntries(option.costs.filter(cost => cost.type === 'variable').map(cost => [cost.costKey, cost.type === 'variable' ? cost.min : 0]));
    try { const plan = planUse(card,option.id,snapshot.resources,snapshot.bindings,choices); if(plan.canUse)return ''; insufficient ||= plan.canOverride; } catch { /* Selected-card preview gives the precise reason. */ }
  }
  return insufficient ? '자원 부족 · 열람 가능' : '비용 연결 확인';
}

export function CardUsage({ card, controller, onConfigure }: { card: CardDefinition; controller: ResourceController; onConfigure: () => void }) {
  const { snapshot, busy, perform, error } = controller;
  const [optionId,setOptionId] = useState(card.castOptions[0].id);
  const option = card.castOptions.find(option=>option.id===optionId) ?? card.castOptions[0];
  const [choices,setChoices] = useState<Record<string,number>>(()=>Object.fromEntries(option.costs.filter(cost=>cost.type==='variable').map(cost=>[cost.costKey,cost.type==='variable'?cost.min:0])));
  const [storedPreview,setStoredPreview] = useState<{key:string;value?:ResourcePreview;error?:string}>();
  const [override,setOverride] = useState(false);
  const previewKey=JSON.stringify({characterId:snapshot?.characterId,revision:snapshot?.revision,card:card.updatedAt,optionId:option.id,choices});
  useEffect(()=>{
    let live=true;
    if(!snapshot)return;
    void window.desktop.previewResource({characterId:snapshot.characterId,action:{type:'use',cardId:card.id,optionId:option.id,choices}}).then(result=>{
      if(live)setStoredPreview(result.ok?{key:previewKey,value:result.value}:{key:previewKey,error:result.error});
    }).catch(()=>{if(live)setStoredPreview({key:previewKey,error:'비용을 확인하지 못했습니다.'});});
    return()=>{live=false;};
  },[snapshot,card.id,option.id,choices,previewKey]);
  const preview=storedPreview?.key===previewKey?storedPreview.value:undefined;
  async function confirmUse(exception=false){if(!snapshot||!preview)return;if(await perform({type:'use',cardId:card.id,optionId:option.id,choices,quote:preview.quote,override:exception},preview.revision))setOverride(false);}
  return <section className={`card-use ${preview?.canOverride?'insufficient':''}`} aria-label="카드 사용 비용">
    <div className="cost-preview"><span>예상 비용</span><button disabled={!snapshot||busy} onClick={onConfigure}>비용 설정</button></div>
    {card.castOptions.length>1&&<label className="form-field">사용 방식<select aria-label="사용 방식" value={option.id} disabled={busy} onChange={event=>{setOptionId(event.target.value);const next=card.castOptions.find(option=>option.id===event.target.value)!;setChoices(Object.fromEntries(next.costs.filter(cost=>cost.type==='variable').map(cost=>[cost.costKey,cost.type==='variable'?cost.min:0])));}}>{card.castOptions.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select></label>}
    {option.costs.filter(cost=>cost.type==='variable').map((cost,index)=>cost.type==='variable'&&<label className="form-field" key={cost.costKey}>가변 소모량 {index+1}<input type="number" min={cost.min} max={cost.max} step={cost.step} value={choices[cost.costKey]??cost.min} disabled={busy} onChange={event=>setChoices({...choices,[cost.costKey]:Number(event.target.value)})}/></label>)}
    {!snapshot?<p className="selection-hint">캐릭터를 선택하면 비용을 연결하고 사용을 기록할 수 있습니다.</p>:preview?<><ChangeList preview={preview} resources={snapshot.resources}/>{preview.reason&&<p className="resource-error">{preview.reason}</p>}{preview.canUse&&preview.changes.length===0&&<p className="selection-hint">무소모 사용 · 기록만 남깁니다.</p>}</>:<p className="selection-hint">{storedPreview?.key===previewKey?storedPreview.error:'비용 확인 중…'}</p>}
    <button className="use-button" disabled={busy||!snapshot||!preview?.canUse} onClick={event=>{if(event.detail<=1)void confirmUse();}}>사용 확정</button>
    {preview?.canOverride&&<button className="exception-button" disabled={busy} onClick={()=>setOverride(true)}>예외 사용 · 자원 미차감</button>}
    {error&&<p className="resource-error" role="alert">{error}</p>}
    {override&&preview&&snapshot&&<Modal title="예외 사용 확인" onClose={()=>setOverride(false)}><p>자원이 부족합니다. 이번 사용은 자원을 전혀 차감하지 않고 예외 기록만 남깁니다.</p><ChangeList preview={preview} resources={snapshot.resources}/><div className="modal-actions"><button onClick={()=>setOverride(false)}>취소</button><button disabled={busy} onClick={event=>{if(event.detail<=1)void confirmUse(true);}}>예외 사용 확정</button></div>{error&&<p className="error-banner" role="alert">{error}</p>}</Modal>}
  </section>;
}

export function CardCostEditor({ card, controller, onSaved, onClose }: { card: CardDefinition; controller: ResourceController; onSaved: () => Promise<void>; onClose: () => void }) {
  const snapshot=controller.snapshot!; const [revision]=useState(snapshot.revision);
  const [options,setOptions]=useState<CastOption[]>(()=>structuredClone(card.castOptions));
  const [bindings,setBindings]=useState<Record<string,string>>(()=>Object.fromEntries(snapshot.bindings.filter(binding=>binding.cardId===card.id).map(binding=>[binding.costKey,binding.resourceInstanceId])));
  function changeOption(index:number, option:CastOption){setOptions(current=>current.map((value,i)=>i===index?option:value));}
  async function submit(event:FormEvent){event.preventDefault();const keys=new Set(options.flatMap(option=>option.costs.map(cost=>cost.costKey)));if(await controller.perform({type:'save_costs',cardId:card.id,castOptions:options,bindings:Object.entries(bindings).filter(([key,id])=>keys.has(key)&&id).map(([costKey,resourceInstanceId])=>({costKey,resourceInstanceId}))},revision)){await onSaved();onClose();}}
  return <Modal title="카드 비용 설정" wide onClose={onClose}><form onSubmit={event=>void submit(event)}><p className="manager-help">사용 방식과 비용은 이 카드를 공유하는 캐릭터에 공통입니다. 자원 연결은 현재 캐릭터에만 적용합니다. 비용이 없으면 무소모 카드입니다.</p>
    {options.map((option,index)=><fieldset className="cost-option" key={option.id}><legend>사용 방식 {index+1}</legend><label className="form-field">방식 이름 {index+1}<input required maxLength={100} value={option.label} disabled={controller.busy} onChange={event=>changeOption(index,{...option,label:event.target.value})}/></label>
      {option.casting||option.costs.some(cost=>cost.type==='slot')?<p className="muted">기존 시전 옵션은 보존됩니다. 시전 슬롯 규칙은 P3에서 지원합니다.</p>:<>
        {option.costs.map((cost,costIndex)=>{if(cost.type==='slot')return null;const resource=snapshot.resources.find(resource=>resource.id===bindings[cost.costKey]);const replace=(next:typeof cost)=>changeOption(index,{...option,costs:option.costs.map((value,i)=>i===costIndex?next:value)});return <div className="cost-row" key={cost.costKey}>
          <label>연결 자원 {index+1}-{costIndex+1}<select aria-label={`연결 자원 ${index+1}-${costIndex+1}`} disabled={controller.busy} value={bindings[cost.costKey]??''} onChange={event=>{setBindings({...bindings,[cost.costKey]:event.target.value});replace({...cost,slotLevel:undefined});}}><option value="">미연결</option>{bindings[cost.costKey]&&!resource&&<option value={bindings[cost.costKey]}>삭제되었거나 없는 자원</option>}{snapshot.resources.filter(resource=>resource.overrides.scope!=='card'||resource.overrides.ownerCardId===card.id).map(resource=><option key={resource.id} value={resource.id}>{resource.name} · {resource.unit}</option>)}</select></label>
          <label>소모 방식<select aria-label={`소모 방식 ${index+1}-${costIndex+1}`} disabled={controller.busy} value={cost.type} onChange={event=>replace(event.target.value==='fixed'?{type:'fixed',costKey:cost.costKey,amount:1,slotLevel:cost.slotLevel}:{type:'variable',costKey:cost.costKey,min:1,max:5,step:1,slotLevel:cost.slotLevel})}><option value="fixed">고정</option><option value="variable">선택형</option></select></label>
          {cost.type==='fixed'?<label>소모량<input aria-label={`소모량 ${index+1}-${costIndex+1}`} required type="number" min={0} max={1000000} step={1} value={cost.amount} onChange={event=>replace({...cost,amount:Number(event.target.value)})}/></label>:<>{(['min','max','step']as const).map(field=><label key={field}>{{min:'최소',max:'최대',step:'간격'}[field]}<input aria-label={`${field} ${index+1}-${costIndex+1}`} required type="number" min={field==='step'?1:0} max={1000000} step={1} value={cost[field]} onChange={event=>replace({...cost,[field]:Number(event.target.value)})}/></label>)}</>}
          {resource?.kind==='slot_track'&&<label>트랙 레벨<select aria-label={`트랙 레벨 ${index+1}-${costIndex+1}`} value={cost.slotLevel??''} onChange={event=>replace({...cost,slotLevel:event.target.value?Number(event.target.value):undefined})}><option value="">레벨 선택</option>{Object.keys(resource.capacityByLevel!).map(level=><option key={level} value={level}>{level}레벨</option>)}</select></label>}
          <button type="button" disabled={controller.busy} aria-label={`비용 ${index+1}-${costIndex+1} 삭제`} onClick={()=>changeOption(index,{...option,costs:option.costs.filter((_,i)=>i!==costIndex)})}>비용 삭제</button>
        </div>;})}
        <button type="button" disabled={controller.busy||option.costs.length>=100} onClick={()=>changeOption(index,{...option,costs:[...option.costs,{type:'fixed',costKey:crypto.randomUUID(),amount:1}]})}>비용 추가 {index+1}</button>
      </>}
      <button type="button" className="remove-option" disabled={controller.busy||options.length===1} onClick={()=>setOptions(options.filter((_,i)=>i!==index))}>사용 방식 {index+1} 삭제</button>
    </fieldset>)}
    <button type="button" disabled={controller.busy||options.length>=12} onClick={()=>setOptions([...options,{id:crypto.randomUUID(),label:'새 사용 방식',costs:[]}])}>사용 방식 추가</button>
    {controller.error&&<p role="alert" className="error-banner">{controller.error}</p>}<div className="modal-actions"><button type="button" disabled={controller.busy} onClick={onClose}>취소</button><button disabled={controller.busy}>비용 연결 저장</button></div>
  </form></Modal>;
}
