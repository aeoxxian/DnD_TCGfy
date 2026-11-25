import type { CardDefinition } from './contracts';

/**
 * v1.3 (memo 4): the hand's display order after the DECK pile is pressed. Only the order changes — the deck's cards,
 * their saved order and the library stay the same — and it lasts for this run.
 */
export function shuffleIds(ids: string[], random: (n: number) => number = secureIndex): string[] {
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) { const j = random(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
/** Cards in the shuffled order; cards the order does not know (registered later) keep their order after them. */
export function orderCards(cards: CardDefinition[], order?: string[]): CardDefinition[] {
  if (!order) return cards;
  const rank = new Map(order.map((id, index) => [id, index]));
  return cards.map((card, index) => ({ card, index })).sort((a, b) => (rank.get(a.card.id) ?? order.length + a.index) - (rank.get(b.card.id) ?? order.length + b.index)).map(item => item.card);
}
function secureIndex(n: number): number {
  const value = new Uint32Array(1); crypto.getRandomValues(value);
  return value[0] % n;
}
