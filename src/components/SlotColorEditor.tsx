import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { SlotColor, SlotColorSet } from '../shared/contracts';
import type { ResourceSnapshot } from '../shared/resources';
import { DEFAULT_SLOT_COLOR, SLOT_FAMILY_NAMES, SLOT_PALETTE, contrastRatio, lowContrast, PARCHMENT, slotColor, tidySlotColors, type SlotFamily } from '../shared/slot-colors';

type Level = keyof NonNullable<SlotColor['levels']>;

/** Palette radios plus a custom picker. The picker saves on its native `change` (when it closes), not on every drag step. */
function Swatches({ label, value, disabled, onPick }: { label: string; value: string; disabled: boolean; onPick: (hex: string) => void }) {
  const custom = useRef<HTMLInputElement>(null);
  const pick = useRef(onPick);
  useEffect(() => { pick.current = onPick; });
  useEffect(() => {
    const input = custom.current!; const commit = () => pick.current(input.value.toLowerCase());
    input.addEventListener('change', commit); return () => input.removeEventListener('change', commit);
  }, []);
  useEffect(() => { if (custom.current) custom.current.value = value; }, [value]);
  const inPalette = SLOT_PALETTE.some(swatch => swatch.hex === value);
  return <div className="slot-swatches" role="radiogroup" aria-label={`${label} 색상`}>
    {SLOT_PALETTE.map(swatch => <button key={swatch.hex} type="button" role="radio" className="slot-swatch" aria-checked={swatch.hex === value} aria-label={`${label} · ${swatch.name}`} title={swatch.name} disabled={disabled} style={{ '--swatch': swatch.hex } as CSSProperties} onClick={() => onPick(swatch.hex)}/>)}
    <label className={`slot-swatch-custom ${inPalette ? '' : 'is-custom'}`} title="직접 선택"><span aria-hidden="true">직접</span><input ref={custom} type="color" aria-label={`${label} 직접 색상`} defaultValue={value} disabled={disabled}/></label>
  </div>;
}

function GemPreview({ color }: { color: string }) {
  return <span className="slot-color-preview"><span className={`resource-gems sapphire ${lowContrast(color) ? 'low-contrast' : ''}`} style={{ '--slot-gem': color } as CSSProperties} aria-hidden="true"><i className="gem filled"/><i className="gem filled"/><i className="gem"/></span><strong>2 / 3</strong></span>;
}

/**
 * Spell slot gem colours for one character (관리 → 자원 관리). Display only: counts, spending and recovery never change.
 */
export function SlotColorEditor({ snapshot, characterName, value, busy, onChange }: { snapshot: ResourceSnapshot; characterName?: string; value?: SlotColorSet; busy: boolean; onChange: (next?: SlotColorSet) => void }) {
  const families = (['standard', 'pact'] as const).map(family => ({
    family,
    levels: [...new Set(snapshot.resources.filter(r => r.kind === 'slot_track' && r.template.slotKind === family)
      .flatMap(r => Object.entries(r.capacityByLevel ?? {}).filter(([, capacity]) => capacity > 0).map(([level]) => Number(level))))].sort((a, b) => a - b),
    present: snapshot.resources.some(r => r.kind === 'slot_track' && r.template.slotKind === family),
  })).filter(item => item.present);
  const [perLevel, setPerLevel] = useState<Record<SlotFamily, boolean>>({ standard: !!value?.standard?.levels, pact: !!value?.pact?.levels });
  const save = (family: SlotFamily, entry: SlotColor) => onChange(tidySlotColors({ ...value, [family]: entry }));
  const setBase = (family: SlotFamily, hex: string) => save(family, { ...value?.[family], base: hex === DEFAULT_SLOT_COLOR ? undefined : hex });
  const setLevel = (family: SlotFamily, level: number, hex: string) => {
    const levels = { ...value?.[family]?.levels, [String(level)]: hex } as SlotColor['levels'];
    if (hex === (value?.[family]?.base ?? DEFAULT_SLOT_COLOR)) delete levels![String(level) as Level];
    save(family, { ...value?.[family], levels });
  };
  const togglePerLevel = (family: SlotFamily, on: boolean) => {
    setPerLevel(current => ({ ...current, [family]: on }));
    if (!on && value?.[family]?.levels) save(family, { ...value[family], levels: undefined });
  };
  return <section className="slot-colors" aria-label="주문 슬롯 색상">
    <h3 className="manager-subtitle">주문 슬롯 색상{characterName ? ` · ${characterName}` : ''}</h3>
    <p className="muted">장부의 슬롯 보석 색만 바꿉니다. 슬롯 수·사용·회복 계산과 숫자 표시는 그대로이며, 캐릭터마다 따로 저장됩니다.</p>
    {!families.length ? <p className="muted">이 캐릭터에는 일반·계약 주문 슬롯이 없습니다.</p> : families.map(({ family, levels }) => {
      const name = SLOT_FAMILY_NAMES[family]; const base = slotColor(value, family);
      return <fieldset className="slot-color-family" key={family}>
        <legend>{name}</legend>
        <div className="slot-color-row"><Swatches label={name} value={base} disabled={busy} onPick={hex => setBase(family, hex)}/><GemPreview color={base}/></div>
        {lowContrast(base) && <p className="slot-color-warning" role="note">양피지 바탕과 대비가 낮습니다({contrastRatio(base, PARCHMENT).toFixed(1)}:1). 보석에 어두운 테두리를 더해 표시합니다.</p>}
        {levels.length > 1 || family === 'pact' ? <label className="checkbox-line"><input type="checkbox" aria-label={`${name} 레벨별로 지정`} checked={perLevel[family]} disabled={busy} onChange={event => togglePerLevel(family, event.target.checked)}/>레벨별로 지정</label> : null}
        {perLevel[family] && <div className="slot-color-levels">{levels.map(level => {
          const color = slotColor(value, family, level);
          return <div className="slot-color-level" key={level}><span className="slot-color-level-name">{level}레벨</span><Swatches label={`${name} ${level}레벨`} value={color} disabled={busy} onPick={hex => setLevel(family, level, hex)}/><GemPreview color={color}/></div>;
        })}</div>}
      </fieldset>;
    })}
    <div className="modal-actions"><button type="button" disabled={busy || !value} onClick={() => { setPerLevel({ standard: false, pact: false }); onChange(undefined); }}>기본 색상으로 복원</button></div>
  </section>;
}
