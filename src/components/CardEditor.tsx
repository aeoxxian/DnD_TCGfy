import { useState, type FormEvent, type DragEvent } from 'react';
import { cardDraftSchema, type CardDefinition, type CardDraft, type Tag, type AssetPreview, type Library, type RegistrationTarget } from '../shared/contracts';
import { ACTION_NAMES, KIND_NAMES, RANGE_NAMES, ROLE_NAMES, normalizeText } from '../shared/library';
import { Modal } from './Modal';
import { toggleValue } from './Filters';

function Checks<T extends string>({ title, choices, values, onChange, disabled }: { title: string; choices: Record<T, string>; values: T[]; onChange: (values: T[]) => void; disabled: boolean }) {
  return <fieldset className="editor-checks" disabled={disabled}><legend>{title}</legend><div>{(Object.entries(choices) as [T, string][]).map(([id, name]) => <label key={id}><input type="checkbox" checked={values.includes(id)} onChange={() => onChange(toggleValue(values, id))} />{name}</label>)}</div></fieldset>;
}
function draftFromCard(card?: CardDefinition): CardDraft {
  return card ? { id: card.id, name: card.name, kind: card.kind, imageAssetId: card.imageAssetId, roles: card.roles, actions: card.actions, range: card.range, tags: card.tags, description: card.description, spellLevel: card.spellLevel } : { name: '', kind: 'other', roles: [], actions: ['action'], range: { kind: 'special' }, tags: [] };
}

export function CardEditor({ card, initialAssets = [], tags, onLibrary, onClose, registrationTarget = null, targetLabel }: { card?: CardDefinition; initialAssets?: AssetPreview[]; tags: Tag[]; onLibrary: (library: Library) => void; onClose: () => void; registrationTarget?: RegistrationTarget | null; targetLabel?: string }) {
  const [target] = useState(registrationTarget);
  const [destinationLabel] = useState(targetLabel);
  const [draft, setDraft] = useState<CardDraft>(() => draftFromCard(card));
  const [assets, setAssets] = useState(initialAssets);
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(initialAssets.map(asset => [asset.id, asset.name])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  async function importFiles(files: File[]) {
    if (!files.length || busy) return;
    if (card && files.length > 1) { setError('교체할 이미지는 한 장만 선택해 주세요.'); return; }
    if (!card && assets.length + files.length > 100) { setError('한 번에 최대 100장까지 등록할 수 있습니다.'); return; }
    setBusy(true); setError('');
    try {
      const result = await window.desktop.importImages(files);
      if (!result.ok) { setError(result.error); return; }
      setAssets(current => card ? result.value.assets.length ? result.value.assets : current : [...current, ...result.value.assets]);
      setNames(current => ({ ...current, ...Object.fromEntries(result.value.assets.map(asset => [asset.id, asset.name])) }));
      setImportErrors(result.value.errors.map(item => `${item.name}: ${item.message}`));
    } catch { setError('이미지 가져오기에 실패했습니다. 다시 선택해 주세요.'); }
    finally { setBusy(false); }
  }
  function drop(event: DragEvent) { event.preventDefault(); if (event.dataTransfer.files.length) void importFiles(Array.from(event.dataTransfer.files)); }
  async function addTag() {
    if (!newTag.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const result = await window.desktop.saveTag({ name: newTag });
      if (!result.ok) { setError(result.error); return; }
      const tag = result.value.tags.find(tag => normalizeText(tag.name) === normalizeText(newTag));
      onLibrary(result.value);
      if (tag) setDraft(current => ({ ...current, tags: [...new Set([...current.tags, tag.id])] }));
      setNewTag('');
    } catch { setError('태그를 저장하지 못했습니다.'); } finally { setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    const candidates = card ? [{ ...draft, imageAssetId: assets.at(-1)?.id ?? draft.imageAssetId }] : assets.length ? assets.map(asset => ({ ...draft, name: names[asset.id] ?? asset.name, imageAssetId: asset.id })) : [draft];
    const parsed = candidates.map(value => cardDraftSchema.safeParse(value));
    const invalid = parsed.find(result => !result.success);
    if (invalid && !invalid.success) { setError(invalid.error.issues[0].message); return; }
    setBusy(true); setError('');
    try {
      const result = await window.desktop.saveCards({ cards: candidates, registrationTarget: card ? undefined : target });
      if (!result.ok) { setError(result.error); return; }
      onLibrary(result.value); onClose();
    } catch { setError('카드를 저장하지 못했습니다. 기존 카드는 유지됩니다.'); } finally { setBusy(false); }
  }
  return <Modal title={card ? '카드 정보 수정' : '카드 등록'} onClose={() => { if (!busy) onClose(); }} wide>
    <form className="card-editor" onSubmit={event => void submit(event)} aria-busy={busy}>
      {!card && <p className="registration-note">{target ? `등록하면 ${destinationLabel ?? '선택한 덱'}에 자동으로 추가됩니다.` : '활성 덱이 없어 라이브러리에만 등록합니다. 캐릭터·덱을 선택하면 새 카드를 자동으로 연결할 수 있습니다.'}</p>}
      <div className="drop-zone" onDragOver={event => event.preventDefault()} onDrop={drop}><strong>{card ? '이미지 교체' : '이미지를 선택하거나 여기에 놓으세요'}</strong><p>PNG · JPEG · WebP / 원본 파일은 그대로 보관합니다.</p><label className="file-button">{card ? '교체 이미지 선택' : '이미지 선택'}<input type="file" aria-label={card ? '교체 이미지 파일' : '카드 이미지 파일'} accept=".png,.jpg,.jpeg,.webp" multiple={!card} disabled={busy} onChange={event => { void importFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} /></label></div>
      {busy && <p className="muted">이미지 또는 정보를 저장하는 중…</p>}
      {!!importErrors.length && <ul className="import-errors">{importErrors.map((message, i) => <li key={i}>{message}</li>)}</ul>}
      {!card && assets.length > 0 ? <div className="import-list">{assets.map((asset, i) => <div className="import-row" key={asset.id}><img src={asset.thumbnailUrl} alt={`${asset.name} 등록 미리보기`} /><label>카드 이름 {i + 1}<input value={names[asset.id] ?? asset.name} required maxLength={200} disabled={busy} onChange={event => setNames(current => ({ ...current, [asset.id]: event.target.value }))} /></label><button type="button" disabled={busy} aria-label={`${asset.name} 등록 목록에서 제외`} onClick={() => setAssets(current => current.filter(item => item.id !== asset.id))}>제외</button></div>)}</div> : <label className="form-field">카드 이름<input autoFocus value={draft.name} required maxLength={200} disabled={busy} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>}
      {card && assets.length > 0 && <div className="replacement-preview"><img src={assets.at(-1)!.thumbnailUrl} alt="교체 이미지 미리보기" /><p>저장하면 이 카드의 이미지만 교체됩니다.<br />분류·태그·덱 구성은 유지됩니다.</p></div>}
      {assets.length > 1 && <p className="muted">아래 속성을 {assets.length}장에 공통 적용합니다. 저장 후 각 카드에서 개별 수정할 수 있습니다.</p>}
      <label className="form-field">카드 유형<select aria-label="카드 유형" value={draft.kind} disabled={busy} onChange={event => setDraft({ ...draft, kind: event.target.value as CardDraft['kind'], spellLevel: event.target.value === 'spell' ? draft.spellLevel : undefined })}>{Object.entries(KIND_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <p className="muted">유형과 역할은 별도입니다. 예를 들어 공격 역할의 주문은 유형 ‘주문’, 역할 ‘공격’으로 분류합니다.</p>
      <Checks title="카드 역할" disabled={busy} choices={ROLE_NAMES} values={draft.roles} onChange={roles => setDraft({ ...draft, roles })} />
      <Checks title="카드 행동 경제" disabled={busy} choices={ACTION_NAMES} values={draft.actions} onChange={actions => setDraft({ ...draft, actions })} />
      <details className="editor-advanced"><summary>고급 설정 · 사거리 / 태그 / 메모</summary>
        <div className="form-columns"><label className="form-field">사거리<select aria-label="사거리" value={draft.range.kind} disabled={busy} onChange={event => setDraft({ ...draft, range: { ...draft.range, kind: event.target.value as CardDraft['range']['kind'] } })}>{Object.entries(RANGE_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label className="form-field">거리 (ft, 선택)<input type="number" min={0} max={100000} step={1} value={draft.range.feet ?? ''} disabled={busy} onChange={event => setDraft({ ...draft, range: { ...draft.range, feet: event.target.value === '' ? undefined : Number(event.target.value) } })} /></label></div>
        {draft.kind === 'spell' && <label className="form-field">주문 레벨 (선택)<select aria-label="주문 레벨 (선택)" value={draft.spellLevel ?? ''} disabled={busy} onChange={event => setDraft({ ...draft, spellLevel: event.target.value === '' ? undefined : Number(event.target.value) })}><option value="">미지정</option>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i}>{i === 0 ? '0 · 소마법' : i}</option>)}</select></label>}
        <Checks title="카드 태그" disabled={busy} choices={Object.fromEntries(tags.map(tag => [tag.id, tag.name]))} values={draft.tags} onChange={selected => setDraft({ ...draft, tags: selected })} />
        <div className="inline-form"><label>새 태그<input maxLength={60} value={newTag} disabled={busy} onChange={event => setNewTag(event.target.value)} /></label><button type="button" disabled={busy || !newTag.trim()} onClick={() => void addTag()}>태그 추가</button></div>
        <label className="form-field">메모 (선택)<textarea maxLength={10000} value={draft.description ?? ''} disabled={busy} rows={3} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
        <p className="muted">주문 레벨은 기록만 합니다. 자원 연결과 소비는 후속 단계에서 지원합니다.</p>
      </details>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" disabled={busy} onClick={onClose}>취소</button><button className="primary" type="submit" disabled={busy}>{card ? '수정 저장' : assets.length > 1 ? `${assets.length}장 등록` : '카드 저장'}</button></div>
    </form>
  </Modal>;
}
