import { useState } from 'react';
import type { Library } from '../shared/contracts';
import type { DeckNotice, DeckPreview, DeckImportResult } from '../shared/deck-exchange';
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
  const [choices,setChoices] = useState<Record<string,string>>({});
  const [complete, setComplete] = useState<{ text: string; notices: DeckNotice[]; warnings?: string[]; summary?: DeckImportResult['summary'] }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const targets = library.decks.filter(deck=>deck.characterId===characterId);
  const target = targets.find(deck=>deck.id===targetId) ?? targets[0];
  const destination = { characterId, ...(mode==='append'&&target?{deckId:target.id}:{}) };
  const resolvedLinks = new Set(preview?.append?.linkedIds??[]);
  for (const item of preview?.restorable ?? []) if (choices[item.ref] !== 'skip') resolvedLinks.add(item.id);
  const disputed = preview?.ambiguousRestores ?? [];
  for (const item of disputed) {
    const chosen = item.candidates.find(candidate=>choices[item.ref]===`restore:${candidate.id}`);
    if (chosen) resolvedLinks.add(chosen.id);
  }
  let resolvedCopies = 0;
  for (const conflict of preview?.append?.conflicts??[]) {
    const selected = conflict.ref ? choices[conflict.ref] : undefined;
    if (selected==='copy') resolvedCopies++;
    const candidate=conflict.candidates?.find(item=>selected===`link:${item.id}`);
    if (candidate&&!candidate.inDeck) resolvedLinks.add(candidate.id);
  }
  const plannedAdded=(preview?.append?.created.length??0)+resolvedCopies+resolvedLinks.size;
  function clearPreview() { setPreview(undefined); setError(''); setComplete(undefined); }

  async function run(action: 'export' | 'inspect' | 'apply', format: 'json' | 'zip' = 'json') {
    if (busy) return;
    setBusy(true);
    setError('');
    setComplete(undefined);
    if (action !== 'apply') setPreview(undefined);
    try {
      if (action === 'export') {
        const result = await window.desktop.exportDeck({ deckId, ...(format === 'zip' ? { format } : {}) });
        if (!result.ok) { setError(result.error); return; }
        if ('canceled' in result.value) return;
        setComplete({ text: `카드 ${result.value.cards}장의 덱 ${format.toUpperCase()}을 저장했습니다.`, notices: result.value.notices });
      } else if (action === 'inspect') {
        const result = await window.desktop.inspectDeck(destination);
        if (!result.ok) { setError(result.error); return; }
        if (!('canceled' in result.value)) { setChoices({}); setPreview(result.value); }
      } else if (preview) {
        const decisions = Object.fromEntries(Object.entries(choices).map(([ref,value]) => [ref,
          value.startsWith('restore:')?{mode:'restore' as const,cardId:value.slice(8)}
            :value==='restore'?{mode:'restore' as const}:value==='copy'?{mode:'copy' as const}:value==='skip'?{mode:'skip' as const}:{mode:'link' as const,cardId:value.slice(5)}]));
        const result = await window.desktop.importDeck({ token: preview.token, ...destination, decisions });
        if (!result.ok) { setError(result.error); return; }
        setPreview(undefined);
        onLibrary(result.value.library);
        const summary = result.value.summary;
        const counts = `기존 연결 ${summary?.linked.length??0}장, 신규 등록 ${summary?.created.length??0}장, 휴지통 복원 ${summary?.restored?.length??0}장 · 중복 ${summary?.duplicates.length??0}장, 휴지통에 남긴 카드 ${summary?.trashed.length??0}장, 건너뛴 충돌 ${summary?.skipped.length??0}장.`;
        const text = preview.append ? `‘${result.value.name}’ 덱에 카드 ${result.value.added}장을 추가했습니다. ${counts}`
          : `‘${result.value.name}’ 덱을 추가했습니다. 상단에서 캐릭터와 새 덱을 선택하세요. ${counts}`;
        setComplete({ text, notices: result.value.notices, summary, warnings:result.value.warnings });
      }
    } catch { setError('덱 교환 결과를 확인하지 못했습니다. 파일과 저장 공간을 확인해 주세요.'); }
    finally { setBusy(false); }
  }

  return <Modal title="덱 JSON·ZIP 교환" wide onClose={() => { if (!busy) onClose(); }}>
    <p className="manager-help">JSON에는 카드 정보와 순서가, 덱 ZIP에는 원본 이미지도 포함됩니다. 현재 잔여량과 사용 기록은 관리 메뉴의 전체 백업에 저장됩니다.</p>
    <section aria-label="덱 내보내기">
      <label className="form-field">내보낼 덱<select aria-label="내보낼 덱" value={deckId} disabled={busy} onChange={event => setDeckId(event.target.value)}>
        {!library.decks.length && <option value="">등록된 덱 없음</option>}
        {library.decks.map(deck => <option value={deck.id} key={deck.id}>{library.profiles.find(profile => profile.id === deck.characterId)?.name} · {deck.name}</option>)}
      </select></label>
      <button disabled={!deckId || busy} onClick={() => void run('export')}>덱 JSON 내보내기</button>
      <button disabled={!deckId || busy} onClick={() => void run('export','zip')}>이미지 포함 덱 ZIP 내보내기</button>
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
      <button disabled={!characterId || busy || mode==='append'&&!target} onClick={() => void run('inspect')}>덱 JSON 또는 ZIP 파일 선택</button>
    </section>
    {preview && <section className="registration-summary" aria-label="덱 불러오기 미리보기">
      <h3>{preview.characterName} · {preview.name}</h3>
      {preview.append ? <>
        <p>{mode==='new'?'이 파일로 만든 기존 덱을 확인합니다. ':''}현재 덱에 빠진 카드만 추가합니다.</p>
        <h4>추가 예정 {plannedAdded}장</h4>
        {preview.append.linked.length>0&&<p>기존 카드 연결 · {preview.append.linked.join(' · ')}</p>}
        {preview.append.created.length>0&&<p>새 카드 등록 · {preview.append.created.join(' · ')}</p>}
        <h4>중복 {preview.append.duplicates.length}장</h4>
        {preview.append.duplicates.length>0&&<ul>{preview.append.duplicates.map((name,index)=><li key={index}>{name}</li>)}</ul>}
        <h4>충돌 {preview.append.conflicts.length}장</h4>
        {preview.append.conflicts.length>0&&<ul>{preview.append.conflicts.map(({card,detail,ref,candidates,copyNotices},index)=><li key={ref??index}>{card} · {detail}
          {ref&&<label className="form-field">{card} 가져오기 방법<select value={choices[ref]??'skip'} disabled={busy}
            onChange={event=>setChoices({...choices,[ref]:event.target.value})}>
            <option value="skip">건너뛰기</option>
            {candidates?.map(candidate=><option key={candidate.id} value={`link:${candidate.id}`}>{candidate.label} · {candidate.inDeck?'이미 이 덱에 있음':'기존 설정 유지'}</option>)}
            <option value="copy">JSON의 비용으로 별도 등록</option>
          </select></label>}
          {ref&&choices[ref]==='copy'&&<Notices notices={copyNotices??[]}/>}
        </li>)}</ul>}
      </> : <p>{preview.existing ? '이 캐릭터가 이미 가져온 파일입니다. 기존 덱과 잔여량을 그대로 사용합니다.' : `카드 ${preview.cards.length-(preview.restorable??[]).filter(item=>choices[item.ref]==='skip').length-disputed.filter(item=>!choices[item.ref]||choices[item.ref]==='skip').length}장을 새 덱으로 추가합니다.`}</p>}
      {!!preview.restorable?.length&&<fieldset><legend>휴지통 카드 {preview.restorable.length}장</legend>
        <p>선택한 원본은 가져오기를 확정할 때 복원됩니다. 이전에 연결되어 있던 덱에도 다시 추가됩니다.</p>
        {preview.restorable.map(item=><div key={item.ref}><label className="checkbox-line">
          <input type="checkbox" checked={choices[item.ref]!=='skip'} disabled={busy} onChange={event=>setChoices({...choices,[item.ref]:event.target.checked?'restore':'skip'})}/>
          {item.card} 복원 후 추가</label>
          {!!item.decks.length&&<p>이전 덱 연결 복원 · {item.decks.join(' / ')}</p>}
        </div>)}
      </fieldset>}
      {!!disputed.length&&<fieldset><legend>복원할 카드 선택</legend>
        <p>일치하는 원본이 여러 장 있습니다. 이전 덱을 보고 복원할 카드를 선택하세요.</p>
        {disputed.map(item=><label className="form-field" key={item.ref}>{item.card} 복원 대상
          <select value={choices[item.ref]??'skip'} disabled={busy} onChange={event=>setChoices({...choices,[item.ref]:event.target.value})}>
            <option value="skip">건너뛰기</option>
            {item.candidates.map(candidate=><option key={candidate.id} value={`restore:${candidate.id}`}>{candidate.label}</option>)}
          </select>
        </label>)}
      </fieldset>}
      {preview.renamed && <p>같은 이름의 덱이 있어 새 이름을 붙였습니다.</p>}
      {!preview.append && !preview.existing && preview.duplicateCardNames > 0 && <p>라이브러리에 이름이 같은 카드 {preview.duplicateCardNames}장이 있습니다. 새 카드로 등록합니다.</p>}
      {preview.cards.length > 0 && <details><summary>카드 순서 보기</summary><ol>{preview.cards.map((card, index) => <li key={index}>{card}</li>)}</ol></details>}
      <Notices notices={preview.notices}/>
      <div className="modal-actions">
        <button disabled={busy} onClick={() => setPreview(undefined)}>미리보기 닫기</button>
        <button className="primary" disabled={busy} onClick={() => void run('apply')}>{preview.append
          ? plannedAdded ? '기존 덱에 추가 확정' : '기존 덱 확인'
          : '새 덱 불러오기 확정'}</button>
      </div>
    </section>}
    {complete && <section aria-label="덱 교환 결과"><p role="status">{complete.text}</p>
      {!!complete.summary?.trashed.length&&<p>휴지통에서 복원할 카드 · {complete.summary.trashed.join(' · ')}</p>}
      {!!complete.summary?.skipped.length&&<p>건너뛴 충돌 카드 · {complete.summary.skipped.join(' · ')}</p>}
      {complete.warnings?.map(warning=><p key={warning}>{warning}</p>)}
      <Notices notices={complete.notices}/></section>}
    {error && <p className="error-banner" role="alert">{error}</p>}
  </Modal>;
}
