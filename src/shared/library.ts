import type { CardDefinition, ImageMode, LibraryState, Role } from './contracts';

export function cardImageMode(card: Pick<CardDefinition, 'imageMode' | 'imageAssetId' | 'imageReference'>): ImageMode {
  return card.imageMode ?? (card.imageAssetId || card.imageReference ? 'full_card' : 'none');
}
export const IMAGE_MODE_NAMES: Record<ImageMode, string> = { full_card: '완성 카드', illustration: '삽화만', none: '이미지 없음' };

export const ROLE_NAMES: Record<Role, string> = { damage: '공격', heal: '치유', protect: '보호', buff: '강화', debuff: '약화', utility: '유틸', revive: '소생', other: '기타' };
export const KIND_NAMES = { spell: '주문', attack: '공격', feature: '직업 특성', feat: '재주', item: '아이템', other: '기타' } as const;
export const ACTION_NAMES = { action: '행동', bonus_action: '보너스 행동', reaction: '반응 행동', no_action: '행동 없음', passive: '상시', special: '특수' } as const;
export const RANGE_NAMES = { self: '자신', touch: '접촉', melee: '근접', ranged: '원거리', special: '특수' } as const;
export function normalizeText(value: string): string { return value.normalize('NFKC').trim().toLocaleLowerCase('ko'); }
export function filterCards(cards: CardDefinition[], state: LibraryState, deckCardIds?: string[]): CardDefinition[] {
  const deck = new Set(deckCardIds ?? []);
  const query = normalizeText(state.query);
  return cards.filter(card =>
    (state.viewScope === 'library' || deck.has(card.id)) &&
    (!query || normalizeText(card.name).includes(query)) &&
    (!state.roles.length || state.roles.some(role => card.roles.includes(role))) &&
    (!state.actions.length || state.actions.some(action => card.actions.includes(action))) &&
    (!state.concentration || card.concentration === true) &&
    (!state.ritual || card.ritual === true) &&
    (!state.kinds.length || state.kinds.includes(card.kind)) &&
    (!state.ranges.length || state.ranges.includes(card.range.kind)) &&
    (!state.tagIds.length || state.tagIds.some(id => card.tags.includes(id))),
  );
}
