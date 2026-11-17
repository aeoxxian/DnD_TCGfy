import { memo } from 'react';
import type { CardDefinition } from '../shared/contracts';
import { KIND_NAMES, ROLE_NAMES } from '../shared/library';
import { CardFace } from './CardFace';
import { HandSurface } from './HandSurface';

const CardTile = memo(function CardTile({ card, selected, checked, selectionMode, note, onSelect, onCheck }: {
  card: CardDefinition; selected: boolean; checked: boolean; selectionMode: boolean; note?: string;
  onSelect: (cardId: string, button: HTMLButtonElement) => void; onCheck: (cardId: string, checked: boolean) => void;
}) {
  return <div className={`card-item ${selected ? 'is-selected' : ''}`}>
    {selectionMode && <label className="card-batch-check" onPointerDown={event => event.stopPropagation()}><input type="checkbox" aria-label={`${card.name} 일괄 선택`} checked={checked} onChange={event => onCheck(card.id, event.target.checked)}/>선택 관리</label>}
    <button className={`card-button ${selected ? 'selected' : ''}`} tabIndex={-1} aria-label={`${card.name} 카드 선택`} aria-pressed={selected} onClick={event => onSelect(card.id, event.currentTarget)}>
      <CardFace key={`${card.id}-${card.imageAssetId}`} card={card}/>
      <span className="card-caption"><strong title={card.name}>{card.name}</strong><span>{card.roles.map(role => ROLE_NAMES[role]).join(' · ') || KIND_NAMES[card.kind]}</span>{note && <small className="card-resource-note">{note}</small>}</span>
    </button>
  </div>;
});

export function CardGallery({ cards, mode, selectedId, selectedIds, selectionMode, notes, onSelect, onCheck }: {
  cards: CardDefinition[]; mode: 'hand' | 'grid'; selectedId?: string; selectedIds: string[]; selectionMode: boolean; notes: Map<string, string>;
  onSelect: (cardId: string, button: HTMLButtonElement) => void; onCheck: (cardId: string, checked: boolean) => void;
}) {
  return <div className={`card-gallery ${selectionMode ? 'batch-selection' : ''} ${cards.length >= 50 ? 'large-hand' : cards.length >= 20 ? 'medium-hand' : ''}`}>
    <p id="card-navigation-help" className="sr-only">방향키로 카드 포커스 이동, Home과 End로 처음과 끝 이동, Enter 또는 Space로 선택. 사용 확정은 오른쪽 버튼에서 별도로 실행합니다.</p>
    <HandSurface mode={mode}>{cards.map(card => <CardTile key={card.id} card={card} selected={selectedId === card.id} checked={selectedIds.includes(card.id)} selectionMode={selectionMode} note={notes.get(card.id)} onSelect={onSelect} onCheck={onCheck}/>)}</HandSurface>
  </div>;
}
