// v1.3 Phase 3: shared measurements of the three-column play board (used by v13-p3-e2e and v13-p3-ux-e2e).
// Full-height IN PLAY | card page over HAND | ledger over USED and DECK.
import assert from 'node:assert/strict';

/** Rectangles of every zone plus the facts the layout promises. */
export const measure = page => page.evaluate(() => {
  const r = sel => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const box = el => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const zones = { inPlay: r('.board-left > .in-play-slot'), page: r('.board-center > .detail-panel'), hand: r('.board-center > .hand-row'),
    ledger: r('.board-right > .resource-panel'), used: r('.board-piles > .used-pile'), deck: r('.board-piles > .deck-pile') };
  const card = r('.in-play-slot .detail-card'); const seal = r('.use-button'); const codex = r('.codex-page');
  const coins = [...document.querySelectorAll('.rest-buttons button')].map(box);
  const piles = [...document.querySelectorAll('.board-column .pile')].map(el => el.getBoundingClientRect().height);
  const faceBox = document.querySelector('.cards-area .card-item .card-face')?.getBoundingClientRect(); const areaBox = document.querySelector('.cards-area')?.getBoundingClientRect();
  const handCard = faceBox && areaBox ? { top: faceBox.top - areaBox.top, bottom: areaBox.bottom - faceBox.bottom, ratio: faceBox.height / faceBox.width, width: faceBox.width } : null;
  // The hand row never scrolls vertically: whole cards, their names and the raised selected card fit its height.
  const area = document.querySelector('.cards-area'); const handFit = area ? { overflowY: area.scrollHeight - area.clientHeight, scrollTop: area.scrollTop } : null;
  return { zones, card, seal, codex, coins, piles, handCard, handFit, emptySlot: r('.in-play-slot .empty-slot'), emptyHand: r('.hand-row .empty-library'),
    grid: r('.board-grid'), pileRow: r('.board-piles'), undo: r('.resource-footer .undo-button'), filters: r('.board-top'), vw: innerWidth, vh: innerHeight,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    collapsed: document.querySelector('.app.resources-collapsed') !== null };
});
export const inside = (a, b, slack = 1) => a.x >= b.x - slack && a.y >= b.y - slack && a.r <= b.r + slack && a.b <= b.b + slack;
export const overlap = (a, b) => Math.min(a.r, b.r) - Math.max(a.x, b.x) > 1 && Math.min(a.b, b.b) - Math.max(a.y, b.y) > 1;

/**
 * The layout contract. `selected: false` expects the empty IN PLAY slot and no Use seal; `hand: false` expects the
 * empty-hand message inside the hand row instead of cards; `coins: false` skips the recovery buttons.
 */
export function assertLayout(m, label, { collapsed = false, selected = true, hand = true, coins = !collapsed } = {}) {
  const z = m.zones; for (const [name, box] of Object.entries(z)) assert(box && box.w > 20 && box.h > 20, `${label}: ${name} is shown`);
  const view = { x: 0, y: 0, r: m.vw, b: m.vh };
  for (const [name, box] of Object.entries(z)) assert(inside(box, m.grid, 2) && inside(box, view), `${label}: ${name} inside the board and window ${JSON.stringify(box)}`);
  const names = Object.keys(z); for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) assert(!overlap(z[names[i]], z[names[j]]), `${label}: ${names[i]} and ${names[j]} do not overlap`);
  const near = (a, b) => Math.abs(a - b) < 1;
  assert(z.inPlay.r <= z.page.x && z.page.r <= z.ledger.x, `${label}: left, centre and right columns are ordered`);
  assert(near(z.inPlay.y, m.grid.y) && near(z.inPlay.b, m.grid.b), `${label}: IN PLAY spans the full board height`);
  assert(near(z.page.x, z.hand.x) && near(z.page.r, z.hand.r) && z.hand.y >= z.page.b, `${label}: card page and HAND share the centre bounds`);
  assert(near(z.ledger.x, m.pileRow.x) && near(z.ledger.r, m.pileRow.r) && m.pileRow.y >= z.ledger.b && near(m.pileRow.b, m.grid.b),
    `${label}: the ledger and pile row share the right bounds`);
  assert(near(z.used.y, z.deck.y) && near(z.used.b, z.deck.b) && z.used.r <= z.deck.x, `${label}: USED and DECK sit side by side`);
  const usableWidth = z.inPlay.w + z.page.w + z.ledger.w;
  for (const [box, fraction] of [[z.inPlay, .24], [z.page, .52], [z.ledger, .24]]) {
    assert(near(box.w, usableWidth * fraction), `${label}: column widths follow 24:52:24 after gaps ${JSON.stringify(z)}`);
  }
  if (collapsed) assert(z.ledger.h < 56 && !m.undo, `${label}: collapsed ledger only shows its header (${z.ledger.h}px)`);
  if (selected) {
    assert(m.card && inside(m.card, z.inPlay, 1) && Math.abs(m.card.h / m.card.w - 1.458) < .03, `${label}: IN PLAY card keeps 1:1.458 inside its slot ${JSON.stringify(m.card)}`);
    assert(m.seal && inside(m.seal, m.codex, 1) && inside(m.seal, view), `${label}: the Use seal is fully visible ${JSON.stringify({ seal: m.seal, codex: m.codex })}`);
  } else {
    assert(!m.card && !m.seal, `${label}: nothing selected, so no IN PLAY card and no Use seal`);
    assert(m.emptySlot && inside(m.emptySlot, z.inPlay, 1), `${label}: the empty IN PLAY slot is shown`);
  }
  if (coins) {
    assert.equal(m.coins.length, 4, `${label}: four recovery buttons`);
    assert(m.undo, `${label}: Undo is present`);
    for (const button of [...m.coins, m.undo]) assert(inside(button, z.ledger, 1) && inside(button, view), `${label}: recovery and Undo fully visible ${JSON.stringify({ button, ledger: z.ledger })}`);
  }
  assert(m.piles.length === 2 && m.piles.every(h => h >= 40), `${label}: both piles visible ${JSON.stringify(m.piles)}`);
  assert(m.overflow <= 0, `${label}: no horizontal page scroll`);
  if (hand) assert(m.handCard && m.handCard.top >= -1 && m.handCard.bottom >= -1 && Math.abs(m.handCard.ratio - 1.458) < .03, `${label}: hand cards are whole and keep their ratio ${JSON.stringify(m.handCard)}`);
  if (hand) assert(m.handFit.overflowY <= 1 && m.handFit.scrollTop === 0, `${label}: the hand row fits its cards and names without scrolling up or down ${JSON.stringify(m.handFit)}`);
  else assert(!m.handCard && m.emptyHand && inside(m.emptyHand, z.hand, 1), `${label}: the empty-hand message sits inside the hand row ${JSON.stringify({ empty: m.emptyHand, hand: z.hand })}`);
}
