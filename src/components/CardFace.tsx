import { useState, type ReactNode } from 'react';
import type { CardDefinition } from '../shared/contracts';
import { ACTION_NAMES, KIND_NAMES } from '../shared/library';

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
export type DefaultCardInfo = Pick<CardDefinition, 'name' | 'kind' | 'spellLevel' | 'actions'>;

/**
 * v1.3: the printed face of a card that has no image — a plain TCG frame in the theme's trim with the name, a kind
 * emblem and the kind/action lines. It never says that an image is missing; a card whose image file cannot be read
 * (a real error) gets a small notice strip instead.
 */
export function DefaultCard({ card, broken = false, placeholder = false }: { card: DefaultCardInfo; broken?: boolean; placeholder?: boolean }) {
  const actions = card.actions.map(action => ACTION_NAMES[action]).filter(Boolean).join(' · ');
  return <div className={`default-card ${placeholder ? 'is-placeholder' : ''}`} data-kind={card.kind}>
    <div className="dc-frame">
      <div className="dc-name"><span>{card.name || '이름 없는 카드'}</span></div>
      <div className="dc-emblem"><KindIcon kind={card.kind}/></div>
      <div className="dc-type"><span className="dc-kind">{kindLine(card)}</span>{actions && <span className="dc-actions">{actions}</span>}</div>
    </div>
    {broken && <p className="dc-broken">이미지 파일을 읽을 수 없습니다.</p>}
  </div>;
}

export function CardFace({ card, original = false, overlay }: { card: CardDefinition; original?: boolean; overlay?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  const showImage = !!card.imageAssetId && !failed;
  return <div className={`card-face ${showImage ? 'image-face' : 'default-face'} role-${card.roles[0] ?? 'other'}`}>
    {showImage
      ? <img src={imageUrl(card.imageAssetId!, !original)} alt={`${card.name} 카드 이미지`} loading={original ? 'eager' : 'lazy'} decoding="async" draggable={false} onError={() => setFailed(true)} />
      : <div className="default-face-art" role="img" aria-label={`${card.name} 기본 카드 · ${kindLine(card)}${failed ? ' · 이미지 파일을 읽을 수 없음' : ''}`}><DefaultCard card={card} broken={failed}/></div>}
    {overlay}
  </div>;
}

export function OriginalImage({ card, natural }: { card: CardDefinition; natural: boolean }) {
  const [failed, setFailed] = useState(false);
  return card.imageAssetId && !failed ? <div className={`original-image-scroll ${natural ? 'natural-size' : ''}`}><img src={imageUrl(card.imageAssetId)} alt={`${card.name} 원본 확대`} onError={() => setFailed(true)} draggable={false} /></div> : <p className="empty-state">원본 이미지를 읽을 수 없습니다. 카드 정보는 보존되어 있습니다.</p>;
}
