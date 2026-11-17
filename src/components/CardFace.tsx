import { useState, type ReactNode } from 'react';
import type { CardDefinition } from '../shared/contracts';
import { KIND_NAMES } from '../shared/library';

export function imageUrl(id: string, thumbnail = false): string { return `app://assets/${encodeURIComponent(id)}${thumbnail ? '/thumbnail' : ''}`; }
export function CardFace({ card, original = false, overlay }: { card: CardDefinition; original?: boolean; overlay?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  return <div className={`card-face ${card.imageAssetId && !failed ? 'image-face' : 'fallback-face'} role-${card.roles[0] ?? 'other'}`}>
    {card.imageAssetId && !failed ? <img src={imageUrl(card.imageAssetId, !original)} alt={`${card.name} 카드 이미지`} loading={original ? 'eager' : 'lazy'} decoding="async" draggable={false} onError={() => setFailed(true)} /> : <div className="image-fallback"><span aria-hidden="true">◇</span><h3>{card.name}</h3><p>{KIND_NAMES[card.kind]}</p><p>{failed ? '이미지 파일을 읽을 수 없습니다.' : '등록된 이미지가 없습니다.'}</p>{failed && <small>원본을 확인하거나 이미지를 교체해 주세요.</small>}</div>}
    {overlay}
  </div>;
}

export function OriginalImage({ card, natural }: { card: CardDefinition; natural: boolean }) {
  const [failed, setFailed] = useState(false);
  return card.imageAssetId && !failed ? <div className={`original-image-scroll ${natural ? 'natural-size' : ''}`}><img src={imageUrl(card.imageAssetId)} alt={`${card.name} 원본 확대`} onError={() => setFailed(true)} draggable={false} /></div> : <p className="empty-state">원본 이미지를 읽을 수 없습니다. 카드 정보는 보존되어 있습니다.</p>;
}
