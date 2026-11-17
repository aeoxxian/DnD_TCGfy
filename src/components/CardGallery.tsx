import { memo } from 'react';
import type { CardDefinition } from '../shared/contracts';
import { KIND_NAMES, ROLE_NAMES } from '../shared/library';
import { CardFace } from './CardFace';
import { HandSurface } from './HandSurface';
import { isUnusable, USABILITY_NOTES, type CardUsability } from '../shared/usability';

const CardTile = memo(function CardTile({ card, selected, checked, selectionMode, note, usability = 'unknown', backSrc, onSelect, onCheck, onPreview }: {
  card: CardDefinition; selected: boolean; checked: boolean; selectionMode: boolean; note?: string; usability?: CardUsability; backSrc?: string;
  onSelect: (cardId: string, button: HTMLButtonElement) => void; onCheck: (cardId: string, checked: boolean) => void; onPreview: (cardId: string, button: HTMLButtonElement) => void;
}) {
  const blocked = isUnusable(usability);
  // Unusable cards wear the deck's card back at 75% on top of the untouched original; selecting shows the original.
  const overlay = blocked && backSrc ? <img className="card-unusable-back" src={backSrc} alt="" aria-hidden="true" draggable={false}/> : undefined;
  return <div className={`card-item ${selected ? 'is-selected' : ''} ${blocked ? 'is-unusable' : ''}`} data-usability={usability}>
    {selectionMode && <label className="card-batch-check" onPointerDown={event => event.stopPropagation()}><input type="checkbox" aria-label={`${card.name} 일괄 선택`} checked={checked} onChange={event => onCheck(card.id, event.target.checked)}/><span>선택</span></label>}
    <button className={`card-button ${selected ? 'selected' : ''}`} tabIndex={-1} aria-label={`${card.name} 카드 선택`} aria-pressed={selected} aria-description={blocked ? `사용 불가 · ${USABILITY_NOTES[usability]}` : undefined}
      onClick={event => {
        // Click selects; clicking the selected card again (mouse, Enter or Space) opens the enlargement. Never spends resources.
        if (!selected) onSelect(card.id, event.currentTarget);
        else if (card.imageAssetId) onPreview(card.id, event.currentTarget);
      }}>
      <CardFace key={`${card.id}-${card.imageAssetId}`} card={card} overlay={overlay}/>
      <span className="card-caption"><strong title={card.name}>{card.name}</strong><span>{card.roles.map(role => ROLE_NAMES[role]).join(' · ') || KIND_NAMES[card.kind]}</span>{note && <small className="card-resource-note">{note}</small>}</span>
    </button>
  </div>;
});

export function CardGallery({ cards, mode, selectedId, selectedIds, selectionMode, notes, usability, backSrc, onSelect, onCheck, onPreview }: {
  cards: CardDefinition[]; mode: 'hand' | 'grid'; selectedId?: string; selectedIds: string[]; selectionMode: boolean; notes: Map<string, string>; usability?: Map<string, CardUsability>; backSrc?: string;
  onSelect: (cardId: string, button: HTMLButtonElement) => void; onCheck: (cardId: string, checked: boolean) => void; onPreview: (cardId: string, button: HTMLButtonElement) => void;
}) {
  return <div className={`card-gallery ${selectionMode ? 'batch-selection' : ''} ${cards.length >= 50 ? 'large-hand' : cards.length >= 20 ? 'medium-hand' : ''}`}>
    <p id="card-navigation-help" className="sr-only">방향키로 카드 포커스 이동, Home과 End로 처음과 끝 이동, Enter 또는 Space로 선택, 선택한 카드에서 다시 누르면 원본 확대. 사용 확정은 오른쪽 버튼에서 별도로 실행합니다.</p>
    <HandSurface mode={mode}>{cards.map(card => <CardTile key={card.id} card={card} selected={selectedId === card.id} checked={selectedIds.includes(card.id)} selectionMode={selectionMode} note={notes.get(card.id)} usability={usability?.get(card.id)} backSrc={backSrc} onSelect={onSelect} onCheck={onCheck} onPreview={onPreview}/>)}</HandSurface>
  </div>;
}
