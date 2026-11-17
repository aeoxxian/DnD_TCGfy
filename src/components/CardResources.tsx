import { useEffect, useMemo, useState } from 'react';
import type { CardDefinition, CastOption } from '../shared/contracts';
import type { ResourcePreview, ResourceSnapshot } from '../shared/resources';
import { boundResource, castingLevels, effectiveCard, slotLevels } from '../shared/casting';
import { planUse } from '../shared/resource-engine';
import { ChangeList, type ResourceController } from './ResourcePanel';
import { Modal } from './Modal';
export { CardCostEditor } from './CardUseRules';

function optionChoices(card:CardDefinition,option:CastOption,snapshot:ResourceSnapshot|undefined,chosen:Record<string,number>):Record<string,number>{
  const result:Record<string,number>={};
  for(const cost of option.costs){
    if(cost.type==='variable')result[cost.costKey]=chosen[cost.costKey]??cost.min;
    else if(cost.type==='slot'&&snapshot){
      try{const levels=slotLevels(card,option,cost.costKey,snapshot.resources,snapshot.bindings);const resource=boundResource(card.id,cost.costKey,snapshot.resources,snapshot.bindings,cost.autoBind?cost.slotSelection:undefined);const level=levels.includes(chosen[cost.costKey])&&(resource.remainingByLevel?.[String(chosen[cost.costKey])]??0)>0?chosen[cost.costKey]:levels.find(level=>(resource.remainingByLevel?.[String(level)]??0)>0)??levels[0];if(level!==undefined)result[cost.costKey]=level;}catch{/* Authoritative preview explains an invalid binding. */}
    }
  }
  return result;
}
export function cardResourceNote(base:CardDefinition,snapshot?:ResourceSnapshot):string {
  const card=effectiveCard(base,snapshot);if(card.costStatus==='unconfigured')return '비용 미설정';if(!snapshot)return '';let insufficient=false;
  for(const option of card.castOptions){try{const plan=planUse(card,option.id,snapshot.resources,snapshot.bindings,optionChoices(card,option,snapshot,{}));if(plan.canUse)return '';insufficient||=plan.canOverride;}catch{/* Detail preview gives the exact reason. */}}
  return insufficient?'자원 부족 · 열람 가능':'비용 연결 확인';
}
export function CardUsage({card:base,controller}:{card:CardDefinition;controller:ResourceController}){
  const {snapshot,busy,perform,error}=controller;const card=useMemo(()=>effectiveCard(base,snapshot),[base,snapshot]);
  const [optionId,setOptionId]=useState(card.castOptions[0].id);const option=card.castOptions.find(option=>option.id===optionId)??card.castOptions[0];
  const [chosen,setChosen]=useState<Record<string,number>>({});const choices=useMemo(()=>optionChoices(card,option,snapshot,chosen),[card,option,snapshot,chosen]);
  const [chosenLevel,setChosenLevel]=useState<number>();let levels:number[]=[];
  try{if(option.casting&&!option.costs.some(cost=>cost.type==='slot'))levels=castingLevels(card,option);}catch{/* Preview surfaces validation errors. */}
  const castingLevel=option.casting&&!option.costs.some(cost=>cost.type==='slot')?(levels.includes(chosenLevel!)?chosenLevel:levels.includes(card.spellLevel!)?card.spellLevel:levels[0]):undefined;
  const [stored,setStored]=useState<{key:string;value?:ResourcePreview;error?:string}>();const [exception,setException]=useState(false);
  const previewKey=JSON.stringify({character:snapshot?.characterId,revision:snapshot?.revision,card,optionId:option.id,choices,castingLevel});
  useEffect(()=>{let live=true;if(!snapshot)return;void window.desktop.previewResource({characterId:snapshot.characterId,action:{type:'use',cardId:card.id,optionId:option.id,choices,castingLevel}}).then(result=>{if(live)setStored(result.ok?{key:previewKey,value:result.value}:{key:previewKey,error:result.error});}).catch(()=>{if(live)setStored({key:previewKey,error:'비용을 확인하지 못했습니다.'});});return()=>{live=false;};},[snapshot,card.id,option.id,choices,castingLevel,previewKey]);
  const preview=stored?.key===previewKey?stored.value:undefined;
  async function confirmUse(override=false){if(!preview)return;if(await perform({type:'use',cardId:card.id,optionId:option.id,choices,castingLevel,quote:preview.quote,override},preview.revision))setException(false);}
  return <section className={`card-use ${preview?.canOverride?'insufficient':''}`} aria-label="카드 사용 비용">
    <div className="use-options-scroll" aria-label="사용 비용 선택"><div className="cost-preview"><span>예상 비용{snapshot?.costOverrides?.some(value=>value.cardId===card.id)?' · 캐릭터 전용':''}</span></div>
    {card.castOptions.length>1&&<label className="form-field">사용 방법<select aria-label="사용 방법" disabled={busy} value={option.id} onChange={event=>{setOptionId(event.target.value);setChosen({});setChosenLevel(undefined);}}>{card.castOptions.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select></label>}
    {option.costs.map((cost,index)=>{
      if(cost.type==='variable')return <label className="form-field" key={cost.costKey}>사용할 양 {index+1}<input type="number" min={cost.min} max={cost.max} step={cost.step} value={choices[cost.costKey]??cost.min} disabled={busy} onChange={event=>setChosen({...chosen,[cost.costKey]:Number(event.target.value)})}/></label>;
      if(cost.type!=='slot'||!snapshot||card.spellLevel===0)return null;
      let available:number[]=[];try{available=slotLevels(card,option,cost.costKey,snapshot.resources,snapshot.bindings);}catch{return null;}
      const pool=boundResource(card.id,cost.costKey,snapshot.resources,snapshot.bindings,cost.autoBind?cost.slotSelection:undefined);const usable=available.filter(level=>(pool.remainingByLevel?.[String(level)]??0)>0);
      return usable.length>1?<label className="form-field" key={cost.costKey}>시전 슬롯<select aria-label={`시전 슬롯 ${index+1}`} disabled={busy||!available.some(level=>(boundResource(card.id,cost.costKey,snapshot.resources,snapshot.bindings,cost.autoBind?cost.slotSelection:undefined).remainingByLevel?.[String(level)]??0)>0)} value={choices[cost.costKey]??''} onChange={event=>setChosen({...chosen,[cost.costKey]:Number(event.target.value)})}>{available.map(level=><option key={level} value={level} disabled={boundResource(card.id,cost.costKey,snapshot.resources,snapshot.bindings,cost.autoBind?cost.slotSelection:undefined).remainingByLevel![String(level)]===0}>{level}레벨 · {boundResource(card.id,cost.costKey,snapshot.resources,snapshot.bindings,cost.autoBind?cost.slotSelection:undefined).remainingByLevel![String(level)]===0?'소진':`잔여 ${boundResource(card.id,cost.costKey,snapshot.resources,snapshot.bindings,cost.autoBind?cost.slotSelection:undefined).remainingByLevel![String(level)]}`}</option>)}</select></label>:available.length>0?<p className="selection-hint" key={cost.costKey}>{cost.slotSelection==='pact'?'계약 마법':'주문'} · {usable.length===1?`${usable[0]}레벨 슬롯 1개 사용`:`사용 가능한 슬롯 없음 · ${available.join('·')}레벨 소진`}{usable.length===1&&available.length>1?` · 다른 ${available.length-1}개 단계 소진`:''}</p>:null;
    })}
    {option.casting?.mode==='homebrew'&&!option.costs.some(cost=>cost.type==='slot')&&levels.length>1&&<label className="form-field">홈브루 시전 레벨<select aria-label="홈브루 시전 레벨" value={castingLevel} disabled={busy} onChange={event=>setChosenLevel(Number(event.target.value))}>{levels.map(level=><option key={level} value={level}>{level}레벨 · 효과는 수동 판정</option>)}</select></label>}
    {!snapshot?<p className="selection-hint">{card.costStatus==='unconfigured'?'비용 미설정 카드입니다. 카드 사용 규칙을 먼저 지정해 주세요.':'캐릭터를 선택하면 비용을 연결하고 사용을 기록할 수 있습니다.'}</p>:preview?<><ChangeList preview={preview} resources={snapshot.resources}/>{preview.reason&&<p className="resource-error">{preview.reason}</p>}{preview.canUse&&preview.changes.length===0&&<p className="selection-hint">무소모 / 무제한 사용 · 기록만 남깁니다.</p>}</>:<p className="selection-hint">{stored?.key===previewKey?stored.error:'비용 확인 중…'}</p>}
    {error&&<p role="alert" className="resource-error">{error}</p>}
    </div><div className="use-confirmation"><button className="use-button" disabled={busy||!snapshot||!preview?.canUse} onClick={event=>{if(event.detail<=1)void confirmUse();}}>사용 확정</button>
    {preview?.canOverride&&<button className="exception-button" disabled={busy} onClick={()=>setException(true)}>예외 사용 · 자원 미차감</button>}
    </div>
    {exception&&preview&&snapshot&&<Modal title="예외 사용 확인" onClose={()=>setException(false)}><p>이번 사용은 자원을 전혀 차감하지 않고 예외 기록만 남깁니다.</p><ChangeList preview={preview} resources={snapshot.resources}/><div className="modal-actions"><button onClick={()=>setException(false)}>취소</button><button disabled={busy} onClick={event=>{if(event.detail<=1)void confirmUse(true);}}>예외 사용 확정</button></div></Modal>}
  </section>;
}
