// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { AppStore } from '../electron/store';
import { LibraryStore } from '../electron/library-store';
import { DEFAULT_LIBRARY_STATE, type CardDraft } from '../src/shared/contracts';
import { filterCards } from '../src/shared/library';
import { HandSurface } from '../src/components/HandSurface';

afterEach(cleanup);
const root = resolve('artifacts/p11-unit'); mkdirSync(root, { recursive: true });
const card = (name: string): CardDraft => ({ name, kind: 'other', roles: [], actions: [], range: { kind: 'special' }, tags: [] });
function fixture() { const store = new AppStore(mkdtempSync(join(root, 'case-'))); return { store, library: new LibraryStore(store) }; }

describe('P1.1 registration and distinct filter domains', () => {
  it('adds new cards atomically to the current deck only, including batches', () => {
    const { store, library } = fixture(); library.createProfile({ name: 'A' }); const a = library.getLibrary().profiles[0];
    library.createProfile({ name: 'B' }); const b = library.getLibrary().profiles[1];
    const target = { characterId: b.id, deckId: b.activeDeckId! };
    const data = library.saveCards({ cards: [card('one'), card('two')], registrationTarget: target });
    expect(data.decks.find(deck => deck.id === b.activeDeckId)!.cardIds).toEqual(data.cards.map(card => card.id));
    expect(data.decks.find(deck => deck.id === a.activeDeckId)!.cardIds).toEqual([]); store.close();
  });
  it('refuses stale/foreign targets and rolls back both card and deck writes', () => {
    const { store, library } = fixture(); library.createProfile({ name: 'A' }); const a = library.getLibrary().profiles[0];
    library.createProfile({ name: 'B' }); const b = library.getLibrary().profiles[1];
    expect(() => library.saveCards({ cards: [card('wrong')], registrationTarget: { characterId: a.id, deckId: a.activeDeckId } })).toThrow('바뀌');
    expect(() => library.saveCards({ cards: [card('first'), { ...card('bad'), tags: ['missing'] }], registrationTarget: { characterId: b.id, deckId: b.activeDeckId } })).toThrow();
    expect(library.getLibrary().cards).toEqual([]); expect(library.getLibrary().decks.every(deck => deck.cardIds.length === 0)).toBe(true); store.close();
  });
  it('registers without a deck when none is active and never re-links edits after switching character', () => {
    const { store, library } = fixture(); const first = library.saveCards({ cards: [card('library')], registrationTarget: null }).cards[0];
    library.createProfile({ name: 'A' }); library.createProfile({ name: 'B' });
    library.saveCards({ cards: [{ ...card('renamed'), id: first.id }] });
    expect(library.getLibrary().decks.every(deck => deck.cardIds.length === 0)).toBe(true); store.close();
  });
  it('persists attack kind independently of damage role and combines kinds/roles/tags correctly', () => {
    const { store, library } = fixture(); library.saveTag({ name: 'shared' }); const tag = library.getLibrary().tags[0].id;
    const data = library.saveCards({ cards: [
      { ...card('damage spell'), kind: 'spell', roles: ['damage'], tags: [tag] },
      { ...card('utility attack'), kind: 'attack', roles: ['utility'], tags: [tag] },
      { ...card('damage attack'), kind: 'attack', roles: ['damage'], tags: [] },
    ] });
    expect(filterCards(data.cards, { ...DEFAULT_LIBRARY_STATE, roles: ['damage'] }).map(card => card.name)).toEqual(['damage spell', 'damage attack']);
    expect(filterCards(data.cards, { ...DEFAULT_LIBRARY_STATE, kinds: ['attack'] }).map(card => card.name)).toEqual(['utility attack', 'damage attack']);
    expect(filterCards(data.cards, { ...DEFAULT_LIBRARY_STATE, kinds: ['attack'], roles: ['damage'] }).map(card => card.name)).toEqual(['damage attack']);
    expect(filterCards(data.cards, { ...DEFAULT_LIBRARY_STATE, kinds: ['attack','spell'], roles: ['utility','damage'], tagIds: [tag] })).toHaveLength(2); store.close();
  });
});

describe('hand wheel and drag boundaries', () => {
  it('maps vertical wheel inside hand, leaves horizontal trackpad and grid input alone', () => {
    const view = render(<HandSurface mode="hand"><button>card</button></HandSurface>); const area = screen.getByLabelText('카드 목록');
    Object.defineProperties(area, { clientWidth: { value: 500 }, scrollWidth: { value: 5000 } });
    expect(fireEvent.wheel(area, { deltaY: 100, cancelable: true })).toBe(false); expect(area.scrollLeft).toBe(100);
    fireEvent.wheel(area, { deltaY: -50, cancelable: true }); expect(area.scrollLeft).toBe(50);
    expect(fireEvent.wheel(area, { deltaX: 100, deltaY: 1, cancelable: true })).toBe(true); expect(area.scrollLeft).toBe(50);
    view.rerender(<HandSurface mode="grid"><button>card</button></HandSurface>);
    expect(fireEvent.wheel(area, { deltaY: 100, cancelable: true })).toBe(true); expect(area.scrollLeft).toBe(50);
  });
});
