// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { orderCards, shuffleIds } from '../src/shared/hand-order';
import { DEFAULT_LIBRARY_STATE, DEFAULT_SETTINGS, type Bootstrap, type DesktopBridge } from '../src/shared/contracts';
import { SAMPLE_CARDS } from '../src/shared/sample-cards';
import type { ResourceEvent } from '../src/shared/resources';

const ok = <T,>(value: T) => ({ ok: true as const, value });
const used = (id: string, cardId: string, minute: number): ResourceEvent => ({ id, characterId: 'hero', type: 'card_used', label: `${cardId} 사용`, changes: [], timestamp: `2026-11-25T10:${String(minute).padStart(2, '0')}:00.000Z`, cardId, reversible: true, barrier: false } as unknown as ResourceEvent);
const bootstrap: Bootstrap = {
  settings: DEFAULT_SETTINGS, cards: SAMPLE_CARDS, appVersion: '1.2.0', schemaVersion: 6,
  libraryState: { ...DEFAULT_LIBRARY_STATE, activeCharacterId: 'hero' }, tags: [],
  profiles: [{ id: 'hero', name: '엘라라', activeDeckId: 'deck-a' }], decks: [{ id: 'deck-a', characterId: 'hero', name: '주문서 덱', cardIds: SAMPLE_CARDS.map(card => card.id) }], warnings: [],
};
function bridge(events: ResourceEvent[] = []) {
  const desktop = {
    getBootstrap: vi.fn().mockResolvedValue(ok(structuredClone(bootstrap))),
    saveSettings: vi.fn().mockImplementation(async settings => ok(settings)),
    saveLibraryState: vi.fn().mockImplementation(async state => ok(state)),
    getResources: vi.fn().mockResolvedValue(ok({ characterId: 'hero', revision: 1, resources: [], templates: [], bindings: [], events, warnings: [] })),
    previewResource: vi.fn().mockResolvedValue(ok({ changes: [], label: '', canUse: false, canOverride: false, reason: '비용 미설정', revision: 1, quote: 'q' })),
    getUseHistory: vi.fn(), changeResource: vi.fn(), getTrash: vi.fn(),
  };
  window.desktop = desktop as unknown as DesktopBridge;
  return desktop;
}
const handNames = () => screen.getAllByRole('button', { name: / 카드 선택$/ }).map(button => button.getAttribute('aria-label')!.replace(/ 카드 선택$/, ''));

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('v1.3 Phase 3 UI-P1 · hand order', () => {
  it('shuffles every id exactly once and keeps cards it does not know after the shuffled ones', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const reversed = shuffleIds(ids, () => 0); // always swap with the first position → a fixed permutation
    expect([...reversed].sort()).toEqual(ids); expect(reversed).not.toEqual(ids);
    const real = shuffleIds(ids); expect([...real].sort()).toEqual(ids);
    const cards = ids.map(id => ({ id })) as never[];
    expect(orderCards(cards, ['c', 'a']).map((card: { id: string }) => card.id)).toEqual(['c', 'a', 'b', 'd', 'e']);
    expect(orderCards(cards)).toBe(cards);
  });

  it('the DECK pile shuffles the hand for this run only (nothing saved) and 원래 순서 restores it', async () => {
    const desktop = bridge();
    render(<App/>);
    const deck = await screen.findByRole('button', { name: /주문서 덱 \d+장 · 눌러서 손패 순서 섞기/ });
    const original = handNames();
    const saves = desktop.saveSettings.mock.calls.length + desktop.saveLibraryState.mock.calls.length;
    let order = original;
    for (let i = 0; i < 6 && order.join() === original.join(); i++) { fireEvent.click(deck); order = handNames(); }
    expect([...order].sort()).toEqual([...original].sort());
    expect(order).not.toEqual(original);
    expect(within(screen.getByRole('region', { name: '덱 · 주문서 덱' })).getByText(/섞인 순서/)).toBeDefined();
    expect(desktop.saveSettings.mock.calls.length + desktop.saveLibraryState.mock.calls.length).toBe(saves);
    fireEvent.click(screen.getByRole('button', { name: '원래 순서' }));
    expect(handNames()).toEqual(original);
    expect(screen.queryByRole('button', { name: '원래 순서' })).toBeNull();
  });
});

describe('v1.3 Phase 3 UI-P1 · clearing the USED pile', () => {
  it('비우기 hides the uses shown now (display only), and 되돌리기 brings them back', async () => {
    const events = [used('e3', SAMPLE_CARDS[1].id, 3), used('e2', SAMPLE_CARDS[0].id, 2)];
    const desktop = bridge(events);
    render(<App/>);
    const pile = await screen.findByRole('button', { name: '사용한 카드 더미 · 최근 2건 · 전체 카드 사용 기록 열기' });
    expect(pile).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '최근 사용 더미 비우기' }));
    await waitFor(() => expect(desktop.saveSettings).toHaveBeenCalled());
    const saved = desktop.saveSettings.mock.calls.at(-1)![0];
    expect(saved.usedViews).toEqual({ hero: { clearedEventId: 'e3', clearedAt: '2026-11-25T10:03:00.000Z' } });
    expect(await screen.findByRole('button', { name: '사용한 카드 더미 · 최근 0건 · 전체 카드 사용 기록 열기' })).toBeDefined();
    expect(desktop.changeResource).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    await waitFor(() => expect(desktop.saveSettings.mock.calls.at(-1)![0].usedViews).toEqual({}));
    expect(await screen.findByRole('button', { name: '사용한 카드 더미 · 최근 2건 · 전체 카드 사용 기록 열기' })).toBeDefined();
  });
});
