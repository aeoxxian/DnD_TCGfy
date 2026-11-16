import { useEffect, useRef, useState, useMemo, type DragEvent } from 'react';
import type { Bootstrap, Library, LibraryState, Settings, AssetPreview, Result } from './shared/contracts';
import { ACTION_NAMES, KIND_NAMES, RANGE_NAMES, ROLE_NAMES, filterCards } from './shared/library';
import { CardFace, OriginalImage } from './components/CardFace';
import { CardEditor } from './components/CardEditor';
import { Filters } from './components/Filters';
import { Modal } from './components/Modal';
import { HandSurface } from './components/HandSurface';
import { ResourcePanel, useResources } from './components/ResourcePanel';
import { ResourceManager } from './components/ResourceManager';
import { CardUsage, CardCostEditor, cardResourceNote } from './components/CardResources';
import { CharacterSettings } from './components/CharacterSettings';
import { TagManager, ProfileManager } from './components/Managers';

type Panel = 'new' | 'edit' | 'tags' | 'profiles' | 'preview' | 'archive' | 'resources' | 'costs' | 'class';
export function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>();
  const [imported, setImported] = useState<AssetPreview[]>([]);
  const [naturalSize, setNaturalSize] = useState(false);
  const filterRef = useRef<LibraryState | undefined>(undefined);
  const filterSequence = useRef(0);
  const selectedButton = useRef<HTMLButtonElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  async function load() {
    setLoading(true); setError('');
    try {
      const result = await window.desktop.getBootstrap();
      if (result.ok) { filterRef.current = result.value.libraryState; setBootstrap(result.value); }
      else setError(result.error);
    } catch { setError('데스크톱 연결을 확인할 수 없습니다. 앱을 다시 실행해 주세요.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (selectedId) closeButton.current?.focus(); }, [selectedId]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      if (settingsOpen) setSettingsOpen(false);
      else { setSelectedId(undefined); selectedButton.current?.focus(); }
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [settingsOpen]);

  function applyLibrary(library: Library) {
    filterRef.current = library.libraryState;
    setBootstrap(current => current ? { ...current, ...library } : current);
    setStatus('라이브러리 저장됨');
  }
  async function mutate(request: () => Promise<Result<Library>>): Promise<boolean> {
    if (busy) return false;
    setBusy(true); setError('');
    try {
      const result = await request();
      if (!result.ok) { setError(result.error); return false; }
      applyLibrary(result.value); return true;
    } catch { setError('변경을 저장하지 못했습니다. 기존 데이터는 유지됩니다.'); return false; }
    finally { setBusy(false); }
  }
  async function updateSettings(patch: Partial<Settings>) {
    if (!bootstrap || saving) return;
    setSaving(true); setStatus(''); setError('');
    try {
      const result = await window.desktop.saveSettings({ ...bootstrap.settings, ...patch });
      if (result.ok) { setBootstrap(current => current ? { ...current, settings: result.value } : current); setStatus('환경 설정 저장됨'); }
      else setError(result.error);
    } catch { setError('환경 설정을 저장하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setSaving(false); }
  }
  function updateFilters(patch: Partial<LibraryState>) {
    if (!filterRef.current) return;
    const next = { ...filterRef.current, ...patch };
    const sequence = ++filterSequence.current;
    filterRef.current = next;
    setBootstrap(current => current ? { ...current, libraryState: next } : current);
    setSelectedId(undefined); setError(''); setStatus('필터 저장 중…');
    void window.desktop.saveLibraryState(next).then(result => {
      if (filterSequence.current !== sequence) return;
      if (result.ok) setStatus('필터 저장됨');
      else { setError(result.error); setStatus('필터 저장 실패'); }
    }).catch(() => { if (filterSequence.current === sequence) { setError('필터를 저장하지 못했습니다. 다시 변경해 재시도해 주세요.'); setStatus('필터 저장 실패'); } });
  }
  async function dropFiles(event: DragEvent) {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files);
    if (!files.length || busy) return;
    setBusy(true); setError(''); setStatus('이미지 가져오는 중…');
    try {
      const result = await window.desktop.importImages(files);
      if (!result.ok) { setError(result.error); return; }
      if (result.value.errors.length) setError(result.value.errors.map(item => `${item.name}: ${item.message}`).join(' / '));
      if (result.value.assets.length) { setImported(result.value.assets); setPanel('new'); }
      setStatus(`${result.value.assets.length}장 가져옴 · 카드 정보 입력 후 저장해 주세요`);
    } catch { setError('이미지를 가져오지 못했습니다.'); } finally { setBusy(false); }
  }
  const activeProfile = bootstrap?.profiles.find(profile => profile.id === bootstrap.libraryState.activeCharacterId);
  const activeDeck = bootstrap?.decks.find(deck => deck.id === activeProfile?.activeDeckId && deck.characterId === activeProfile.id);
  const visibleCards = useMemo(() => bootstrap ? filterCards(bootstrap.cards, bootstrap.libraryState, activeDeck?.cardIds) : [], [bootstrap, activeDeck]);
  const selected = bootstrap?.cards.find(card => card.id === selectedId);
  const resourceController = useResources(activeProfile?.id);
  const resourceNotes = useMemo(() => new Map((bootstrap?.cards ?? []).map(card => [card.id, cardResourceNote(card,resourceController.snapshot)])),[bootstrap?.cards,resourceController.snapshot]);
  if (!bootstrap) return <main className="startup" aria-busy={loading}><div className="brand-mark">◇</div><h1>DnD TCG-fy</h1>{loading ? <p>로컬 카드 보드를 여는 중…</p> : <><p role="alert">{error}</p><button onClick={() => void load()}>다시 시도</button></>}</main>;
  const { settings, cards, tags, libraryState } = bootstrap;
  const closeSelection = () => { setSelectedId(undefined); if (selectedButton.current?.isConnected) selectedButton.current.focus(); };
  const openNew = () => { setImported([]); setPanel('new'); };
  return <div className={`app ${settings.reducedMotion ? 'reduced-motion' : ''} ${settings.resourcePanelCollapsed ? 'resources-collapsed' : ''}`}>
    <header className="topbar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">◇</span><div><h1>DnD <span>TCG-fy</span></h1><p>나의 선택을 손패 위에</p></div></div>
      <div className="profile-summary"><label><span className="sr-only">활성 캐릭터</span><select aria-label="활성 캐릭터" value={activeProfile?.id ?? ''} onChange={event => updateFilters({ activeCharacterId: event.target.value || undefined, viewScope: event.target.value ? libraryState.viewScope : 'library' })}><option value="">전체 라이브러리</option>{bootstrap.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>{activeProfile && <select aria-label="활성 덱" value={activeDeck?.id ?? ''} disabled={busy} onChange={event => void mutate(() => window.desktop.selectDeck({ characterId: activeProfile.id, deckId: event.target.value }))}>{bootstrap.decks.filter(deck => deck.characterId === activeProfile.id).map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}</select>}</div>
      <div className="top-actions"><button onClick={() => setPanel('resources')}>자원 관리</button><button disabled={busy} onClick={() => setPanel('profiles')}>캐릭터·덱</button><button disabled={busy} onClick={() => setPanel('tags')}>태그 관리</button><button aria-expanded={settingsOpen} onClick={() => setSettingsOpen(v => !v)}>환경 설정</button><button className="primary" disabled={busy} onClick={openNew}>카드 등록</button></div>
    </header>
    {settingsOpen && <section className="settings-panel" aria-label="환경 설정"><div><h2>환경 설정</h2><p>이 기기에 저장되며 다시 실행해도 유지됩니다.</p></div><label><input type="checkbox" checked={settings.reducedMotion} disabled={saving} onChange={event => void updateSettings({ reducedMotion: event.target.checked })} /> 모션 줄이기</label><button onClick={() => setSettingsOpen(false)}>닫기</button></section>}
    <div className="workspace">
      <aside className="resource-panel" aria-label="자원 패널"><div className="panel-title"><h2>{settings.resourcePanelCollapsed ? '자원' : '나의 자원'}</h2><button className="collapse-button" aria-label={settings.resourcePanelCollapsed ? '자원 패널 펼치기' : '자원 패널 접기'} disabled={saving} onClick={() => void updateSettings({ resourcePanelCollapsed: !settings.resourcePanelCollapsed })}>{settings.resourcePanelCollapsed ? '›' : '‹'}</button></div>{!settings.resourcePanelCollapsed && <ResourcePanel controller={resourceController} onManage={() => setPanel('resources')} />}</aside>
      <main className="board" aria-label="카드 보드" onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => void dropFiles(event)}>
        <div className="board-title"><div><span className="eyebrow">YOUR CARD TABLE</span><h2>손끝에서 고르는 다음 행동</h2><p>나의 카드를 펼쳐 살펴보고, 선택을 준비하세요.</p></div><span className="milestone">P3 · 카드 보드</span></div>
        <Filters state={libraryState} tags={tags} cards={libraryState.viewScope === 'deck' ? cards.filter(card => activeDeck?.cardIds.includes(card.id)) : cards} onChange={updateFilters} />
        <div className="board-toolbar"><div className="deck-label"><span aria-hidden="true">▱</span><strong>{libraryState.viewScope === 'deck' ? activeDeck?.name ?? '덱' : '라이브러리'}</strong><span aria-label="표시 카드 수">{visibleCards.length} / {cards.length}장</span></div><div className="toolbar-switches"><div className="view-switch" role="group" aria-label="카드 범위"><button aria-pressed={libraryState.viewScope === 'library'} onClick={() => updateFilters({ viewScope: 'library' })}>전체 카드</button><button disabled={!activeDeck} aria-pressed={libraryState.viewScope === 'deck'} onClick={() => updateFilters({ viewScope: 'deck' })}>활성 덱</button></div><div className="view-switch" role="group" aria-label="카드 보기 방식"><button aria-pressed={settings.viewMode === 'hand'} disabled={saving} onClick={() => void updateSettings({ viewMode: 'hand' })}>손패</button><button aria-pressed={settings.viewMode === 'grid'} disabled={saving} onClick={() => void updateSettings({ viewMode: 'grid' })}>격자</button></div></div></div>
        {visibleCards.length ? <HandSurface mode={settings.viewMode}>{visibleCards.map(card => <button key={card.id} className={`card-button ${selectedId === card.id ? 'selected' : ''}`} aria-label={`${card.name} 카드 선택`} aria-pressed={selectedId === card.id} onClick={event => { selectedButton.current = event.currentTarget; setSelectedId(current => current === card.id ? undefined : card.id); }}><CardFace key={`${card.id}-${card.imageAssetId}`} card={card} /><span className="card-caption"><strong>{card.name}</strong><span>{card.roles.map(role => ROLE_NAMES[role]).join(' · ') || KIND_NAMES[card.kind]}</span>{resourceNotes.get(card.id) && <small className="card-resource-note">{resourceNotes.get(card.id)}</small>}</span></button>)}</HandSurface> : <div className="empty-library"><span aria-hidden="true">◇</span><h3>{cards.length ? '조건에 맞는 카드가 없어요' : '첫 손패를 만들어 보세요'}</h3><p>{cards.length ? '필터를 바꾸거나 전체 라이브러리를 살펴보세요.' : '카드 이미지를 여기에 놓거나 카드 등록을 누르세요.'}</p>{!cards.length && <button onClick={openNew}>첫 카드 등록</button>}</div>}
        <div className="table-note"><span aria-hidden="true">◇</span><p>카드를 선택한 뒤 크게 보기로 원본을 읽을 수 있습니다.<br /><small>선택과 필터 변경은 카드를 사용하지 않습니다.</small></p></div>
        <footer className="board-status"><span role="status" aria-live="polite">{saving ? '설정 저장 중…' : status || '로컬 카드 보드 준비됨'}</span><span>v{bootstrap.appVersion}</span></footer>
        {error && <p className="error-banner" role="alert">{error}</p>}{bootstrap.warnings.map((warning, i) => <p className="error-banner" role="alert" key={i}>{warning}</p>)}
      </main>
      <aside className="detail-panel" aria-label="선택 카드 상세"><div className="panel-title"><h2>카드 살펴보기</h2>{selected && <button ref={closeButton} aria-label="카드 선택 닫기" onClick={closeSelection}>닫기</button>}</div>{selected ? <div className="selection" key={selected.id}><button type="button" className="detail-card preview-button" aria-label={`${selected.name} 미리보기 확대`} disabled={!selected.imageAssetId} onClick={() => { setNaturalSize(false); setPanel('preview'); }}><CardFace key={`${selected.id}-${selected.imageAssetId}`} card={selected} original /></button><div className="selection-info"><h2>{selected.name}</h2><p>{KIND_NAMES[selected.kind]} · {selected.actions.map(action => ACTION_NAMES[action]).join(' · ')}</p><p>{RANGE_NAMES[selected.range.kind]}{selected.range.feet !== undefined ? ` · ${selected.range.feet} ft` : ''}{selected.spellLevel !== undefined ? ` · 주문 ${selected.spellLevel}레벨` : ''}</p><div className="detail-tags">{selected.roles.map(role => <span key={role}>{ROLE_NAMES[role]}</span>)}{selected.tags.map(id => <span key={id}>{tags.find(tag => tag.id === id)?.name ?? id}</span>)}</div>{selected.description && <p className="detail-description">{selected.description}</p>}<div className="detail-actions"><button disabled={!selected.imageAssetId} onClick={() => { setNaturalSize(false); setPanel('preview'); }}>크게 보기</button><button onClick={() => setPanel('edit')}>정보 수정</button></div>{activeDeck && <button className="deck-card-action" disabled={busy} onClick={() => void mutate(() => window.desktop.setDeckCards({ deckId: activeDeck.id, cardIds: activeDeck.cardIds.includes(selected.id) ? activeDeck.cardIds.filter(id => id !== selected.id) : [...activeDeck.cardIds, selected.id] }))}>{activeDeck.cardIds.includes(selected.id) ? '활성 덱에서 빼기' : '활성 덱에 추가'}</button>}<CardUsage key={`${activeProfile?.id}-${selected.id}-${selected.updatedAt}`} card={selected} controller={resourceController} onConfigure={() => setPanel('costs')} /><button className="archive-button" disabled={busy} onClick={() => setPanel('archive')}>등록 해제</button></div></div> : <div className="empty-selection"><div className="empty-card" aria-hidden="true">◇</div><h3>어떤 카드를 고를까요?</h3><p>손패에서 카드 한 장을 선택하세요.<br />카드의 내용과 속성을<br />이곳에서 확인할 수 있습니다.</p><span className="keyboard-hint">ESC <span>선택 닫기</span></span></div>}</aside>
    </div>
    {(panel === 'new' || panel === 'edit') && <CardEditor key={panel === 'edit' ? selected?.id : 'new'} card={panel === 'edit' ? selected : undefined} initialAssets={panel === 'new' ? imported : undefined} registrationTarget={activeProfile && activeDeck ? { characterId: activeProfile.id, deckId: activeDeck.id } : null} targetLabel={activeProfile && activeDeck ? `${activeProfile.name} · ${activeDeck.name}` : undefined} tags={tags} onLibrary={applyLibrary} onClose={() => setPanel(undefined)} />}
    {panel==='class'&&(resourceController.snapshot?<CharacterSettings key={resourceController.snapshot.characterId} controller={resourceController} onSaved={load} onClose={()=>setPanel(undefined)}/>:<Modal title="클래스·레벨 설정" onClose={()=>setPanel(undefined)}><p>{resourceController.error||'캐릭터와 자원 설정을 불러오는 중…'}</p></Modal>)}
    {panel === 'resources' && <ResourceManager cards={cards} controller={resourceController} onClose={() => setPanel(undefined)} />}
    {panel === 'costs' && selected && resourceController.snapshot && <CardCostEditor card={selected} controller={resourceController} onSaved={load} onClose={() => setPanel(undefined)} />}
    {panel === 'tags' && <TagManager library={bootstrap} onLibrary={applyLibrary} onClose={() => setPanel(undefined)} />}
    {panel === 'profiles' && <ProfileManager onClass={()=>setPanel('class')} library={bootstrap} onLibrary={applyLibrary} onClose={() => setPanel(undefined)} />}
    {panel === 'preview' && selected && <Modal title={`${selected.name} 원본 보기`} wide onClose={() => setPanel(undefined)}><div className="image-view-toolbar"><p>원본 이미지를 크게 살펴보세요.</p><button aria-pressed={naturalSize} onClick={() => setNaturalSize(value => !value)}>{naturalSize ? '화면에 맞춤' : '원본 크기'}</button></div><OriginalImage card={selected} natural={naturalSize} /></Modal>}
    {panel === 'archive' && selected && <Modal title="카드 등록 해제" onClose={() => setPanel(undefined)}><p>“{selected.name}” 카드를 라이브러리와 덱에서 표시하지 않습니다. 원본 이미지와 기존 참조는 보관됩니다.</p><div className="modal-actions"><button onClick={() => setPanel(undefined)}>취소</button><button disabled={busy} onClick={async () => { if (await mutate(() => window.desktop.archiveCard(selected.id))) { setPanel(undefined); closeSelection(); } }}>등록 해제 확인</button></div>{error && <p className="error-banner" role="alert">{error}</p>}</Modal>}
  </div>;
}
