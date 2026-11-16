import { useId, useMemo, useState } from 'react';
import type { CardDefinition } from '../shared/contracts';
import { effectiveCard } from '../shared/casting';
import { buildBasicRule, classSlotResources, describeUseRules, emptyBasicRule, inferBasicRule, type BasicRuleDraft, type BasicRuleKind } from '../shared/use-rules';
import { AdvancedCardCostEditor } from './CardCostEditor';
import type { ResourceController } from './ResourcePanel';
import { Modal } from './Modal';

interface Props { card:CardDefinition; controller:ResourceController; onSaved:()=>Promise<void>; onClose:()=>void }
const ruleNames:Record<BasicRuleKind,string>={none:'무소모',slots:'주문 슬롯',uses:'사용 횟수',points:'포인트 자원'};
export function CardCostEditor(props:Props){
  const [scope,setScope]=useState<'shared'|'character'>(props.controller.snapshot?.costOverrides?.some(value=>value.cardId===props.card.id)?'character':'shared');
  const [advanced,setAdvanced]=useState(false);
  if(advanced)return <AdvancedCardCostEditor {...props} initialScope={scope} onBasic={()=>setAdvanced(false)}/>;
  return <Modal title="카드 사용 규칙" onClose={props.onClose}><BasicRules key={scope} {...props} scope={scope} setScope={setScope} onAdvanced={()=>setAdvanced(true)}/></Modal>;
}
function BasicRules({card,controller,onSaved,onClose,scope,setScope,onAdvanced}:Props&{scope:'shared'|'character';setScope:(scope:'shared'|'character')=>void;onAdvanced:()=>void}){
  const snapshot=controller.snapshot!;const [revision]=useState(snapshot.revision);const radioName=useId();
  const original=useMemo(()=>scope==='shared'?card:effectiveCard(card,snapshot),[card,scope,snapshot]);
  const [inferred]=useState(()=>inferBasicRule(original,snapshot));const legacy=!inferred;
  const [draft,setDraft]=useState<BasicRuleDraft>(()=>inferred??emptyBasicRule(card));const [chosen,setChosen]=useState(!legacy);
  const [ids]=useState(()=>({optionId:original.castOptions[0].id,costKey:original.castOptions.length===1&&original.castOptions[0].costs.length===1?original.castOptions[0].costs[0].costKey:crypto.randomUUID()}));
  const [review,setReview]=useState(false);const [conversionConfirmed,setConversionConfirmed]=useState(false);const [sharedConfirmed,setSharedConfirmed]=useState(false);const [localError,setLocalError]=useState('');
  const [restore,setRestore]=useState(false);
  const counters=snapshot.resources.filter(resource=>resource.kind==='counter'&&(resource.overrides.scope!=='card'||resource.overrides.ownerCardId===card.id));
  const slotResources=snapshot.resources.filter(resource=>resource.kind==='slot_track'&&resource.template.slotKind===draft.family&&(resource.overrides.scope!=='card'||resource.overrides.ownerCardId===card.id));
  const automaticSlots=classSlotResources(snapshot,draft.family);
  const selected=snapshot.resources.find(resource=>resource.id===draft.resourceId);
  let proposal:ReturnType<typeof buildBasicRule>|undefined;let invalid='';
  try{if(chosen)proposal=buildBasicRule(original,draft,ids);}catch(error){invalid=(error as Error).message;}
  const affected=snapshot.sharedCostUsers?.[card.id]??0;
  const baseChanged=proposal?.spellLevel!==undefined&&proposal.spellLevel!==card.spellLevel;
  const sharedChange=!!proposal&&(baseChanged||scope==='shared'&&JSON.stringify(proposal.castOptions)!==JSON.stringify(card.castOptions));
  const needsShared=affected>0&&sharedChange;
  const before=describeUseRules(original.castOptions,snapshot.bindings.filter(value=>value.cardId===card.id),snapshot.resources);
  const after=proposal?describeUseRules(proposal.castOptions,proposal.bindings,snapshot.resources):[];
  function update(patch:Partial<BasicRuleDraft>){setDraft({...draft,...patch});setReview(false);setConversionConfirmed(false);setSharedConfirmed(false);setLocalError('');}
  async function save(){
    if(!proposal)return;
    if(legacy&&!review){setReview(true);return;}
    if(legacy&&!conversionConfirmed)return;
    if(await controller.perform({type:'save_costs',scope,confirmShared:sharedConfirmed,expectedCardVersion:card.updatedAt,cardId:card.id,...proposal},revision)){await onSaved();onClose();}
  }
  return <form className="basic-use-rules" onSubmit={event=>{event.preventDefault();void save().catch(()=>setLocalError('저장 결과를 확인하지 못했습니다. 다시 불러온 규칙을 확인해 주세요.'));}}>
    <p className="manager-help">이 카드가 사용하는 자원과 한 번에 쓰는 양을 정하세요. 설정만으로 자원이 차감되지는 않습니다.</p>
    <label className="form-field">적용 대상<select aria-label="적용 대상" disabled={controller.busy} value={scope} onChange={event=>setScope(event.target.value as 'shared'|'character')}><option value="shared">이 카드를 쓰는 모든 캐릭터</option><option value="character">이 캐릭터만</option></select></label>
    {legacy&&<section className="legacy-use-rules" aria-label="기존 고급 설정"><h3>기존 고급 설정을 유지하고 있습니다</h3><ul>{before.map((text,i)=><li key={i}>{text}</li>)}</ul><p>아래에서 새 규칙을 고르면 저장 전에 바뀌는 내용을 확인할 수 있습니다.</p><button type="button" onClick={onAdvanced}>기존 고급 설정 편집</button></section>}
    <fieldset className="rule-kind"><legend>어떤 자원을 사용하나요?</legend>{(Object.keys(ruleNames)as BasicRuleKind[]).map(kind=><label key={kind} title={kind==='slots'&&card.kind!=='spell'?'카드 정보에서 유형을 주문으로 지정하면 사용할 수 있습니다.':undefined} className={chosen&&draft.kind===kind?'selected':''}><input type="radio" name={radioName} value={kind} checked={chosen&&draft.kind===kind} disabled={controller.busy||kind==='slots'&&card.kind!=='spell'} onChange={()=>{setChosen(true);update({kind,...(kind!==draft.kind?{resourceId:'',automatic:true,variable:false}:{})});}}/>{ruleNames[kind]}</label>)}</fieldset>
    {chosen&&draft.kind==='none'&&<p className="rule-help">사용할 때 자원을 차감하지 않고 기록만 남깁니다.</p>}
    {chosen&&draft.kind==='slots'&&<>
      <label className="form-field">기본 주문 레벨<select aria-label="기본 주문 레벨" required value={draft.spellLevel??''} disabled={controller.busy} onChange={event=>update({spellLevel:event.target.value===''?undefined:Number(event.target.value)})}><option value="">선택하세요</option>{Array.from({length:10},(_,i)=><option key={i} value={i}>{i===0?'0 · 소마법':`${i}레벨`}</option>)}</select></label>
      <p className="muted">기본 주문 레벨은 모든 캐릭터에 공통인 카드 정보입니다.</p>
      {draft.spellLevel===0?<p className="rule-help">소마법은 슬롯을 사용하지 않습니다. 슬롯 선택도 필요하지 않습니다.</p>:<>
        <label className="form-field">슬롯 계열<select aria-label="슬롯 계열" value={draft.family} disabled={controller.busy} onChange={event=>update({family:event.target.value as 'standard'|'pact',automatic:true,resourceId:''})}><option value="standard">일반 주문 슬롯</option><option value="pact">계약 마법</option></select></label>
        {draft.automatic?<div className="rule-help">{automaticSlots.length===1?<p><strong>{automaticSlots[0].name}</strong>을 클래스에서 자동으로 연결합니다.</p>:<p>{automaticSlots.length===0?'클래스 슬롯이 없습니다. 클래스 설정 후 자동 연결되거나, 아래에서 자원을 직접 고를 수 있습니다.':'클래스 슬롯이 여러 개입니다. 사용할 자원을 직접 골라 주세요.'}</p>}<button type="button" onClick={()=>update({automatic:false})}>슬롯 자원 직접 선택</button></div>:<><label className="form-field">사용할 슬롯<select aria-label="사용할 슬롯" required value={draft.resourceId} onChange={event=>update({resourceId:event.target.value})}><option value="">자원 이름을 선택하세요</option>{draft.resourceId&&!slotResources.some(resource=>resource.id===draft.resourceId)&&<option value={draft.resourceId}>기존 자원 · 연결 확인 필요</option>}{slotResources.map(resource=><option key={resource.id} value={resource.id}>{resource.name}</option>)}</select></label><button type="button" onClick={()=>update({automatic:true,resourceId:''})}>클래스 슬롯 자동 연결</button></>}
        <p className="rule-help">한 번 사용할 때 선택한 슬롯 1개를 씁니다. {draft.family==='standard'?'업캐스팅은 사용할 때 고릅니다. 카드에 레벨별 비용을 추가할 필요가 없습니다.':'계약 슬롯 레벨은 자동으로 적용됩니다. 신비의 비전은 사용 횟수에서 별도로 연결하세요.'}</p>
        <label className="checkbox-line"><input type="checkbox" checked={draft.homebrew} onChange={event=>update({homebrew:event.target.checked,belowBase:false,minLevel:undefined,maxLevel:undefined})}/>홈브루 예외 사용</label>
        {draft.homebrew&&<div className="homebrew-rule"><label className="checkbox-line"><input type="checkbox" checked={draft.belowBase} onChange={event=>update({belowBase:event.target.checked})}/>기본 주문 레벨 미만 시전 허용</label><div className="form-columns"><label className="form-field">최소 시전 레벨<input aria-label="홈브루 최소 시전 레벨" type="number" min={1} max={9} value={draft.minLevel??''} onChange={event=>update({minLevel:event.target.value?Number(event.target.value):undefined})}/></label><label className="form-field">최대 시전 레벨<input aria-label="홈브루 최대 시전 레벨" type="number" min={1} max={9} value={draft.maxLevel??''} onChange={event=>update({maxLevel:event.target.value?Number(event.target.value):undefined})}/></label></div></div>}
      </>}
    </>}
    {chosen&&(draft.kind==='uses'||draft.kind==='points')&&<>
      <label className="form-field">사용할 자원<select aria-label="사용할 자원" required value={draft.resourceId} disabled={controller.busy} onChange={event=>update({resourceId:event.target.value})}><option value="">자원 이름을 선택하세요</option>{draft.resourceId&&!counters.some(resource=>resource.id===draft.resourceId)&&<option value={draft.resourceId}>기존 자원 · 연결 확인 필요</option>}{counters.map(resource=><option key={resource.id} value={resource.id}>{resource.name} · {resource.unlimited?'무제한':`${resource.remaining}/${resource.capacity} ${resource.unit}`}</option>)}</select></label>
      {!draft.variable||draft.kind==='uses'?<label className="form-field">한 번에 사용할 양<input aria-label="한 번에 사용할 양" required type="number" min={0} max={1000000} step={1} value={draft.amount} disabled={controller.busy} onChange={event=>update({amount:Number(event.target.value)})}/></label>:<p className="rule-help">사용할 때 {draft.min}~{draft.max}{selected?.unit??'점'} 안에서 고릅니다. 간격은 {draft.step}입니다.</p>}
      {!counters.length&&<p className="muted">먼저 자원 관리에서 사용할 횟수 또는 포인트 자원을 만들어 주세요.</p>}
    </>}
    <details className="use-rule-advanced"><summary>고급 설정</summary>{chosen&&draft.kind==='points'&&<><label className="checkbox-line"><input type="checkbox" checked={draft.variable} onChange={event=>update({variable:event.target.checked})}/>사용할 때 포인트 양을 고르기</label>{draft.variable&&<div className="variable-rule-inputs">{(['min','max','step']as const).map(field=><label className="form-field" key={field}>{{min:'최소',max:'최대',step:'간격'}[field]}<input aria-label={`포인트 ${field==='min'?'최소':field==='max'?'최대':'간격'}`} required type="number" min={field==='step'?1:0} max={1000000} step={1} value={draft[field]} onChange={event=>update({[field]:Number(event.target.value)})}/></label>)}</div>}</>}
      <p className="muted">여러 자원을 함께 쓰거나 여러 사용 방식을 만들 때 편집합니다.</p><button type="button" onClick={onAdvanced}>복수 자원·사용 방식 편집</button>
      {snapshot.costOverrides?.some(value=>value.cardId===card.id)&&<><button type="button" onClick={()=>setRestore(true)}>공통 사용 규칙으로 복귀</button>{restore&&<div className="inline-confirm"><p>이 캐릭터의 전용 규칙을 해제합니다. 공통 규칙에 사용할 자원 연결을 다시 확인하세요.</p><button type="button" disabled={controller.busy} onClick={async()=>{if(await controller.perform({type:'clear_cost_override',cardId:card.id},revision)){await onSaved();onClose();}}}>전용 규칙 해제 확인</button></div>}</>}
    </details>
    {proposal&&chosen&&!legacy&&<p className="rule-save-summary"><strong>저장할 내용</strong> {after[0]?.replace(/^[^:]*:\s*/,'')}{baseChanged?` · 기본 주문 ${card.spellLevel??'미지정'} → ${proposal.spellLevel}레벨`:''}</p>}
    {proposal&&chosen&&legacy&&review&&<section className="rule-save-preview" aria-label="사용 규칙 변경 미리보기"><h3>{legacy?'기존 설정에서 다음과 같이 변경합니다':'저장할 사용 규칙'}</h3>{legacy&&<><h4>변경 전</h4><ul>{before.map((text,i)=><li key={i}>{text}</li>)}</ul><h4>변경 후</h4></>}<ul>{after.map((text,i)=><li key={i}>{text}</li>)}</ul>{proposal.spellLevel!==undefined&&<p>기본 주문 레벨: {card.spellLevel??'미지정'} → {proposal.spellLevel}</p>}{legacy&&<label className="checkbox-line"><input type="checkbox" aria-label="기존 설정 전환 확인" checked={conversionConfirmed} onChange={event=>setConversionConfirmed(event.target.checked)}/>기존 {original.castOptions.length}개 사용 방식과 비용을 위의 한 가지 규칙으로 바꾸는 것을 확인했습니다.</label>}</section>}
    {needsShared&&(!legacy||review)&&<label className="checkbox-line"><input type="checkbox" aria-label="공통 비용 변경 영향 확인" checked={sharedConfirmed} onChange={event=>setSharedConfirmed(event.target.checked)}/>다른 캐릭터 {affected}명의 공통 사용 규칙 또는 기본 주문 레벨에 미치는 영향을 확인했습니다.</label>}
    {(invalid||localError||controller.error)&&<p className="resource-error" role="alert">{invalid||localError||controller.error}</p>}
    <div className="modal-actions"><button type="button" onClick={onClose} disabled={controller.busy}>취소</button>{chosen&&<button type="submit" disabled={controller.busy||!proposal||needsShared&&(!legacy||review)&&!sharedConfirmed||legacy&&review&&!conversionConfirmed}>{legacy&&!review?'변경 미리보기':'사용 규칙 저장'}</button>}</div>
  </form>;
}
