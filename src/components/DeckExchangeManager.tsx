import { useState } from 'react';
import type { Library } from '../shared/contracts';
import type { DeckNotice, DeckPreview } from '../shared/deck-exchange';
import { Modal } from './Modal';

function Notices({ notices }: { notices: DeckNotice[] }) {
  if (!notices.length) return null;
  return <ul aria-label="카드별 안내">{notices.map(({ card, kind, detail }, index) =>
    <li key={index}><strong>{card}</strong> · {kind === 'image' ? '이미지' : '자원 연결'}<p>{detail}</p></li>)}</ul>;
}

export function DeckExchangeManager({ library, activeDeckId, onClose, onLibrary }: {
  library: Library; activeDeckId?: string; onClose: () => void; onLibrary: (library: Library) => void;
}) {
  const [deckId, setDeckId] = useState(activeDeckId ?? library.decks[0]?.id ?? '');
  const [characterId, setCharacterId] = useState(library.libraryState.activeCharacterId ?? library.profiles[0]?.id ?? '');
  const [preview, setPreview] = useState<DeckPreview>();
  const [complete, setComplete] = useState<{ text: string; notices: DeckNotice[] }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(action: 'export' | 'inspect' | 'apply') {
    if (busy) return;
    setBusy(true);
    setError('');
    setComplete(undefined);
    if (action !== 'apply') setPreview(undefined);
    try {
      if (action === 'export') {
        const result = await window.desktop.exportDeck({ deckId });
        if (!result.ok) { setError(result.error); return; }
        if ('canceled' in result.value) return;
        setComplete({ text: `카드 ${result.value.cards}장의 덱 JSON을 저장했습니다.`, notices: result.value.notices });
      } else if (action === 'inspect') {
        const result = await window.desktop.inspectDeck({ characterId });
        if (!result.ok) { setError(result.error); return; }
        if (!('canceled' in result.value)) setPreview(result.value);
      } else if (preview) {
        const result = await window.desktop.importDeck({ token: preview.token, characterId });
        if (!result.ok) { setError(result.error); return; }
        setPreview(undefined);
        onLibrary(result.value.library);
        const text = result.value.replayed ? `‘${result.value.name}’ 덱을 이미 가져왔습니다. 기존 덱을 그대로 사용하세요.`
          : `‘${result.value.name}’ 덱을 추가했습니다. 상단에서 캐릭터와 새 덱을 선택하세요.`;
        setComplete({ text, notices: result.value.notices });
      }
    } catch { setError('덱 교환 결과를 확인하지 못했습니다. 파일과 저장 공간을 확인해 주세요.'); }
    finally { setBusy(false); }
  }

  return <Modal title="덱 JSON 교환" wide onClose={() => { if (!busy) onClose(); }}>
    <p className="manager-help">카드 정의와 순서를 교환합니다. 현재 잔여량과 사용 기록을 보관하려면 전체 백업을 사용하세요.</p>
    <section aria-label="덱 내보내기">
      <label className="form-field">내보낼 덱<select aria-label="내보낼 덱" value={deckId} disabled={busy} onChange={event => setDeckId(event.target.value)}>
        {!library.decks.length && <option value="">등록된 덱 없음</option>}
        {library.decks.map(deck => <option value={deck.id} key={deck.id}>{library.profiles.find(profile => profile.id === deck.characterId)?.name} · {deck.name}</option>)}
      </select></label>
      <button disabled={!deckId || busy} onClick={() => void run('export')}>덱 JSON 내보내기</button>
    </section>
    <section aria-label="덱 불러오기">
      <label className="form-field">가져올 캐릭터<select aria-label="가져올 캐릭터" value={characterId} disabled={busy} onChange={event => { setCharacterId(event.target.value); setPreview(undefined); setError(''); setComplete(undefined); }}>
        {!library.profiles.length && <option value="">먼저 캐릭터를 만드세요</option>}
        {library.profiles.map(profile => <option value={profile.id} key={profile.id}>{profile.name}</option>)}
      </select></label>
      <button disabled={!characterId || busy} onClick={() => void run('inspect')}>덱 JSON 파일 선택</button>
    </section>
    {preview && <section className="registration-summary" aria-label="덱 불러오기 미리보기">
      <h3>{preview.characterName} · {preview.name}</h3>
      <p>{preview.existing ? '이 캐릭터가 이미 가져온 파일입니다. 기존 덱과 잔여량을 그대로 사용합니다.' : `카드 ${preview.cards.length}장을 새 덱으로 추가합니다.`}</p>
      {preview.renamed && <p>같은 이름의 덱이 있어 새 이름을 붙였습니다.</p>}
      {!preview.existing && preview.duplicateCardNames > 0 && <p>라이브러리에 이름이 같은 카드 {preview.duplicateCardNames}장이 있습니다. 새 카드로 등록합니다.</p>}
      {preview.cards.length > 0 && <details><summary>카드 순서 보기</summary><ol>{preview.cards.map((card, index) => <li key={index}>{card}</li>)}</ol></details>}
      <Notices notices={preview.notices}/>
      <div className="modal-actions">
        <button disabled={busy} onClick={() => setPreview(undefined)}>미리보기 닫기</button>
        <button className="primary" disabled={busy} onClick={() => void run('apply')}>{preview.existing ? '기존 덱 확인' : '새 덱 불러오기 확정'}</button>
      </div>
    </section>}
    {complete && <section aria-label="덱 교환 결과"><p role="status">{complete.text}</p><Notices notices={complete.notices}/></section>}
    {error && <p className="error-banner" role="alert">{error}</p>}
  </Modal>;
}
