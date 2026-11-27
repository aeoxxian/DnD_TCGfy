import { useId, useRef, useState, type ReactNode } from 'react';
import backDragon from '../assets/playmat/back-dragon.png';
import backCrest from '../assets/playmat/back-crest.svg';
import backStars from '../assets/playmat/back-stars.png';
import { BUILTIN_CARD_BACKS, type Appearance, type BuiltinCardBack, type CardBackRef, type CardDefinition, type ThemeId } from '../shared/contracts';
import { addCustomBack, cardBackFor, removeCustomBack, setCardBack } from '../shared/appearance';
import type { ResourceEvent } from '../shared/resources';
import { CardFace, imageUrl } from './CardFace';
import { Modal } from './Modal';

export const THEMES: { id: ThemeId; name: string; description: string }[] = [
  { id: 'oxblood', name: '적갈 가죽', description: '기본 · 적갈색 가죽과 리벳 박은 금속 모서리' },
  { id: 'ebony', name: '흑단과 은', description: '흑단 목재와 정밀한 은 상감' },
  { id: 'verdant', name: '숲의 펠트', description: '짙은 녹색 펠트와 무광 청동 장식' },
  { id: 'abyss', name: '아케인 블루', description: '심청색 석재와 하늘빛 음각 문양' },
];
export const BUILTIN_BACK_INFO: Record<BuiltinCardBack, { name: string; src: string }> = {
  dragon: { name: '용의 인장', src: backDragon },
  crest: { name: '가죽 문장', src: backCrest },
  stars: { name: '별자리', src: backStars },
};
export function cardBackSource(ref: CardBackRef): string {
  return ref.type === 'builtin' ? BUILTIN_BACK_INFO[ref.id].src : imageUrl(ref.assetId, true);
}
const sameRef = (a: CardBackRef, b: CardBackRef) => a.type === b.type && (a.type === 'builtin' ? a.id === (b as typeof a).id : a.assetId === (b as typeof a).assetId);

const ICONS = {
  theme: 'M7.5 1.5a6 6 0 1 0 0 12c1 0 1.4-.8 1-1.6-.5-1 .2-2 1.3-2h1.5a2.7 2.7 0 0 0 2.7-2.7c0-3.1-2.9-5.7-6.5-5.7zM4.3 6.5h.01M6.5 4h.01M9.5 4.2h.01',
  manage: 'M3 1.5h9v12l-4.5-2.8L3 13.5z',
  settings: 'M7.5 5.2a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6zM7.5 1v2M7.5 12v2M1 7.5h2M12 7.5h2M2.9 2.9l1.4 1.4M10.7 10.7l1.4 1.4M2.9 12.1l1.4-1.4M10.7 4.3l1.4-1.4',
  check: 'M2.5 6.2l2.3 2.3 4.7-5',
  // A card with a plus: register a new card.
  add: 'M3.5 1.5h8v12h-8zM7.5 5v5M5 7.5h5',
};
export function Icon({ name, size = 15 }: { name: keyof typeof ICONS; size?: number }) {
  return <svg className="icon" width={size} height={size} viewBox={name === 'check' ? '0 0 12 12' : '0 0 15 15'} aria-hidden="true" focusable="false"><path d={ICONS[name]} fill="none" stroke="currentColor" strokeWidth={name === 'check' ? 1.8 : 1.2} strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function hidePopover(id: string) {
  const element = document.getElementById(id) as (HTMLElement & { hidePopover?: () => void }) | null;
  try { element?.hidePopover?.(); } catch { /* Already closed. */ }
}

export function ThemeMenu({ value, disabled, onChange }: { value: ThemeId; disabled?: boolean; onChange: (theme: ThemeId) => void }) {
  const id = 'theme-menu';
  return <>
    <button type="button" className="theme-button" popoverTarget={id} aria-haspopup="menu" disabled={disabled}><Icon name="theme"/>테마</button>
    <div id={id} popover="auto" role="menu" aria-label="테마 선택" className="theme-menu">
      <div className="theme-menu-heading"><strong>테마 선택</strong><p>배치 · 카드 · 자원은 그대로, 보드의 재질과 장식만 바뀝니다.</p></div>
      {THEMES.map(theme => <button key={theme.id} type="button" role="menuitemradio" aria-checked={value === theme.id} disabled={disabled} className="theme-option"
        onClick={() => { hidePopover(id); if (value !== theme.id) onChange(theme.id); }}>
        <span className={`theme-swatch theme-swatch-${theme.id}`} aria-hidden="true"><span/></span>
        <span className="theme-option-text"><strong>{theme.name}</strong><small>{theme.description}</small></span>
        {value === theme.id && <span className="metal-check" aria-hidden="true"><Icon name="check" size={12}/></span>}
      </button>)}
      <p className="theme-menu-note">선택한 테마는 이 기기에 저장됩니다. 모션 줄이기 설정과 별개입니다.</p>
    </div>
  </>;
}

export function CardBackDialog({ appearance, deck, busy, onSave, onClose }: {
  appearance: Appearance; deck?: { id: string; name: string }; busy?: boolean;
  onSave: (next: Appearance) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(appearance);
  const [choice, setChoice] = useState<CardBackRef>(() => cardBackFor(appearance, deck?.id));
  const [scope, setScope] = useState<'deck' | 'default'>(deck ? 'deck' : 'default');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const name = useId();
  async function importBack(file: File | undefined) {
    if (!file || importing) return;
    setImporting(true); setError('');
    try {
      const result = await window.desktop.importImages([file]);
      if (!result.ok) { setError(result.error); return; }
      if (result.value.errors.length) { setError(result.value.errors.map(item => `${item.name}: ${item.message}`).join(' / ')); return; }
      const asset = result.value.assets[0];
      if (!asset) return;
      if (draft.customBacks.length >= 24) { setError('내 이미지는 24개까지 둘 수 있습니다. 쓰지 않는 이미지를 목록에서 빼 주세요.'); return; }
      setDraft(current => addCustomBack(current, asset.id, file.name || asset.name));
      setChoice({ type: 'custom', assetId: asset.id });
    } catch { setError('이미지를 가져오지 못했습니다.'); }
    finally { setImporting(false); }
  }
  function remove(assetId: string) {
    setDraft(current => removeCustomBack(current, assetId));
    if (choice.type === 'custom' && choice.assetId === assetId) setChoice({ type: 'builtin', id: 'dragon' });
  }
  const option = (ref: CardBackRef, label: string, src: string, key: string) => {
    const checked = sameRef(ref, choice);
    return <label className={`back-option ${checked ? 'is-checked' : ''}`} key={key}>
      <input type="radio" name={name} className="sr-only" checked={checked} onChange={() => setChoice(ref)}/>
      <span className="back-thumb"><img src={src} alt="" draggable={false}/>{checked && <span className="metal-check" aria-hidden="true"><Icon name="check" size={12}/></span>}</span>
      <span className="back-name">{label}</span>
    </label>;
  };
  return <Modal title="카드 뒷면 · 슬리브" onClose={onClose}>
    <div className="card-back-dialog">
      <p className="muted">덱 더미에 보이는 카드 뒷면을 고릅니다. 카드 앞면 이미지는 그대로 둡니다.</p>
      <fieldset className="back-group"><legend>기본 뒷면</legend><div className="back-options">
        {BUILTIN_CARD_BACKS.map(id => option({ type: 'builtin', id }, BUILTIN_BACK_INFO[id].name, BUILTIN_BACK_INFO[id].src, id))}
      </div></fieldset>
      <fieldset className="back-group"><legend>내 이미지</legend><div className="back-options">
        {draft.customBacks.map(item => <div className="custom-back" key={item.assetId}>
          {option({ type: 'custom', assetId: item.assetId }, item.name, imageUrl(item.assetId, true), item.assetId)}
          <button type="button" className="text-button" onClick={() => remove(item.assetId)} aria-label={`${item.name} 목록에서 빼기`}>목록에서 빼기</button>
        </div>)}
        <label className="back-import"><input type="file" accept="image/png,image/jpeg,image/webp" disabled={importing || busy} onChange={event => { void importBack(event.target.files?.[0]); event.target.value = ''; }}/>
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M11 15V4M6.5 8.5L11 4l4.5 4.5M4 15v3h14v-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          {importing ? '가져오는 중…' : '이미지 선택…'}</label>
      </div>
      <p className="muted">PNG · JPG · WebP, 파일당 32 MiB까지. 원본 파일은 그대로 보관하고 비율을 유지해 카드 뒷면 크기에 맞춥니다. 목록에서 빼도 파일은 지우지 않습니다.</p></fieldset>
      {deck && <fieldset className="back-scope"><legend>적용 범위</legend>
        <label><input type="radio" name={`${name}-scope`} checked={scope === 'deck'} onChange={() => setScope('deck')}/>이 덱만 ({deck.name})</label>
        <label><input type="radio" name={`${name}-scope`} checked={scope === 'default'} onChange={() => setScope('default')}/>모든 덱의 기본값</label>
      </fieldset>}
      {error && <p className="import-errors" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" onClick={onClose}>취소</button><button type="button" className="primary" disabled={busy || importing} onClick={() => onSave(setCardBack(draft, choice, scope, deck?.id))}>적용</button></div>
    </div>
  </Modal>;
}

function Pile({ kind, name, buttonLabel, hint, actionLabel, actionName, onAction, onClick, inactive = false, children }: {
  kind: 'used' | 'deck'; name: string; buttonLabel: string; hint: string; actionLabel: string; actionName?: string;
  onAction?: () => void; onClick: () => void; inactive?: boolean; children: ReactNode;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const menuLabel = `${kind.toUpperCase()} 더미 메뉴`;
  function openMenu() {
    if (!button.current || !menu.current || inactive) return;
    button.current.focus();
    menu.current.showPopover();
    const target = onAction ? action.current : menu.current;
    target?.focus();
  }
  function closeMenu() {
    menu.current?.hidePopover();
    button.current?.focus();
  }
  return <section className={`mat-zone ${kind}-pile`} aria-label={name}>
    <span className="zone-label" aria-hidden="true">{kind.toUpperCase()}</span>
    <button ref={button} type="button" className="pile-button" aria-label={buttonLabel} aria-description={hint}
      aria-haspopup={kind === 'used' ? 'dialog' : undefined} aria-disabled={inactive || undefined} aria-keyshortcuts="Shift+F10 ContextMenu"
      onClick={() => { if (!inactive) onClick(); }}
      onContextMenu={event => { event.preventDefault(); openMenu(); }}
      onKeyDown={event => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          openMenu();
        }
      }}>{children}</button>
    <span className="pile-tooltip" aria-hidden="true"><strong>{name}</strong><span>{hint}</span></span>
    <div ref={menu} popover="auto" className="pile-menu" role="group" aria-label={menuLabel} tabIndex={-1}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); } }}>
      <button ref={action} type="button" disabled={!onAction} aria-label={actionName} onClick={() => { closeMenu(); onAction?.(); }}>{actionLabel}</button>
    </div>
  </section>;
}

export function DeckPile({ src, deckName, count, shuffled, onShuffle, onUnshuffle }: { src: string; deckName: string; count: number; shuffled: boolean; onShuffle: () => void; onUnshuffle: () => void }) {
  const [spin, setSpin] = useState(0);
  const order = shuffled ? '섞인 순서' : '등록 순서';
  return <Pile kind="deck" name={`덱 · ${deckName}`} buttonLabel={`${deckName} ${count}장 · 눌러서 손패 순서 섞기`}
    hint={`${order} · 클릭으로 섞기 · 우클릭 또는 Shift+F10으로 원래 순서`}
    actionLabel="원래 순서" onAction={shuffled ? onUnshuffle : undefined}
    onClick={() => { if (count > 1) setSpin(value => value + 1); onShuffle(); }}>
    <span className={`pile ${spin ? `is-shuffling-${spin % 2}` : ''}`} aria-hidden="true">
      {count ? <><img src={src} alt="" draggable={false}/><img src={src} alt="" draggable={false}/><img src={src} alt="" draggable={false}/></> : <span className="pile-empty"/>}
      <span className="pile-count">{count}</span>
    </span>
  </Pile>;
}

export function UsedPile({ events, cards, disabled, onOpen, onClear, onRestore }: { events: ResourceEvent[]; cards: CardDefinition[]; disabled: boolean; onOpen: () => void; onClear?: () => void; onRestore?: () => void }) {
  const used = events.filter(event => event.type === 'card_used');
  const top = used.slice(0, 2).map(event => cards.find(card => card.id === event.cardId)).filter((card): card is CardDefinition => !!card).reverse();
  return <Pile kind="used" name="최근 사용" buttonLabel={`사용한 카드 더미 · 최근 ${used.length}건 · 전체 카드 사용 기록 열기`}
    hint={disabled ? '캐릭터를 선택하면 사용 기록을 볼 수 있습니다.' : '클릭으로 전체 기록 보기 · 우클릭 또는 Shift+F10으로 표시 관리'}
    inactive={disabled} actionLabel={onRestore ? '되돌리기' : '비우기'} actionName={onRestore ? undefined : '최근 사용 더미 비우기'}
    onAction={onRestore ?? (used.length ? onClear : undefined)} onClick={onOpen}>
    <span className="pile" aria-hidden="true">
      {top.length ? top.map((card, index) => <span className="used-card" key={`${card.id}-${index}`}><CardFace card={card}/></span>) : <span className="pile-empty"/>}
      <span className="pile-count">{used.length}</span>
    </span>
  </Pile>;
}
