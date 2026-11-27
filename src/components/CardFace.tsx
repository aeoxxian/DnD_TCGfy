import { cloneElement, isValidElement, useEffect, useId, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import type { CardDefinition } from '../shared/contracts';
import { ACTION_NAMES, KIND_NAMES, cardImageMode } from '../shared/library';

export function imageUrl(id: string, thumbnail = false): string { return `app://assets/${encodeURIComponent(id)}${thumbnail ? '/thumbnail' : ''}`; }

type Kind = CardDefinition['kind'];
/** v1.3: one line icon per existing card kind (no new kinds). Drawn for this project; 24×24, stroked with the trim colour. */
const KIND_ICONS: Record<Kind, ReactNode> = {
  spell: <><path d="M12 2.8 13.9 10.1 21.2 12 13.9 13.9 12 21.2 10.1 13.9 2.8 12 10.1 10.1Z"/><path d="M18.6 3.6v3.2M17 5.2h3.2M5.4 16.9v2.8M4 18.3h2.8"/></>,
  attack: <><path d="M19.6 4.4 19.1 8.1 10.6 16.6 7.4 13.4 15.9 4.9Z"/><path d="M6.6 11.2 12.8 17.4M8.6 15.4 5.3 18.7"/><circle cx="4.6" cy="19.4" r="1.1"/></>,
  feature: <><path d="M12 2.9 19.2 5.9V11.5C19.2 16.1 16.1 19.3 12 21.1 7.9 19.3 4.8 16.1 4.8 11.5V5.9Z"/><path d="M12 7.4V16.6M8.3 10.6H15.7"/></>,
  feat: <><path d="M8.2 2.9 12 9.1 15.8 2.9"/><circle cx="12" cy="14.6" r="5.9"/><path d="M12 11.3 12.95 13.3 15.1 13.55 13.5 15.05 13.95 17.2 12 16.1 10.05 17.2 10.5 15.05 8.9 13.55 11.05 13.3Z"/></>,
  item: <><path d="M9.4 3H14.6M10.4 3V8.6L5.9 16.4C4.9 18.4 6.3 21 8.6 21H15.4C17.7 21 19.1 18.4 18.1 16.4L13.6 8.6V3"/><path d="M7.5 15H16.5"/></>,
  other: <><path d="M12 3.4 20.6 12 12 20.6 3.4 12Z"/><circle cx="12" cy="12" r="1.7"/></>,
};
export function KindIcon({ kind, className }: { kind: Kind; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.45} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{KIND_ICONS[kind] ?? KIND_ICONS.other}</svg>;
}

/** The kind line under the emblem: “주문 · 1레벨”, “주문 · 소마법”, “아이템”… */
export function kindLine(card: Pick<CardDefinition, 'kind' | 'spellLevel'>): string {
  const level = card.kind === 'spell' && card.spellLevel !== undefined ? ` · ${card.spellLevel === 0 ? '소마법' : `${card.spellLevel}레벨`}` : '';
  return `${KIND_NAMES[card.kind] ?? KIND_NAMES.other}${level}`;
}
export type DefaultCardInfo = Pick<CardDefinition, 'name' | 'kind' | 'spellLevel' | 'actions'> & Partial<Pick<CardDefinition, 'castOptions' | 'costStatus'>>;

/**
 * v1.3: the printed face of a card that has no image — a plain TCG frame in the theme's trim with the name, a kind
 * emblem and the kind/action lines. It never says that an image is missing; a card whose image file cannot be read
 * (a real error) gets a small notice strip instead.
 */
export function DefaultCard({ card, artwork, broken = false, placeholder = false }: { card: DefaultCardInfo; artwork?: ReactNode; broken?: boolean; placeholder?: boolean }) {
  const actions = card.actions.map(action => ACTION_NAMES[action]).filter(Boolean).join(' · ');
  const costs = card.castOptions?.find(option => !option.ritual)?.costs;
  const cost = costs?.map(value => value.type === 'slot' || value.slotLevel !== undefined ? '슬롯' : value.type === 'fixed' ? String(value.amount) : `${value.min}–${value.max}`).join(' + ');
  return <div className={`default-card ${placeholder ? 'is-placeholder' : ''}`} data-kind={card.kind}>
    <div className="dc-frame">
      <div className="dc-name"><span>{card.name || '이름 없는 카드'}</span></div>
      <div className={artwork ? 'dc-artwork' : 'dc-emblem'}>{artwork ?? <KindIcon kind={card.kind}/>}</div>
      <div className="dc-type"><span className="dc-kind">{kindLine(card)}</span>{actions && <span className="dc-actions">{actions}</span>}{artwork && cost && card.costStatus !== 'unconfigured' && <span className="dc-actions dc-cost" title={`비용 ${cost}`}>비용 {cost}</span>}</div>
    </div>
    {broken && <p className="dc-broken">이미지 파일을 읽을 수 없습니다.</p>}
  </div>;
}

/**
 * v1.3 (memo 1): whether an image has see-through pixels. The main process checks the thumbnail once (the page cannot
 * read pixels of app://assets images); requests made in the same tick go out together. Only such cards draw their
 * shadow and selection glow along the image and mask the card-back overlay; opaque cards keep the cheaper box shadow.
 */
const alphaCache = new Map<string, boolean>();
const alphaWaiting = new Map<string, ((value: boolean | undefined) => void)[]>();
let alphaFlush: ReturnType<typeof setTimeout> | undefined;
function requestAlpha(id: string): Promise<boolean | undefined> {
  const known = alphaCache.get(id); if (known !== undefined) return Promise.resolve(known);
  return new Promise(resolve => {
    alphaWaiting.set(id, [...(alphaWaiting.get(id) ?? []), resolve]);
    alphaFlush ??= setTimeout(() => {
      alphaFlush = undefined; const batch = new Map(alphaWaiting); alphaWaiting.clear();
      const settle = (values: Record<string, boolean>) => {
        for (const [key, callbacks] of batch) {
          const value = Object.hasOwn(values, key) ? values[key] : undefined;
          if (value !== undefined) alphaCache.set(key, value);
          for (const done of callbacks) done(value);
        }
      };
      const ids = [...batch.keys()];
      const chunks = Array.from({ length: Math.ceil(ids.length / 500) }, (_, i) => ids.slice(i * 500, i * 500 + 500));
      Promise.all(chunks.map(chunk => Promise.resolve(window.desktop?.assetAlpha?.(chunk)).then(result => result?.ok ? result.value : {}, () => ({}))))
        .then(parts => settle(Object.assign({}, ...parts)), () => settle({}));
    }, 0);
  });
}

type CardFaceProps = { card: CardDefinition; original?: boolean; overlay?: ReactNode };

export function CardFace(props: CardFaceProps) {
  return <CardFaceContent key={`${props.original ? 'original' : 'thumbnail'}:${cardImageMode(props.card)}:${props.card.imageAssetId ?? ''}`} {...props}/>;
}

function CardFaceContent({ card, original = false, overlay }: CardFaceProps) {
  const mode = cardImageMode(card);
  const assetId = mode === 'none' ? undefined : card.imageAssetId;
  const alphaAssetId = mode === 'full_card' ? assetId : undefined;
  const maskId = useId();
  const [failed, setFailed] = useState(false);
  const [alpha, setAlpha] = useState(() => alphaAssetId ? alphaCache.get(alphaAssetId) : undefined);
  const src = assetId && !failed ? imageUrl(assetId, !original) : undefined;
  const fullImage = mode === 'full_card' ? src : undefined;
  useEffect(() => {
    if (!alphaAssetId) return;
    let live = true;
    void requestAlpha(alphaAssetId).then(value => { if (live) setAlpha(value); });
    return () => { live = false; };
  }, [alphaAssetId]);
  const masked = !!fullImage && alpha === true && isValidElement(overlay);
  // A CSS mask fetched from app://assets is cross-origin. An inline SVG mask can use the same image as an <img>
  // without canvas access or changes to Electron's protocol permissions. The viewBox mirrors the card face's contain fit.
  const style: CSSProperties | undefined = masked ? { maskImage: `url("#${maskId}")` } : fullImage && alpha === undefined ? { visibility: 'hidden' } : undefined;
  const shownOverlay = style && isValidElement(overlay) ? cloneElement(overlay as ReactElement<{ style?: CSSProperties }>, { style }) : overlay;
  const image = src ? <img src={src} alt={`${card.name} 카드 이미지`} loading={original ? 'eager' : 'lazy'} decoding="async" draggable={false} onError={() => setFailed(true)}/> : undefined;
  const illustrated = mode === 'illustration' && !!image;
  return <div className={`card-face ${fullImage ? 'image-face' : 'default-face'} ${alpha && fullImage ? 'has-alpha' : ''} role-${card.roles[0] ?? 'other'}`}>
    {fullImage ? image
      : <div className="default-face-art" role="img" aria-label={`${card.name} ${illustrated ? '삽화 카드' : '기본 카드'} · ${kindLine(card)}${failed ? ' · 이미지 파일을 읽을 수 없음' : ''}`}><DefaultCard card={card} artwork={illustrated ? image : undefined} broken={failed}/></div>}
    {masked && <svg aria-hidden="true" focusable="false" className="card-alpha-mask" width="0" height="0">
      <defs><mask id={maskId} maskContentUnits="objectBoundingBox" style={{ maskType: 'alpha' }}>
        <svg width="1" height="1" viewBox="0 0 100 145.8" preserveAspectRatio="none">
          <image href={src} width="100" height="145.8"/>
        </svg>
      </mask></defs>
    </svg>}
    {shownOverlay}
  </div>;
}

export function OriginalImage({ card, natural }: { card: CardDefinition; natural: boolean }) {
  const [failed, setFailed] = useState(false);
  return card.imageAssetId && !failed ? <div className={`original-image-scroll ${natural ? 'natural-size' : ''}`}><img src={imageUrl(card.imageAssetId)} alt={`${card.name} 원본 확대`} onError={() => setFailed(true)} draggable={false} /></div> : <p className="empty-state">원본 이미지를 읽을 수 없습니다. 카드 정보는 보존되어 있습니다.</p>;
}
