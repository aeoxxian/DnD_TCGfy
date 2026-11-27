import type { CardDraft, ImageMode } from '../shared/contracts';
import { IMAGE_MODE_NAMES } from '../shared/library';

type Traits = Pick<CardDraft, 'concentration' | 'ritual' | 'upcastEffect'>;
const traits = { concentration: '집중', ritual: '의식', upcastEffect: '상위 슬롯 효과 강화' } as const;

export function CardTraits({ value, onChange, disabled, individual, allowEnhancement = true, showEnhancement = true }: {
  value: Traits; onChange: (patch: Traits) => void; disabled?: boolean; individual?: boolean; allowEnhancement?: boolean; showEnhancement?: boolean;
}) {
  return <fieldset className="editor-plain" disabled={disabled}>
    <legend>{individual ? '개별 주문 속성' : '주문 속성'}</legend>
    {Object.entries(traits).map(([name, label]) => {
      const key = name as keyof Traits;
      if (key==='upcastEffect'&&!showEnhancement) return null;
      return <label key={key} className="checkbox-line"><input type="checkbox" disabled={key === 'upcastEffect' && !allowEnhancement} checked={!!value[key] && (key !== 'upcastEffect' || allowEnhancement)} onChange={event => onChange({ [key]: event.target.checked })}/>{individual ? `개별 ${label}` : label}</label>;
    })}
  </fieldset>;
}

export function ImageModeField({ mode, onChange, disabled, individual, noFile }: {
  mode: ImageMode; onChange: (mode: ImageMode) => void; disabled?: boolean; individual?: boolean; noFile?: boolean;
}) {
  return <label className="form-field">{individual ? '개별 이미지 표시 방식' : '이미지 표시 방식'}
    <select value={mode} disabled={disabled} onChange={event => onChange(event.target.value as ImageMode)}>
      {Object.entries(IMAGE_MODE_NAMES).map(([key, label]) => <option key={key} value={key} disabled={noFile && key !== 'none'}>{label}</option>)}
    </select>
  </label>;
}
