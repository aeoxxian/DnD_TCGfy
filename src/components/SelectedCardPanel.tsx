import type { RefObject } from 'react';
import type { CardDefinition, Tag } from '../shared/contracts';
import { ACTION_NAMES, KIND_NAMES, RANGE_NAMES, ROLE_NAMES } from '../shared/library';
import type { ResourceController } from './ResourcePanel';
import { CardFace } from './CardFace';
import { CardUsage } from './CardResources';

export function SelectedCardPanel({card,tags,controller,onPreview,onClose,closeRef}:{card?:CardDefinition;tags:Tag[];controller:ResourceController;onPreview:()=>void;onClose:()=>void;closeRef:RefObject<HTMLButtonElement|null>}) {
  const properties=card?`${KIND_NAMES[card.kind]} · ${card.actions.map(a=>ACTION_NAMES[a]).join(' · ')} · ${RANGE_NAMES[card.range.kind]}${card.range.feet!==undefined?` ${card.range.feet} ft`:''}${card.spellLevel!==undefined?` · 주문 ${card.spellLevel}레벨`:''}`:'';
  return <aside className="detail-panel" aria-label="선택 카드 상세"><div className="panel-title"><h2>카드 살펴보기</h2>{card&&<button ref={closeRef} aria-label="카드 선택 닫기" onClick={onClose}>닫기</button>}</div>{card?<div className="selection" key={card.id}>
    <section className="selected-card-summary" aria-label="선택 카드 정보"><button type="button" className="detail-card preview-button" aria-label={`${card.name} 미리보기 확대`} disabled={!card.imageAssetId} onClick={onPreview}><CardFace key={`${card.id}-${card.imageAssetId}`} card={card} original/></button><div className="selected-card-heading"><h2 title={card.name}>{card.name}</h2><p className="selected-properties" title={properties}>{properties}</p><div className="detail-tags">{card.roles.map(role=><span key={role}>{ROLE_NAMES[role]}</span>)}{card.tags.map(id=><span key={id}>{tags.find(t=>t.id===id)?.name??id}</span>)}</div></div></section>
    <details open className="description-pane"><summary>설명·추가 정보</summary><div className="description-content" aria-label="카드 설명 스크롤" tabIndex={0}><p className="detail-description">{card.description||'보조 설명이 없습니다. 이미지를 클릭하면 원본을 크게 볼 수 있습니다.'}</p><p>{properties}</p><p>{card.tags.map(id=>tags.find(t=>t.id===id)?.name??id).join(' · ')}</p></div></details>
    <CardUsage key={`${controller.snapshot?.characterId}-${card.id}-${card.updatedAt}`} card={card} controller={controller}/>
  </div>:<div className="empty-selection"><div className="empty-card" aria-hidden="true">◇</div><h3>어떤 카드를 고를까요?</h3><p>손패에서 카드를 선택하세요.<br/>이곳에서 내용을 읽고 사용합니다.</p></div>}</aside>;
}
