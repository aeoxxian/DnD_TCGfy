import { DEFAULT_APPEARANCE, type Appearance, type CardBackRef } from './contracts';

/** Card back shown for a deck: the deck's own choice, else the default. */
export function cardBackFor(appearance: Appearance, deckId?: string): CardBackRef {
  return (deckId ? appearance.cardBack.decks[deckId] : undefined) ?? appearance.cardBack.default;
}

/** Apply a card back to one deck, or make it the default for every deck without its own choice. */
export function setCardBack(appearance: Appearance, ref: CardBackRef, scope: 'deck' | 'default', deckId?: string): Appearance {
  if (scope === 'deck' && deckId) return { ...appearance, cardBack: { ...appearance.cardBack, decks: { ...appearance.cardBack.decks, [deckId]: ref } } };
  return { ...appearance, cardBack: { ...appearance.cardBack, default: ref } };
}

/** Add a user image to the card-back list (no-op if it is already listed). */
export function addCustomBack(appearance: Appearance, assetId: string, name: string): Appearance {
  if (appearance.customBacks.some(item => item.assetId === assetId)) return appearance;
  const label = name.replace(/\.[^.]+$/, '').trim().slice(0, 60) || '내 이미지';
  return { ...appearance, customBacks: [...appearance.customBacks, { assetId, name: label }] };
}

/**
 * Remove a user image from the list. Decks (and the default) that used it fall back to the
 * built-in dragon back. The image file itself is never deleted.
 */
export function removeCustomBack(appearance: Appearance, assetId: string): Appearance {
  const uses = (ref: CardBackRef) => ref.type === 'custom' && ref.assetId === assetId;
  const fallback = DEFAULT_APPEARANCE.cardBack.default;
  const decks = Object.fromEntries(Object.entries(appearance.cardBack.decks).filter(([, ref]) => !uses(ref)));
  return {
    ...appearance,
    customBacks: appearance.customBacks.filter(item => item.assetId !== assetId),
    cardBack: { default: uses(appearance.cardBack.default) ? fallback : appearance.cardBack.default, decks },
  };
}
