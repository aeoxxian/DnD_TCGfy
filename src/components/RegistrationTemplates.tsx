import { useState } from 'react';
import type { RegistrationTemplate } from '../shared/contracts';
import { normalizeText } from '../shared/library';

/**
 * v1.3 Phase 2: saved registration templates. Applying one fills the common settings (or the single-card form);
 * saving stores the current settings under a name (same name = replace). At most 20.
 */
export function TemplateBar({ templates, busy, onApply, onSave, capture, notes }: {
  templates: RegistrationTemplate[]; busy: boolean;
  onApply: (template: RegistrationTemplate) => void;
  onSave: (templates: RegistrationTemplate[]) => Promise<boolean>;
  /** The current settings as a template, or an error message when they cannot be saved as one. */
  capture: (id: string, name: string) => RegistrationTemplate | string;
  notes: string[];
}) {
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const chosen = templates.find(item => item.id === selected);
  async function save() {
    setError(''); setMessage('');
    const existing = templates.find(item => normalizeText(item.name) === normalizeText(name));
    if (!existing && templates.length >= 20) { setError('템플릿은 20개까지 저장할 수 있습니다. 쓰지 않는 템플릿을 지워 주세요.'); return; }
    const value = capture(existing?.id ?? crypto.randomUUID(), name);
    if (typeof value === 'string') { setError(value); return; }
    const next = existing ? templates.map(item => item.id === existing.id ? value : item) : [...templates, value];
    if (await onSave(next)) { setMessage(existing ? `‘${value.name}’ 템플릿을 지금 설정으로 바꿨습니다.` : `‘${value.name}’ 템플릿을 저장했습니다.`); setSelected(value.id); setName(''); }
    else setError('템플릿을 저장하지 못했습니다. 다시 시도해 주세요.');
  }
  async function remove() {
    if (!chosen) return;
    setError(''); setMessage('');
    if (await onSave(templates.filter(item => item.id !== chosen.id))) { setMessage(`‘${chosen.name}’ 템플릿을 지웠습니다.`); setSelected(''); }
    else setError('템플릿을 지우지 못했습니다.');
    setConfirmDelete(false);
  }
  return <section className="template-bar" aria-label="등록 템플릿">
    <div className="template-row">
      <label className="form-field">등록 템플릿<select aria-label="등록 템플릿 선택" value={selected} disabled={busy} onChange={event => { setSelected(event.target.value); setConfirmDelete(false); setMessage(''); setError(''); }}>
        <option value="">{templates.length ? '템플릿을 고르세요' : '저장한 템플릿이 없습니다'}</option>
        {templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <button type="button" disabled={busy || !chosen} onClick={() => { if (chosen) { onApply(chosen); setMessage(`‘${chosen.name}’ 템플릿을 적용했습니다.`); setError(''); } }}>템플릿 적용</button>
      {confirmDelete && chosen
        ? <span className="template-confirm"><span>‘{chosen.name}’을(를) 지울까요?</span><button type="button" className="danger" disabled={busy} onClick={() => void remove()}>지우기</button><button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>취소</button></span>
        : <button type="button" disabled={busy || !chosen} onClick={() => setConfirmDelete(true)}>템플릿 삭제</button>}
    </div>
    <div className="template-row">
      <label className="form-field">새 템플릿 이름<input aria-label="새 템플릿 이름" maxLength={40} value={name} disabled={busy} placeholder="예: 1레벨 공격 주문" onChange={event => setName(event.target.value)}/></label>
      <button type="button" disabled={busy || !name.trim()} onClick={() => void save()}>지금 설정을 템플릿으로 저장</button>
    </div>
    <p className="muted template-help">유형·주문 레벨·역할·행동 경제·사거리·태그·사용 규칙·덱 연결을 저장합니다. 카드 이름·이미지·설명은 저장하지 않습니다.</p>
    {(message || notes.length > 0) && <div className="template-notes" role="status">{message && <p>{message}</p>}{notes.map((note, i) => <p key={i}>{note}</p>)}</div>}
    {error && <p className="error-banner" role="alert">{error}</p>}
  </section>;
}
