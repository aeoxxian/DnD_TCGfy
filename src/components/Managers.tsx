import { useState, type FormEvent } from 'react';
import type { Library, Tag, Result } from '../shared/contracts';
import { Modal } from './Modal';

function TagRow({ tag, onLibrary }: { tag: Tag; onLibrary: (value: Library) => void }) {
  const [name, setName] = useState(tag.name);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(remove: boolean) {
    setBusy(true); setError('');
    try {
      const result = remove ? await window.desktop.deleteTag(tag.id) : await window.desktop.saveTag({ id: tag.id, name });
      if (result.ok) { onLibrary(result.value); setConfirm(false); }
      else setError(result.error);
    } catch { setError('태그를 변경하지 못했습니다.'); } finally { setBusy(false); }
  }
  return <div className="tag-row"><label>{tag.name} · {tag.usageCount}장 연결<input aria-label={`${tag.name} 태그 이름`} maxLength={60} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label><div className="tag-actions"><button disabled={busy || name === tag.name || !name.trim()} onClick={() => void submit(false)} aria-label={`${tag.name} 태그 이름 저장`}>이름 저장</button><button disabled={busy} onClick={() => setConfirm(true)} aria-label={`${tag.name} 태그 삭제`}>삭제</button></div>{confirm && <div className="inline-confirm"><p>{tag.usageCount}장의 카드에서 이 공통 태그를 해제합니다. 카드의 나머지 정보는 유지됩니다.</p><button disabled={busy} onClick={() => void submit(true)}>태그 삭제 확인</button><button disabled={busy} onClick={() => setConfirm(false)}>취소</button></div>}{error && <p role="alert" className="error-banner">{error}</p>}</div>;
}
export function TagManager({ library, onLibrary, onClose }: { library: Library; onLibrary: (value: Library) => void; onClose: () => void }) {
  const [name, setName] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await window.desktop.saveTag({ name }); if (result.ok) { onLibrary(result.value); setName(''); } else setError(result.error); }
    catch { setError('태그를 추가하지 못했습니다.'); } finally { setBusy(false); }
  }
  return <Modal title="공통 태그 관리" onClose={onClose}><p className="manager-help">이름 수정과 삭제는 이 태그를 연결한 모든 카드에 적용됩니다. 한 카드의 태그만 바꾸려면 카드 정보 수정을 이용하세요.</p><form className="inline-form" onSubmit={event => void create(event)}><label>새 공통 태그<input maxLength={60} required value={name} onChange={event => setName(event.target.value)} /></label><button disabled={busy}>추가</button></form>{error && <p role="alert" className="error-banner">{error}</p>}<div className="tag-list">{library.tags.map(tag => <TagRow key={tag.id} tag={tag} onLibrary={onLibrary} />)}</div></Modal>;
}
export function ProfileManager({ library, onLibrary, onClose }: { library: Library; onLibrary: (value: Library) => void; onClose: () => void }) {
  const [characterName, setCharacterName] = useState(''); const [deckName, setDeckName] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const active = library.profiles.find(profile => profile.id === library.libraryState.activeCharacterId);
  async function perform(request: () => Promise<Result<Library>>) {
    setBusy(true); setError('');
    try { const result = await request(); if (result.ok) { onLibrary(result.value); setCharacterName(''); setDeckName(''); } else setError(result.error); }
    catch { setError('캐릭터 또는 덱을 저장하지 못했습니다.'); } finally { setBusy(false); }
  }
  return <Modal title="캐릭터와 덱" onClose={onClose}><p className="manager-help">같은 카드를 여러 캐릭터의 덱에 넣을 수 있습니다. 자원은 아직 연결되지 않습니다.</p><form onSubmit={event => { event.preventDefault(); void perform(() => window.desktop.createProfile({ name: characterName })); }} className="inline-form"><label>새 캐릭터 이름<input required maxLength={100} value={characterName} disabled={busy} onChange={event => setCharacterName(event.target.value)} /></label><button disabled={busy}>캐릭터 만들기</button></form>{active && <><h3 className="manager-subtitle">{active.name}의 덱</h3><ul className="deck-list">{library.decks.filter(deck => deck.characterId === active.id).map(deck => <li key={deck.id}>{deck.name}<span>{deck.cardIds.filter(id => library.cards.some(card => card.id === id)).length}장</span></li>)}</ul><form onSubmit={event => { event.preventDefault(); void perform(() => window.desktop.createDeck({ characterId: active.id, name: deckName })); }} className="inline-form"><label>새 덱 이름<input required maxLength={100} value={deckName} disabled={busy} onChange={event => setDeckName(event.target.value)} /></label><button disabled={busy}>덱 만들기</button></form></>}{!active && <p className="muted">상단에서 캐릭터를 선택하면 덱을 관리할 수 있습니다.</p>}{error && <p role="alert" className="error-banner">{error}</p>}</Modal>;
}
