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
  const [mode, setMode] = useState<'new'|'append'>('new');
  const [targetId, setTargetId] = useState('');
  const [preview, setPreview] = useState<DeckPreview>();
  const [complete, setComplete] = useState<{ text: string; notices: DeckNotice[] }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const targets = library.decks.filter(deck=>deck.characterId===characterId);
  const target = targets.find(deck=>deck.id===targetId) ?? targets[0];
  const destination = { characterId, ...(mode==='append'&&target?{deckId:target.id}:{}) };
  function clearPreview() { setPreview(undefined); setError(''); setComplete(undefined); }

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
        const result = await window.desktop.inspectDeck(destination);
        if (!result.ok) { setError(result.error); return; }
        if (!('canceled' in result.value)) setPreview(result.value);
      } else if (preview) {
        const result = await window.desktop.importDeck({ token: preview.token, ...destination });
        if (!result.ok) { setError(result.error); return; }
        setPreview(undefined);
        onLibrary(result.value.library);
        const text = mode==='append' ? result.value.replayed ? '이 파일을 이미 반영했습니다. 덱과 자원은 그대로입니다.'
          : `‘${result.value.name}’ 덱에 카드 ${result.value.added}장을 추가했습니다.`
          : result.value.replayed ? `‘${result.value.name}’ 덱을 이미 가져왔습니다. 기존 덱을 그대로 사용하세요.`
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
      <label className="form-field">가져오는 방식<select value={mode} disabled={busy} onChange={event=>{setMode(event.target.value as typeof mode);clearPreview();}}>
        <option value="new">새로운 덱 생성</option><option value="append">기존 덱에 카드 추가</option>
      </select></label>
      <label className="form-field">가져올 캐릭터<select aria-label="가져올 캐릭터" value={characterId} disabled={busy} onChange={event => { setCharacterId(event.target.value); setTargetId(''); clearPreview(); }}>
        {!library.profiles.length && <option value="">먼저 캐릭터를 만드세요</option>}
        {library.profiles.map(profile => <option value={profile.id} key={profile.id}>{profile.name}</option>)}
      </select></label>
      {mode==='append'&&<label className="form-field">추가할 덱<select value={target?.id??''} disabled={busy} onChange={event=>{setTargetId(event.target.value);clearPreview();}}>
        {!targets.length&&<option value="">선택 가능한 덱 없음</option>}{targets.map(deck=><option key={deck.id} value={deck.id}>{deck.name}</option>)}
      </select></label>}
      <button disabled={!characterId || busy || mode==='append'&&!target} onClick={() => void run('inspect')}>덱 JSON 파일 선택</button>
    </section>
    {preview && <section className="registration-summary" aria-label="덱 불러오기 미리보기">
      <h3>{preview.characterName} · {preview.name}</h3>
      {preview.append ? <>
        {preview.existing&&<p>이 덱에 이미 반영한 파일입니다.</p>}
        <h4>신규 추가 {preview.append.added.length}장</h4>
        {preview.append.added.length>0&&<ol>{preview.append.added.map((name,index)=><li key={index}>{name}</li>)}</ol>}
        <h4>중복 {preview.append.duplicates.length}장</h4>
        {preview.append.duplicates.length>0&&<ul>{preview.append.duplicates.map((name,index)=><li key={index}>{name}</li>)}</ul>}
        <h4>충돌 {preview.append.conflicts.length}장</h4>
        {preview.append.conflicts.length>0&&<ul>{preview.append.conflicts.map(({card,detail},index)=><li key={index}>{card} · {detail}</li>)}</ul>}
      </> : <p>{preview.existing ? '이 캐릭터가 이미 가져온 파일입니다. 기존 덱과 잔여량을 그대로 사용합니다.' : `카드 ${preview.cards.length}장을 새 덱으로 추가합니다.`}</p>}
      {preview.renamed && <p>같은 이름의 덱이 있어 새 이름을 붙였습니다.</p>}
      {!preview.append && !preview.existing && preview.duplicateCardNames > 0 && <p>라이브러리에 이름이 같은 카드 {preview.duplicateCardNames}장이 있습니다. 새 카드로 등록합니다.</p>}
      {preview.cards.length > 0 && <details><summary>카드 순서 보기</summary><ol>{preview.cards.map((card, index) => <li key={index}>{card}</li>)}</ol></details>}
      <Notices notices={preview.notices}/>
      <div className="modal-actions">
        <button disabled={busy} onClick={() => setPreview(undefined)}>미리보기 닫기</button>
        <button className="primary" disabled={busy||!!preview.append&&!preview.existing&&!preview.append.added.length} onClick={() => void run('apply')}>{preview.existing ? '기존 덱 확인' : preview.append ? '기존 덱에 추가 확정' : '새 덱 불러오기 확정'}</button>
      </div>
    </section>}
    {complete && <section aria-label="덱 교환 결과"><p role="status">{complete.text}</p><Notices notices={complete.notices}/></section>}
    {error && <p className="error-banner" role="alert">{error}</p>}
  </Modal>;
}
