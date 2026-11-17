import { SelectedCardPanel } from './components/SelectedCardPanel';
import { TrashManager, TrashReview } from './components/TrashManager';
import type { TrashResult } from './shared/trash';
import { CardBatchTools } from './components/CardBatchTools';
import { EditHistory } from './components/BatchEdits';
import { useEffect, useRef, useState, useMemo, useCallback, type DragEvent } from 'react';
import { DEFAULT_APPEARANCE, type Appearance, type Bootstrap, type Library, type LibraryState, type Settings, type AssetPreview, type Result } from './shared/contracts';
import { cardBackFor } from './shared/appearance';
import { CLASS_NAMES } from './shared/class-contracts';
import { CardBackDialog, DeckPile, Icon, ThemeMenu, UsedPile, cardBackSource } from './components/Appearance';
import { UseHistory } from './components/UseHistory';
import { BackupManager } from './components/BackupManager';
import { filterCards } from './shared/library';
import { ImageLightbox } from './components/ImageLightbox';
import { CardEditor } from './components/CardEditor';
import { Filters } from './components/Filters';
import { Modal } from './components/Modal';
import { CardGallery } from './components/CardGallery';
import { ResourcePanel, useResources } from './components/ResourcePanel';
import { ResourceManager } from './components/ResourceManager';
import { CardCostEditor, cardUsability } from './components/CardResources';
import { USABILITY_NOTES } from './shared/usability';
import { CharacterSettings } from './components/CharacterSettings';
import { TagManager, ProfileManager } from './components/Managers';

function popoverOpen(): boolean { try { return !!document.querySelector(':popover-open'); } catch { return false; } }
type Panel = 'backup' | 'new' | 'edit' | 'tags' | 'profiles' | 'preview' | 'archive' | 'resources' | 'costs' | 'class' | 'history' | 'libraryMenu' | 'trash' | 'management';
export function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const trashUndoPending=useRef(false);
  const [lastTrashed,setLastTrashed]=useState<string[]>([]);
  const [selectionMode,setSelectionMode]=useState(false);
  const [selectedCards,setSelectedCards]=useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [backsOpen, setBacksOpen] = useState(false);
  const [usedOpen, setUsedOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>();
  const [imported, setImported] = useState<AssetPreview[]>([]);
  const filterRef = useRef<LibraryState | undefined>(undefined);
  const filterSequence = useRef(0);
  const selectedButton = useRef<HTMLButtonElement | null>(null);
  // Where the enlargement grows from and shrinks back to (hand card face or IN PLAY preview).
  const previewOrigin = useRef<Element | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  async function load() {
    setLoading(true); setError('');
    try {
      const result = await window.desktop.getBootstrap();
      if (result.ok) { filterRef.current = result.value.libraryState; setBootstrap(result.value); if (result.value.notices?.length) setStatus(result.value.notices.join(' ')); }
      else setError(result.error);
    } catch { setError('데스크톱 연결을 확인할 수 없습니다. 앱을 다시 실행해 주세요.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (document.querySelector('dialog[open]') || popoverOpen()) return;
      const editing = event.target instanceof HTMLElement && (event.target.isContentEditable || !!event.target.closest('input,textarea,select'));
      if (event.key.toLowerCase() === 'f' && (event.ctrlKey || event.metaKey) && !event.altKey && !editing) { event.preventDefault(); document.getElementById('card-name-search')?.focus(); return; }
      if (event.key !== 'Escape' || editing) return;
      if (settingsOpen) setSettingsOpen(false);
      else { setSelectedId(undefined); selectedButton.current?.focus(); }
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [settingsOpen]);

  function applyLibrary(library: Library) {
    setSelectedCards([]);
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
    const previous = bootstrap.settings;
    const next = { ...previous, ...patch };
    setBootstrap(current => current ? { ...current, settings: next } : current);
    setSaving(true); setStatus(''); setError('');
    try {
      const result = await window.desktop.saveSettings(next);
      if (result.ok) { setBootstrap(current => current ? { ...current, settings: result.value } : current); setStatus('환경 설정 저장됨'); }
      else { setBootstrap(current => current ? { ...current, settings: previous } : current); setError(result.error); }
    } catch { setBootstrap(current => current ? { ...current, settings: previous } : current); setError('환경 설정을 저장하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setSaving(false); }
  }
  const updateFilters = useCallback((patch: Partial<LibraryState>) => {
    if (!filterRef.current) return;
    const next = { ...filterRef.current, ...patch };
    const sequence = ++filterSequence.current;
    filterRef.current = next;
    setBootstrap(current => current ? { ...current, libraryState: next } : current);
    setSelectedCards([]); setSelectedId(undefined); setError(''); setStatus('필터 저장 중…');
    void window.desktop.saveLibraryState(next).then(result => {
      if (filterSequence.current !== sequence) return;
      if (result.ok) setStatus('필터 저장됨');
      else { setError(result.error); setStatus('필터 저장 실패'); }
    }).catch(() => { if (filterSequence.current === sequence) { setError('필터를 저장하지 못했습니다. 다시 변경해 재시도해 주세요.'); setStatus('필터 저장 실패'); } });
  }, []);
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
  const libraryCards = bootstrap?.cards; const filterState = bootstrap?.libraryState; const deckCardIds = activeDeck?.cardIds;
  const visibleCards = useMemo(() => libraryCards && filterState ? filterCards(libraryCards, filterState, deckCardIds) : [], [libraryCards, filterState, deckCardIds]);
  const filterCardsSource = useMemo(() => filterState?.viewScope === 'deck' ? (libraryCards ?? []).filter(card => deckCardIds?.includes(card.id)) : libraryCards ?? [], [libraryCards, filterState?.viewScope, deckCardIds]);
  const selectCard = useCallback((id: string, button: HTMLButtonElement) => { selectedButton.current = button; setSelectedId(id); }, []);
  const previewCard = useCallback((id: string, button: HTMLButtonElement) => { selectedButton.current = button; previewOrigin.current = button.querySelector('.card-face'); setSelectedId(id); setPanel('preview'); }, []);
  const checkCard = useCallback((id: string, checked: boolean) => setSelectedCards(current => checked ? [...new Set([...current, id])] : current.filter(value => value !== id)), []);
  const selected = bootstrap?.cards.find(card => card.id === selectedId);
  const resourceController = useResources(activeProfile?.id);
  const usability = useMemo(() => new Map((bootstrap?.cards ?? []).map(card => [card.id, cardUsability(card, resourceController.snapshot)])), [bootstrap?.cards, resourceController.snapshot]);
  const resourceNotes = useMemo(() => new Map([...usability].map(([id, state]) => [id, USABILITY_NOTES[state]])), [usability]);
  async function trashChanged(result:TrashResult){
    if(result.type==='move')setLastTrashed(result.cardIds);else setLastTrashed(current=>current.filter(id=>!result.cardIds.includes(id)));
    setSelectedCards([]);setSelectedId(undefined);await load();await resourceController.refresh();
    setStatus(`${result.count}장 ${result.type==='move'?'휴지통 이동':result.type==='restore'?'복원':'영구 삭제'} 완료${result.warnings.length?' · '+result.warnings.join(' '):''}`);
  }
  async function undoTrash(){
    if(trashUndoPending.current)return;trashUndoPending.current=true;setBusy(true);setError('');
    try{const state=await window.desktop.getTrash();if(!state.ok){setError(state.error);return;}const ids=lastTrashed.filter(id=>state.value.cards.some(c=>c.card.id===id));if(!ids.length){setLastTrashed([]);setStatus('카드가 이미 복원되거나 영구 삭제되었습니다.');return;}
      const action={type:'restore' as const,cardIds:ids};const preview=await window.desktop.previewTrash(action);if(!preview.ok){setError(preview.error);return;}const result=await window.desktop.changeTrash({requestId:crypto.randomUUID(),action,quote:preview.value.quote,confirmed:true});if(result.ok)await trashChanged(result.value);else setError(result.error);
    }catch{setError('복원 결과를 확인하지 못했습니다. 휴지통을 확인해 주세요.');}finally{trashUndoPending.current=false;setBusy(false);}
  }
  if (!bootstrap) return <main className="startup" aria-busy={loading}><div className="brand-mark">◇</div><h1>DnD TCG-fy</h1>{loading ? <p>로컬 카드 보드를 여는 중…</p> : <><p role="alert">{error}</p><button onClick={() => void load()}>다시 시도</button></>}</main>;
  const { settings, cards, tags, libraryState } = bootstrap;
  const closeSelection = () => { setSelectedId(undefined); if (selectedButton.current?.isConnected) selectedButton.current.focus(); };
  const openNew = () => { setImported([]); setPanel('new'); };
  const registrationLabel = activeProfile && activeDeck ? `${activeProfile.name} · ${activeDeck.name}에 등록` : '라이브러리에만 등록(활성 덱 없음)';
  const scopeLabel = libraryState.viewScope === 'deck' ? `활성 덱 ‘${activeDeck?.name ?? '덱'}’` : '전체 라이브러리';
  const exitSelection = () => {
    setSelectionMode(false); setSelectedCards([]);
    // Back to normal browsing: hand focus returns to the roving card without selecting or scrolling it.
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.cards-area .card-button[tabindex="0"]')?.focus({ preventScroll: true }));
  };
  const appearance: Appearance = settings.appearance ?? DEFAULT_APPEARANCE;
  const deckBack = cardBackSource(cardBackFor(appearance, activeDeck?.id));
  const tiltSetting = settings.effects?.cardTilt ?? true;
  const tiltOn = tiltSetting && !settings.reducedMotion;
  const classLine = resourceController.snapshot?.profile ? `${CLASS_NAMES[resourceController.snapshot.profile.classId as keyof typeof CLASS_NAMES] ?? '홈브루'} · ${resourceController.snapshot.profile.level}레벨` : '';
  const deckCount = activeDeck ? activeDeck.cardIds.filter(id => cards.some(card => card.id === id)).length : cards.length;
  return <div className={`app p4-a p4-b playmat ${settings.reducedMotion ? 'reduced-motion' : ''} ${settings.resourcePanelCollapsed ? 'resources-collapsed' : ''}`} data-theme={appearance.theme}>
    <header className="topbar">
      <div className="brand"><span className="brand-logo" aria-hidden="true"/><div><h1>DnD <span>TCG-fy</span></h1><p className="brand-tagline">THE ADVENTURER&apos;S TABLE</p></div></div>
      <div className="profile-summary nameplate">
        <span className="portrait" aria-hidden="true">{activeProfile?.name.slice(0, 1) ?? '◇'}</span>
        <div className="nameplate-character"><label><span className="sr-only">활성 캐릭터</span><select aria-label="활성 캐릭터" value={activeProfile?.id ?? ''} onChange={event => updateFilters({ activeCharacterId: event.target.value || undefined, viewScope: event.target.value ? libraryState.viewScope : 'library' })}><option value="">전체 라이브러리</option>{bootstrap.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>{classLine && <span className="class-ribbon">{classLine}</span>}</div>
        {activeProfile && <label className="nameplate-deck"><span className="nameplate-kicker" aria-hidden="true">DECK</span><select aria-label="활성 덱" value={activeDeck?.id ?? ''} disabled={busy} onChange={event => void mutate(() => window.desktop.selectDeck({ characterId: activeProfile.id, deckId: event.target.value }))}>{bootstrap.decks.filter(deck => deck.characterId === activeProfile.id).map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}</select></label>}
      </div>
      <div className="top-actions"><button className="register-card" aria-haspopup="dialog" disabled={busy} title={registrationLabel} onClick={openNew}><Icon name="add"/>카드 등록</button><ThemeMenu value={appearance.theme} disabled={saving} onChange={theme => void updateSettings({ appearance: { ...appearance, theme } })}/><button aria-haspopup="dialog" onClick={()=>setPanel('management')}><Icon name="manage"/>관리</button><button aria-haspopup="dialog" onClick={()=>setSettingsOpen(true)}><Icon name="settings"/>환경 설정</button></div>
    </header>
    {settingsOpen&&<Modal title="환경 설정" onClose={()=>setSettingsOpen(false)}><p>이 기기에 저장되며 다시 실행해도 유지됩니다.</p><label className="checkbox-line"><input type="checkbox" checked={settings.reducedMotion} disabled={saving} onChange={e=>void updateSettings({reducedMotion:e.target.checked})}/>모션 줄이기</label><label className="checkbox-line"><input type="checkbox" checked={tiltOn} disabled={saving||settings.reducedMotion} onChange={e=>void updateSettings({effects:{...settings.effects,cardTilt:e.target.checked}})}/>확대 카드 3D 기울임</label><p className="muted settings-note">{settings.reducedMotion?'모션 줄이기가 켜져 있어 기울임과 확대 전환 효과가 꺼집니다.':'확대한 카드를 마우스 위치에 따라 살짝 기울입니다.'}</p></Modal>}
    {backsOpen&&<CardBackDialog appearance={appearance} deck={activeDeck ? { id: activeDeck.id, name: activeDeck.name } : undefined} busy={saving} onClose={()=>setBacksOpen(false)} onSave={next=>{setBacksOpen(false);void updateSettings({ appearance: next });}}/>}
    {usedOpen&&activeProfile&&<UseHistory characterId={activeProfile.id} onClose={()=>setUsedOpen(false)}/>}
    <div className="workspace">
      <aside className="resource-panel" aria-label="자원 패널"><div className="panel-title"><h2>{settings.resourcePanelCollapsed ? '자원' : '자원 장부'}</h2><button className="collapse-button" aria-label={settings.resourcePanelCollapsed ? '자원 패널 펼치기' : '자원 패널 접기'} disabled={saving} onClick={() => void updateSettings({ resourcePanelCollapsed: !settings.resourcePanelCollapsed })}>{settings.resourcePanelCollapsed ? '›' : '‹'}</button></div>{!settings.resourcePanelCollapsed && <ResourcePanel key={activeProfile?.id} controller={resourceController} display={settings.resourceViews?.[activeProfile?.id ?? '']} displayBusy={saving} onDisplayChange={display => { if (activeProfile) void updateSettings({ resourceViews: { ...settings.resourceViews, [activeProfile.id]: display } }); }} history={settings.historyViews?.[activeProfile?.id ?? '']} onHistoryChange={view => { if (!activeProfile) return; const kept = Object.fromEntries(Object.entries(settings.historyViews ?? {}).filter(([id]) => id !== activeProfile.id && bootstrap.profiles.some(profile => profile.id === id))); void updateSettings({ historyViews: view ? { ...kept, [activeProfile.id]: view } : kept }); }}/>}</aside>
      <main className="board" aria-label="카드 보드" onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => void dropFiles(event)}>
        <h2 className="sr-only">카드 보드</h2>
        <div className="board-top">
          <Filters state={libraryState} tags={tags} cards={filterCardsSource} onChange={updateFilters} />
        </div>
        {selectionMode&&<CardBatchTools key={`${libraryState.activeCharacterId}-${activeDeck?.id}`} ids={selectedCards.filter(id=>visibleCards.some(card=>card.id===id))} visibleCount={visibleCards.length} scopeLabel={scopeLabel} tags={tags} decks={bootstrap.decks.map(d=>({...d,name:`${bootstrap.profiles.find(p=>p.id===d.characterId)?.name} · ${d.name}`}))} activeDeck={activeDeck} onAll={()=>setSelectedCards(visibleCards.map(card=>card.id))} onClear={()=>setSelectedCards([])} onExit={exitSelection} onTrashed={trashChanged} onSaved={async()=>{setSelectedCards([]);await load();await resourceController.refresh();}}/>}
        <SelectedCardPanel card={selected} tags={tags} controller={resourceController} onPreview={()=>{ previewOrigin.current = document.querySelector('.in-play-slot .card-face'); setPanel('preview'); }} onClose={closeSelection} closeRef={closeButton}/>
        <div className="hand-row">
          <DeckPile src={deckBack} deckName={activeDeck?.name ?? '전체 라이브러리'} count={deckCount} onOpen={()=>setBacksOpen(true)}/>
          <div className="hand-zone">
            <div className="hand-header"><div className="deck-label"><strong>{libraryState.viewScope === 'deck' ? activeDeck?.name ?? '덱' : '라이브러리'}</strong><span aria-label="표시 카드 수">{visibleCards.length} / {cards.length}장</span></div><span className="hand-title" aria-hidden="true">HAND</span><div className="board-toolbar"><div className="toolbar-switches"><div className="view-switch" role="group" aria-label="카드 범위"><button aria-pressed={libraryState.viewScope === 'library'} onClick={() => updateFilters({ viewScope: 'library' })}>전체 카드</button><button disabled={!activeDeck} aria-pressed={libraryState.viewScope === 'deck'} onClick={() => updateFilters({ viewScope: 'deck' })}>활성 덱</button></div><div className="view-switch" role="group" aria-label="카드 보기 방식"><button aria-pressed={settings.viewMode === 'hand'} disabled={saving} onClick={() => void updateSettings({ viewMode: 'hand' })}>손패</button><button aria-pressed={settings.viewMode === 'grid'} disabled={saving} onClick={() => void updateSettings({ viewMode: 'grid' })}>격자</button></div></div></div></div>
            {visibleCards.length ? <CardGallery cards={visibleCards} mode={settings.viewMode} selectedId={selectedId} selectedIds={selectedCards} selectionMode={selectionMode} notes={resourceNotes} usability={usability} backSrc={resourceController.snapshot ? deckBack : undefined} onSelect={selectCard} onCheck={checkCard} onPreview={previewCard}/> : <div className="empty-library"><span aria-hidden="true">◇</span><h3>{cards.length ? '조건에 맞는 카드가 없어요' : '첫 손패를 만들어 보세요'}</h3><p>{cards.length ? '필터를 바꾸거나 전체 라이브러리를 살펴보세요.' : '카드 이미지를 여기에 놓거나 카드 등록을 누르세요.'}</p>{!cards.length && <button onClick={()=>setPanel('management')}>관리 메뉴 열기</button>}</div>}
          </div>
          <UsedPile events={resourceController.snapshot?.events ?? []} cards={cards} disabled={!activeProfile || !resourceController.snapshot} onOpen={()=>setUsedOpen(true)}/>
        </div>
        {error && <p className="error-banner" role="alert">{error}</p>}{bootstrap.warnings.map((warning, i) => <p className="error-banner" role="alert" key={i}>{warning}</p>)}
      </main>
    </div>
    <footer className="board-status">{lastTrashed.length>0&&<button disabled={busy} onClick={()=>void undoTrash()}>휴지통 이동 실행 취소 · {lastTrashed.length}장</button>}<span role="status" aria-live="polite">{saving ? '설정 저장 중…' : status || '로컬 카드 보드 준비됨'}</span><span className="navigation-hint" title="방향키 이동 · Enter/Space 선택 · Ctrl+F 검색">← → 이동 · Enter 선택 · Ctrl+F 검색</span><span>v{bootstrap.appVersion}</span></footer>
    {(panel === 'new' || panel === 'edit') && <CardEditor key={panel === 'edit' ? selected?.id : 'new'} card={panel === 'edit' ? selected : undefined} initialAssets={panel === 'new' ? imported : undefined} registrationTarget={activeProfile && activeDeck ? { characterId: activeProfile.id, deckId: activeDeck.id } : null} targetLabel={activeProfile && activeDeck ? `${activeProfile.name} · ${activeDeck.name}` : undefined} tags={tags} onLibrary={library=>{applyLibrary(library);void resourceController.refresh();}} controller={resourceController} characterId={activeProfile?.id} onClose={() => setPanel(undefined)} />}
    {panel==='class'&&(resourceController.snapshot?<CharacterSettings key={resourceController.snapshot.characterId} controller={resourceController} onSaved={load} onClose={()=>setPanel(undefined)}/>:<Modal title="클래스·레벨 설정" onClose={()=>setPanel(undefined)}><p>{resourceController.error||'캐릭터와 자원 설정을 불러오는 중…'}</p></Modal>)}
    {panel === 'history'&&<EditHistory onClose={()=>setPanel(undefined)} onSaved={async()=>{await load();await resourceController.refresh();}}/>}
    {panel === 'resources' && <ResourceManager cards={cards} controller={resourceController} onClose={() => setPanel(undefined)} />}
    {panel === 'costs' && selected && resourceController.snapshot && <CardCostEditor card={selected} controller={resourceController} onSaved={load} onClose={() => setPanel(undefined)} />}
    {panel === 'tags' && <TagManager library={bootstrap} onLibrary={applyLibrary} onClose={() => setPanel(undefined)} />}
    {panel === 'profiles' && <ProfileManager onClass={()=>setPanel('class')} library={bootstrap} onLibrary={applyLibrary} onClose={() => setPanel(undefined)} />}
    {panel === 'preview' && selected && <ImageLightbox card={selected} origin={previewOrigin.current} tilt={tiltOn} onClose={()=>setPanel(undefined)}/>}
    {panel==='management'&&<Modal title="관리 메뉴" wide onClose={()=>setPanel(undefined)}><p className="manager-help">관리창을 닫으면 선택한 카드와 검색 조건을 유지한 채 플레이로 돌아갑니다.</p><div className="management-sections"><section><h3>카드·라이브러리</h3><button disabled={busy} onClick={openNew}>카드 등록</button><button onClick={()=>setPanel('libraryMenu')}>라이브러리 관리</button><button onClick={()=>setPanel('backup')}>백업·복원</button><button onClick={()=>{setSelectionMode(true);setSelectedCards([]);setPanel(undefined);}}>선택 관리</button></section><section><h3>캐릭터·자원</h3><button onClick={()=>setPanel('profiles')}>캐릭터·덱</button><button onClick={()=>setPanel('resources')}>자원 관리</button><button onClick={()=>setPanel('history')}>일괄 편집 복원</button></section><section><h3>선택 카드{selected?` · ${selected.name}`:''}</h3><button disabled={!selected} onClick={()=>setPanel('edit')}>정보 수정</button><button disabled={!selected||!resourceController.snapshot} onClick={()=>setPanel('costs')}>카드 사용 규칙</button>{activeDeck&&selected&&<button disabled={busy} onClick={async()=>{if(await mutate(()=>window.desktop.setDeckCards({deckId:activeDeck.id,cardIds:activeDeck.cardIds.includes(selected.id)?activeDeck.cardIds.filter(id=>id!==selected.id):[...activeDeck.cardIds,selected.id]})))setPanel(undefined);}}>{activeDeck.cardIds.includes(selected.id)?'활성 덱에서 빼기':'활성 덱에 추가'}</button>}<button className="trash-move" disabled={!selected} onClick={()=>setPanel('archive')}>휴지통으로 이동</button></section></div></Modal>}
    {panel==='libraryMenu'&&<Modal title="라이브러리 관리" onClose={()=>setPanel(undefined)}><p>공통 태그와 삭제된 카드를 관리합니다.</p><div className="batch-actions"><button onClick={()=>setPanel('tags')}>태그 관리</button><button onClick={()=>setPanel('trash')}>휴지통</button></div></Modal>}
    {panel==='backup'&&<BackupManager onClose={()=>setPanel(undefined)} onLibrary={library=>{applyLibrary(library);void resourceController.refresh();}}/>}
    {panel==='trash'&&<TrashManager onChanged={trashChanged} onClose={()=>setPanel(undefined)}/>}
    {panel==='archive'&&selected&&<TrashReview action={{type:'move',cardIds:[selected.id]}} onDone={trashChanged} onClose={()=>setPanel(undefined)}/>}

  </div>;
}
