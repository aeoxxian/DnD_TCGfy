import type { TemplateDraft } from '../shared/resources';
import { RECOVERY_TRIGGER_NAMES, RECOVERY_TRIGGERS, type RecoveryChoice, type RecoveryChoices } from '../shared/resource-drafts';

/** Recovery conditions per trigger. Used by 자원 관리 and by the registration "새 자원 만들기" form. */
export function RecoveryFieldset({ kind, value, onChange, disabled }: { kind: TemplateDraft['kind']; value: RecoveryChoices; onChange: (next: RecoveryChoices) => void; disabled: boolean }) {
  return <fieldset className="editor-checks"><legend>회복 조건과 회복량</legend>{RECOVERY_TRIGGERS.map(trigger => {
    const name = RECOVERY_TRIGGER_NAMES[trigger]; const choice = value[trigger];
    return <div className="recovery-rule" key={trigger}>
      <label>{name}<select aria-label={`${name} 회복 방식`} value={kind === 'slot_track' && choice.type === 'fixed' ? 'none' : choice.type} disabled={disabled} onChange={event => onChange({ ...value, [trigger]: { ...choice, type: event.target.value as RecoveryChoice['type'] } })}><option value="none">회복 안 함</option><option value="full">전량</option>{kind === 'counter' && <option value="fixed">정량 · 사용자 지정</option>}</select></label>
      {kind === 'counter' && choice.type === 'fixed' && <label>회복량<input aria-label={`${name} 회복량`} type="number" min={0} max={1000000} step={1} value={choice.value} disabled={disabled} onChange={event => onChange({ ...value, [trigger]: { ...choice, value: Number(event.target.value) } })} /></label>}
    </div>;
  })}<p className="muted">긴 휴식은 전용 규칙이 없을 때 짧은 휴식 규칙을 한 번 적용합니다.</p></fieldset>;
}
