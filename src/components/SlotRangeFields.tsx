import type { BasicRuleDraft } from '../shared/use-rules';

export function SlotRangeFields({ draft, onChange, label = value => value }: {
  draft: BasicRuleDraft; onChange: (patch: Partial<BasicRuleDraft>) => void; label?: (value: string) => string;
}) {
  const base = draft.spellLevel || 1;
  const range = draft.minLevel !== undefined || draft.maxLevel !== undefined || draft.belowBase
    ? 'custom' : draft.allowUpcast === false ? 'fixed' : 'default';
  const minimum = Math.max(draft.minLevel ?? 1, draft.belowBase ? 1 : base);
  const maximum = Math.min(draft.maxLevel ?? 9, draft.allowUpcast === false ? base : 9);
  function setRange(minLevel: number, maxLevel: number) {
    onChange({ minLevel, maxLevel, allowUpcast: maxLevel > base, belowBase: minLevel < base, homebrew: minLevel < base || draft.homebrew });
  }
  return <>
    <label className="form-field">허용 슬롯 범위<select aria-label={label('허용 슬롯 범위')} value={range} onChange={event => {
      if (event.target.value === 'custom') setRange(base, 9);
      else onChange({ allowUpcast: event.target.value !== 'fixed', belowBase: false, minLevel: undefined, maxLevel: undefined });
    }}><option value="default">기본 레벨 이상</option><option value="fixed">기본 레벨 슬롯만</option><option value="custom">사용자 정의 범위</option></select></label>
    {range === 'custom' && <div className="form-columns">
      <label className="form-field">최소 슬롯 레벨<input aria-label={label('최소 슬롯 레벨')} type="number" min={1} max={9} required value={draft.minLevel === 0 ? '' : minimum} onChange={event => setRange(Number(event.target.value), maximum)}/></label>
      <label className="form-field">최대 슬롯 레벨<input aria-label={label('최대 슬롯 레벨')} type="number" min={1} max={9} required value={maximum || ''} onChange={event => setRange(minimum, Number(event.target.value))}/></label>
    </div>}
  </>;
}
