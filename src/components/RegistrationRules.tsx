import { useId } from 'react';
import type { BasicRuleDraft, BasicRuleKind } from '../shared/use-rules';
import type { ResourceSnapshot } from '../shared/resources';

export type RegistrationKind = BasicRuleKind | 'unconfigured' | 'advanced';
export function RegistrationRules({kind,onKind,draft,onChange,scope,onScope,characterId,snapshot,busy,onAdvanced,summary}:{
  kind:RegistrationKind;onKind:(kind:RegistrationKind)=>void;draft:BasicRuleDraft;onChange:(patch:Partial<BasicRuleDraft>)=>void;
  scope:'shared'|'character';onScope:(scope:'shared'|'character')=>void;characterId?:string;snapshot?:ResourceSnapshot;busy:boolean;onAdvanced:()=>void;summary:string[];
}) {
  const radio=useId();
  const counters=snapshot?.resources.filter(resource=>resource.kind==='counter'&&resource.overrides.scope!=='card')??[];
  return <section className="registration-rules" aria-label="등록 카드 사용 규칙"><h3>카드 사용 규칙</h3>
    <p className="muted">카드 정보와 함께 저장됩니다. 등록이나 설정만으로 자원이 차감되지 않습니다.</p>
    <fieldset className="registration-rule-types" disabled={busy}><legend>이 카드는 어떤 자원을 사용하나요?</legend>{Object.entries({unconfigured:'나중에 설정',none:'무소모',slots:'주문 슬롯',uses:'사용 횟수',points:'포인트 자원'}).map(([key,label])=><label key={key}><input type="radio" name={radio} value={key} checked={kind===key} onChange={()=>onKind(key as RegistrationKind)}/>{label}</label>)}</fieldset>
    {kind==='unconfigured'?<p className="rule-help">비용 미설정으로 임시 등록합니다. 사용 규칙을 지정하기 전에는 사용할 수 없습니다.</p>:<>
      <label className="form-field">규칙 적용 범위<select aria-label="등록 규칙 적용 범위" value={scope} disabled={busy} onChange={event=>onScope(event.target.value as 'shared'|'character')}><option value="shared">공통 카드 규칙 · 모든 캐릭터</option><option value="character" disabled={!characterId}>현재 캐릭터만</option></select></label>
      <p className="rule-help">{scope==='character'?'현재 캐릭터만 이 규칙을 사용합니다. 다른 캐릭터에서는 비용 미설정으로 표시됩니다.':'새 카드의 공통 규칙으로 저장합니다. 자원 연결은 현재 캐릭터에만 적용되며 기존 공통 카드 정의는 수정하지 않습니다.'}</p>
      {kind==='advanced'&&<p className="rule-help">고급 사용 규칙이 준비됐습니다. 아래 요약을 카드와 함께 저장합니다. 기본 유형을 다시 고르면 해당 유형으로 대체됩니다.</p>}
      {kind==='none'&&<p className="rule-help">무소모로 확정합니다. 사용할 때 자원을 차감하지 않고 사용 기록만 남깁니다.</p>}
      {kind==='slots'&&<>
        <label className="form-field">기본 주문 레벨<select aria-label="등록 기본 주문 레벨" value={draft.spellLevel??''} required onChange={event=>onChange({spellLevel:event.target.value===''?undefined:Number(event.target.value)})}><option value="">선택하세요</option>{Array.from({length:10},(_,level)=><option key={level} value={level}>{level===0?'0 · 소마법':`${level}레벨`}</option>)}</select></label>
        {draft.spellLevel===0?<p className="rule-help">소마법은 슬롯을 소비하지 않습니다.</p>:<>
          <label className="form-field">슬롯 계열<select aria-label="등록 슬롯 계열" value={draft.family} onChange={event=>onChange({family:event.target.value as 'standard'|'pact'})}><option value="standard">일반 주문 슬롯</option><option value="pact">계약 마법</option></select></label>
          <p className="rule-help">클래스 슬롯을 자동으로 연결합니다. {draft.family==='standard'?'기본 주문 레벨 이상 슬롯은 사용할 때 선택합니다.':'계약 슬롯 레벨은 자동 적용됩니다. 신비의 비전은 별도 사용 횟수로 연결하세요.'}</p>
          <label className="checkbox-line"><input type="checkbox" checked={draft.homebrew} onChange={event=>onChange({homebrew:event.target.checked,belowBase:false,minLevel:undefined,maxLevel:undefined})}/>홈브루 예외 허용</label>
          {draft.homebrew&&<div className="homebrew-rule"><label className="checkbox-line"><input type="checkbox" checked={draft.belowBase} onChange={event=>onChange({belowBase:event.target.checked})}/>기본 주문 레벨 미만 시전 허용</label><div className="form-columns">{(['minLevel','maxLevel'] as const).map(field=><label className="form-field" key={field}>{field==='minLevel'?'최소':'최대'} 시전 레벨<input aria-label={`등록 홈브루 ${field==='minLevel'?'최소':'최대'} 레벨`} type="number" min={1} max={9} value={draft[field]??''} onChange={event=>onChange({[field]:event.target.value?Number(event.target.value):undefined})}/></label>)}</div></div>}
        </>}
      </>}
      {(kind==='uses'||kind==='points')&&<>
        <label className="form-field">사용할 자원<select aria-label="등록 사용할 자원" value={draft.resourceId} required onChange={event=>onChange({resourceId:event.target.value})}><option value="">자원 이름을 선택하세요</option>{counters.map(resource=><option key={resource.id} value={resource.id}>{resource.name} · {resource.unlimited?'무제한':`${resource.remaining}/${resource.capacity} ${resource.unit}`}</option>)}</select></label>
        {!(kind==='points'&&draft.variable)&&<label className="form-field">한 번에 사용할 양<input aria-label="등록 사용할 양" type="number" min={0} max={1000000} step={1} required value={draft.amount} onChange={event=>onChange({amount:Number(event.target.value)})}/></label>}
        {!counters.length&&<p className="muted">현재 캐릭터에 연결할 자원이 없습니다. 자원 관리에서 만든 뒤 다시 등록하거나 비용 미설정으로 저장하세요.</p>}
      </>}
    </>}
    <details><summary>고급 사용 규칙</summary>
      {kind==='points'&&<><label className="checkbox-line"><input type="checkbox" checked={draft.variable} onChange={event=>onChange({variable:event.target.checked})}/>사용할 때 포인트 양을 고르기</label>{draft.variable&&<div className="form-columns">{(['min','max','step'] as const).map(field=><label className="form-field" key={field}>{{min:'최소',max:'최대',step:'간격'}[field]}<input aria-label={`등록 포인트 ${field}`} type="number" required min={field==='step'?1:0} max={1000000} value={draft[field]} onChange={event=>onChange({[field]:Number(event.target.value)})}/></label>)}</div>}</>}
      <p className="muted">여러 비용·사용 방식 또는 슬롯 자원 직접 연결을 설정할 수 있습니다. 변경은 카드 저장 시 함께 적용됩니다.</p><button type="button" disabled={busy} onClick={onAdvanced}>등록 고급 규칙 편집</button>
    </details>
    {kind!=='unconfigured'&&<div className="registration-summary" aria-label="등록 규칙 요약"><strong>{scope==='shared'?'공통 규칙':'현재 캐릭터 전용 규칙'}</strong>{summary.map((line,i)=><p key={i}>{line}</p>)}</div>}
  </section>;
}
