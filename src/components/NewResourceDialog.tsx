import { useState, type FormEvent } from 'react';
import { templateDraftSchema, type ResourceView, type TemplateDraft } from '../shared/resources';
import { bindableCounters, findSameNameResource, recoveryChoices, recoveryRules, type NewResourceDraft, type RecoveryChoices } from '../shared/resource-drafts';
import { RecoveryFieldset } from './ResourceFields';
import { Modal } from './Modal';

export type CounterRuleKind = 'uses' | 'points';
const DEFAULT_UNIT: Record<CounterRuleKind, string> = { uses: '회', points: '점' };
const COUNTER_UNITS = ['회', '점', '개'];

function issueMessage(issue: { code: string; path: PropertyKey[]; message: string }): string {
  const field = issue.path[0];
  if (issue.code === 'custom') return issue.message;
  if (field === 'name') return '자원 이름을 입력해 주세요.';
  if (field === 'unit') return '단위를 입력해 주세요.';
  if (field === 'capacity') return '최대치는 0~1,000,000 사이의 정수로 입력해 주세요.';
  if (field === 'recovery') return '회복량은 0~1,000,000 사이의 정수로 입력해 주세요.';
  return '새 자원 설정을 확인해 주세요.';
}

/**
 * "새 자원 만들기" while registering a card. It opens as a second modal on top of the registration
 * window (rendered after the registration <form>, never inside it), so the card form keeps every input
 * and its scroll position. Nothing is saved here: the draft is created together with the card.
 */
export function NewResourceDialog({ initial, ruleKind, resources, characterName, onCancel, onCreate, onPickExisting }: {
  initial?: NewResourceDraft; ruleKind: CounterRuleKind; resources: ResourceView[]; characterName?: string;
  onCancel: () => void; onCreate: (draft: NewResourceDraft, kind: CounterRuleKind) => void; onPickExisting: (resourceId: string) => void;
}) {
  const template = initial?.template;
  const [name, setName] = useState(template?.name ?? '');
  const [kind, setKind] = useState<CounterRuleKind>(ruleKind);
  const [unit, setUnit] = useState(template ? COUNTER_UNITS.includes(template.unit) ? template.unit : 'custom' : DEFAULT_UNIT[ruleKind]);
  const [customUnit, setCustomUnit] = useState(template && !COUNTER_UNITS.includes(template.unit) ? template.unit : '');
  const [unitTouched, setUnitTouched] = useState(!!template);
  const [capacity, setCapacity] = useState(template?.capacity?.type === 'fixed' ? template.capacity.value : 5);
  const [unlimited, setUnlimited] = useState(template?.unlimited ?? false);
  const [recovery, setRecovery] = useState<RecoveryChoices>(() => recoveryChoices(template?.recovery));
  const [error, setError] = useState('');
  const same = findSameNameResource(resources, name);
  const sameSelectable = !!same && bindableCounters([same]).length > 0;
  const owner = characterName ?? '현재 캐릭터';

  function submit(event: FormEvent) {
    // Never let this submit reach the registration form (it must not save the card).
    event.preventDefault(); event.stopPropagation();
    if (same) return;
    const draft: TemplateDraft = { name: name.trim(), unit: unit === 'custom' ? customUnit.trim() : unit, kind: 'counter', unlimited: unlimited || undefined, capacity: { type: 'fixed', value: capacity }, recovery: recoveryRules(recovery, 'counter') };
    const parsed = templateDraftSchema.safeParse(draft);
    if (!parsed.success) { setError(issueMessage(parsed.error.issues[0])); return; }
    onCreate({ draftId: initial?.draftId ?? crypto.randomUUID(), template: draft }, kind);
  }

  return <Modal title="새 자원 만들기" onClose={onCancel}>
    <form className="new-resource-form" onSubmit={submit}>
      <p className="registration-note">카드 등록 중입니다. 입력한 카드 정보는 그대로 남아 있습니다.</p>
      <label className="form-field">자원 이름<input autoFocus required maxLength={100} value={name} onChange={event => { setName(event.target.value); setError(''); }} /></label>
      {same && <div className="resource-duplicate" role="alert">
        <p>이 캐릭터에 이미 ‘{same.name}’ 자원이 있습니다. 같은 자원을 하나 더 만들지 않도록 기존 자원을 사용해 주세요.</p>
        {sameSelectable ? <button type="button" onClick={() => onPickExisting(same.id)}>기존 ‘{same.name}’ 선택</button> : <p className="muted">이 자원은 횟수·포인트 비용에 바로 연결할 수 없습니다. 다른 이름을 쓰거나 자원 관리에서 확인해 주세요.</p>}
      </div>}
      <div className="form-columns">
        <label className="form-field">자원 종류<select aria-label="새 자원 종류" value={kind} onChange={event => { const next = event.target.value as CounterRuleKind; setKind(next); if (!unitTouched) setUnit(DEFAULT_UNIT[next]); }}><option value="uses">사용 횟수</option><option value="points">포인트 자원</option></select></label>
        <label className="form-field">단위<select aria-label="새 자원 단위" value={unit} onChange={event => { setUnit(event.target.value); setUnitTouched(true); }}>{COUNTER_UNITS.map(value => <option key={value}>{value}</option>)}<option value="custom">사용자 정의</option></select></label>
      </div>
      {unit === 'custom' && <label className="form-field">사용자 정의 단위<input required maxLength={30} value={customUnit} onChange={event => setCustomUnit(event.target.value)} /></label>}
      <label className="form-field">최대치<input type="number" required min={0} max={1000000} step={1} value={capacity} onChange={event => setCapacity(Number(event.target.value))} /></label>
      <label className="checkbox-line"><input type="checkbox" checked={unlimited} onChange={event => setUnlimited(event.target.checked)} />무제한 · 현재량을 차감하지 않음</label>
      <RecoveryFieldset kind="counter" value={recovery} onChange={setRecovery} disabled={false} />
      <section className="resource-scope-note" aria-label="새 자원 적용 범위">
        <strong>적용 범위 · {owner} 전용 자원</strong>
        <p>{owner}에 장착되는 캐릭터 공유 자원입니다. 현재량은 {owner}에만 기록되고, 처음에는 최대치로 채워집니다.</p>
        <p>자원 템플릿은 템플릿 라이브러리에 저장되어 다른 캐릭터도 자원 관리에서 장착할 수 있습니다(다른 캐릭터의 현재량과는 별개).</p>
        <p>카드를 저장할 때 카드와 함께 만들어집니다. 카드 등록을 취소하면 만들어지지 않습니다.</p>
      </section>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" onClick={onCancel}>취소</button><button className="primary" type="submit" disabled={!!same}>{initial ? '변경 적용' : '자원 만들고 선택'}</button></div>
    </form>
  </Modal>;
}
