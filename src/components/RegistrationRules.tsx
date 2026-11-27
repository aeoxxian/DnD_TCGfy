import { useId } from 'react';
import type { BasicRuleDraft, BasicRuleKind } from '../shared/use-rules';
import type { ResourceSnapshot, ResourceView } from '../shared/resources';
import { bindableCounters } from '../shared/resource-drafts';

const NEW_RESOURCE = '__new_resource__';

export type RegistrationKind = BasicRuleKind | 'unconfigured' | 'advanced';
export function RegistrationRules({kind,onKind,draft,onChange,scope,onScope,characterId,snapshot,busy,onAdvanced,summary,pending,pendingNote,characterName,onNewResource,onDiscardPending,perCard=false,advanced=true,hasOwned=false}:{
  kind:RegistrationKind;onKind:(kind:RegistrationKind)=>void;draft:BasicRuleDraft;onChange:(patch:Partial<BasicRuleDraft>)=>void;
  scope:'shared'|'character';onScope:(scope:'shared'|'character')=>void;characterId?:string;snapshot?:ResourceSnapshot;busy:boolean;onAdvanced:()=>void;summary:string[];
  /** v1.2: a resource drafted in this registration (created only when the card is saved). */
  pending?:ResourceView;pendingNote?:string;characterName?:string;onNewResource?:()=>void;onDiscardPending?:()=>void;
  /** v1.3 Phase 2: one card of a batch. Its controls carry “개별 …” names so they never clash with the common rule. */
  perCard?:boolean;
  /** v1.3 Phase 2: false hides the multi-option editor (batch registration uses the basic kinds only). */
  advanced?:boolean;
  hasOwned?:boolean;
}) {
  const radio=useId();
  const counters=bindableCounters(snapshot?.resources??[]);
  const owner=characterName??'현재 캐릭터';
  const L=(name:string)=>perCard?`개별 ${name}`:name;
  const kinds={unconfigured:'나중에 설정',none:'무소모',slots:'주문 슬롯',uses:'사용 횟수',points:'포인트 자원'};
  return <section className={`registration-rules ${perCard?'per-card':''}`} aria-label={perCard?'개별 카드 사용 규칙':'등록 카드 사용 규칙'}><h3>{perCard?'이 카드의 사용 규칙':'카드 사용 규칙'}</h3>
    {!perCard&&<p className="muted">카드 정보와 함께 저장됩니다. 등록이나 설정만으로 자원이 차감되지 않습니다.</p>}
    <fieldset className="registration-rule-types" disabled={busy}><legend>이 카드는 어떤 자원을 사용하나요?</legend>{Object.entries(kinds).map(([key,label])=><label key={key}><input type="radio" name={radio} value={key} aria-label={perCard?L(label):undefined} checked={kind===key} onChange={()=>onKind(key as RegistrationKind)}/>{label}</label>)}</fieldset>
    {kind==='unconfigured'?<p className="rule-help">{hasOwned?'카드 고유 자원만 차감하는 규칙으로 등록합니다.':'비용 미설정으로 임시 등록합니다. 사용 규칙을 지정하기 전에는 사용할 수 없습니다.'}</p>:<>
      <label className="form-field">규칙 적용 범위<select aria-label={L('등록 규칙 적용 범위')} value={scope} disabled={busy} onChange={event=>onScope(event.target.value as 'shared'|'character')}><option value="shared">공통 카드 규칙 · 모든 캐릭터</option><option value="character" disabled={!characterId}>현재 캐릭터만</option></select></label>
      <p className="rule-help">{scope==='character'?'현재 캐릭터만 이 규칙을 사용합니다. 다른 캐릭터에서는 비용 미설정으로 표시됩니다.':'새 카드의 공통 규칙으로 저장합니다. 자원 연결은 현재 캐릭터에만 적용되며 기존 공통 카드 정의는 수정하지 않습니다.'}</p>
      {kind==='advanced'&&<p className="rule-help">고급 사용 규칙이 준비됐습니다. 아래 요약을 카드와 함께 저장합니다. 기본 유형을 다시 고르면 해당 유형으로 대체됩니다.</p>}
      {kind==='none'&&<p className="rule-help">{hasOwned?'공유 자원 비용 없이 고유 자원만 차감합니다.':'무소모로 확정합니다. 사용할 때 자원을 차감하지 않고 사용 기록만 남깁니다.'}</p>}
      {kind==='slots'&&<>
        <label className="form-field">기본 주문 레벨<select aria-label={L('등록 기본 주문 레벨')} value={draft.spellLevel??''} required onChange={event=>onChange({spellLevel:event.target.value===''?undefined:Number(event.target.value)})}><option value="">선택하세요</option>{Array.from({length:10},(_,level)=><option key={level} value={level}>{level===0?'0 · 소마법':`${level}레벨`}</option>)}</select></label>
        {draft.spellLevel===0?<p className="rule-help">소마법은 슬롯을 소비하지 않습니다.</p>:<>
          <label className="form-field">슬롯 계열<select aria-label={L('등록 슬롯 계열')} value={draft.family} onChange={event=>onChange({family:event.target.value as 'standard'|'pact'})}><option value="standard">일반 주문 슬롯</option><option value="pact">계약 마법</option></select></label>
          <p className="rule-help">클래스 슬롯을 자동으로 연결합니다. {draft.family==='standard'?'허용 범위 안에서 사용할 슬롯을 고릅니다.':'허용 범위 안의 계약 슬롯 레벨을 자동 적용합니다.'}</p>
          <label className="form-field">허용 슬롯 범위<select aria-label={L('등록 허용 슬롯 범위')} value={draft.allowUpcast===false?'fixed':draft.minLevel!==undefined||draft.maxLevel!==undefined?'custom':'default'} onChange={event=>onChange({allowUpcast:event.target.value!=='fixed',minLevel:undefined,maxLevel:event.target.value==='custom'?9:undefined,belowBase:false})}><option value="default">기본 레벨 이상</option><option value="fixed">기본 레벨 슬롯만</option><option value="custom">사용자 정의 범위</option></select></label>
          <label className="checkbox-line"><input type="checkbox" aria-label={perCard?L('홈브루 예외 허용'):undefined} checked={draft.homebrew} onChange={event=>onChange({homebrew:event.target.checked,belowBase:false,minLevel:undefined,maxLevel:undefined})}/>홈브루 예외 허용</label>
          {draft.allowUpcast!==false&&(draft.homebrew||draft.minLevel!==undefined||draft.maxLevel!==undefined)&&<div className="homebrew-rule">{draft.homebrew&&<label className="checkbox-line"><input type="checkbox" aria-label={perCard?L('기본 주문 레벨 미만 시전 허용'):undefined} checked={draft.belowBase} onChange={event=>onChange({belowBase:event.target.checked})}/>기본 주문 레벨 미만 시전 허용</label>}<div className="form-columns">{(['minLevel','maxLevel'] as const).map(field=><label className="form-field" key={field}>{field==='minLevel'?'최소':'최대'} 시전 레벨<input aria-label={L(`등록 홈브루 ${field==='minLevel'?'최소':'최대'} 레벨`)} type="number" min={1} max={9} value={draft[field]??''} onChange={event=>onChange({[field]:event.target.value?Number(event.target.value):undefined})}/></label>)}</div></div>}
        </>}
      </>}
      {(kind==='uses'||kind==='points')&&<>
        <label className="form-field">사용할 자원<select aria-label={L('등록 사용할 자원')} value={draft.resourceId} required={!draft.resourceKey?.trim()} onChange={event=>{if(event.target.value===NEW_RESOURCE){onNewResource?.();return;}onChange({resourceId:event.target.value});}}><option value="">자원 이름을 선택하세요</option>{pending&&<option value={pending.id}>새 자원 · {pending.name} · {pendingNote} (카드 저장 시 생성)</option>}{counters.map(resource=><option key={resource.id} value={resource.id}>{resource.name} · {resource.unlimited?'무제한':`${resource.remaining}/${resource.capacity} ${resource.unit}`}</option>)}{!perCard&&onNewResource&&<option value={NEW_RESOURCE}>+ 새 자원 만들기…</option>}</select></label>
        <label className="form-field">자동 연결할 자원 식별 키<input aria-label={L('등록 자원 식별 키')} maxLength={128} value={draft.resourceKey??''} onChange={event=>onChange({resourceKey:event.target.value})}/></label>
        <p className="muted">지금 보유하지 않아도 자원 관리에 표시된 식별 키로 등록할 수 있습니다. 자원을 직접 고르면 그 연결이 우선합니다.</p>
        {!perCard&&<div className="new-resource-row">{pending?<><p className="new-resource-pending" aria-label="새 자원 초안"><strong>새 자원 ‘{pending.name}’</strong> · {pendingNote} · {owner} 전용(캐릭터 공유) · 카드를 저장할 때 함께 만들어집니다.{draft.resourceId!==pending.id&&' 지금은 비용에 연결되지 않아 만들지 않습니다.'}</p><button type="button" disabled={busy} onClick={onNewResource}>새 자원 고치기</button><button type="button" disabled={busy} onClick={onDiscardPending}>새 자원 취소</button></>:<><button type="button" className="new-resource" disabled={busy||!onNewResource} onClick={onNewResource}>+ 새 자원 만들기</button>{!onNewResource&&<p className="muted">상단에서 캐릭터를 선택하면 등록 중에 새 자원을 만들 수 있습니다.</p>}</>}</div>}
        {!(kind==='points'&&draft.variable)&&<label className="form-field">한 번에 사용할 양<input aria-label={L('등록 사용할 양')} type="number" min={0} max={1000000} step={1} required value={draft.amount} onChange={event=>onChange({amount:Number(event.target.value)})}/></label>}
        {!perCard&&!counters.length&&!pending&&onNewResource&&<p className="muted">현재 캐릭터에 연결할 자원이 없습니다. ‘+ 새 자원 만들기’로 바로 만들 수 있습니다.</p>}
      </>}
    </>}
    {(advanced||kind==='points')&&<details><summary>고급 사용 규칙</summary>
      {kind==='points'&&<><label className="checkbox-line"><input type="checkbox" aria-label={perCard?L('사용할 때 포인트 양을 고르기'):undefined} checked={draft.variable} onChange={event=>onChange({variable:event.target.checked})}/>사용할 때 포인트 양을 고르기</label>{draft.variable&&<div className="form-columns">{(['min','max','step'] as const).map(field=><label className="form-field" key={field}>{{min:'최소',max:'최대',step:'간격'}[field]}<input aria-label={L(`등록 포인트 ${field}`)} type="number" required min={field==='step'?1:0} max={1000000} value={draft[field]} onChange={event=>onChange({[field]:Number(event.target.value)})}/></label>)}</div>}</>}
      {advanced?<><p className="muted">여러 비용·사용 방식 또는 슬롯 자원 직접 연결을 설정할 수 있습니다. 변경은 카드 저장 시 함께 적용됩니다.</p><button type="button" disabled={busy} onClick={onAdvanced}>등록 고급 규칙 편집</button></>
        :<p className="muted">여러 사용 방식 같은 고급 규칙은 등록한 뒤 카드 사용 규칙에서 정합니다.</p>}
    </details>}
    {kind!=='unconfigured'&&<div className="registration-summary" aria-label={L('등록 규칙 요약')}><strong>{scope==='shared'?'공통 규칙':'현재 캐릭터 전용 규칙'}</strong>{summary.map((line,i)=><p key={i}>{line}</p>)}</div>}
  </section>;
}
