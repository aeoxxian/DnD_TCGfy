import type { OwnedResource } from '../shared/contracts';
import { recoveryChoices, recoveryRules } from '../shared/resource-drafts';
import { RecoveryFieldset } from './ResourceFields';

export function OwnedResourcesEditor({ definitions = [], onChange, disabled = false }: {
  definitions?: OwnedResource[];
  onChange: (definitions: OwnedResource[]) => void;
  disabled?: boolean;
}) {
  return <details className="editor-checks">
    <summary>카드 고유 자원{definitions.length ? ` (${definitions.length}개)` : ''}</summary>
    <p className="muted">카드를 덱에 처음 넣으면 캐릭터마다 자원이 생깁니다. 카드를 정상 사용하면 아래 사용량을 다른 비용과 함께 차감합니다.</p>
    {definitions.map((definition, index) => {
      const change = (patch: Partial<OwnedResource>) => onChange(definitions.map(item =>
        item.id === definition.id ? { ...item, ...patch } : item));
      return <fieldset className="editor-checks" key={definition.id} disabled={disabled}>
        <legend>고유 자원 {index + 1}</legend>
        <div className="form-columns">
          <label className="form-field">이름<input aria-label={`고유 자원 ${index + 1} 이름`} required maxLength={100} value={definition.name} onChange={event => change({ name: event.target.value })}/></label>
          <label className="form-field">단위<input required maxLength={30} value={definition.unit} onChange={event => change({ unit: event.target.value })}/></label>
          <label className="form-field">최대량<input required type="number" min={0} max={1000000} value={definition.maximum} onChange={event => change({ maximum: Number(event.target.value) })}/></label>
          <label className="form-field">사용할 때 차감<input required type="number" min={1} max={1000000} value={definition.amount} onChange={event => change({ amount: Number(event.target.value) })}/></label>
        </div>
        <RecoveryFieldset kind="counter" value={recoveryChoices(definition.recovery)} onChange={value => change({ recovery: recoveryRules(value, 'counter') })} disabled={disabled}/>
        <button type="button" onClick={() => onChange(definitions.filter(item => item.id !== definition.id))}>고유 자원 {index + 1} 삭제</button>
      </fieldset>;
    })}
    <button type="button" disabled={disabled || definitions.length >= 12} onClick={() => onChange([
      ...definitions, { id: crypto.randomUUID(), name: '', unit: '회', maximum: 1, amount: 1, recovery: [] },
    ])}>+ 고유 자원 추가</button>
  </details>;
}
