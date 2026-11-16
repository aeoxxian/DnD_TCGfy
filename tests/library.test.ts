import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AppStore } from '../electron/store';
import { LibraryStore } from '../electron/library-store';
import { migrations } from '../electron/migrations';
import { DEFAULT_LIBRARY_STATE, DEFAULT_SETTINGS, type CardDraft, type CardDefinition } from '../src/shared/contracts';
import { filterCards } from '../src/shared/library';
import { SAMPLE_CARDS } from '../src/shared/sample-cards';

const root = resolve('artifacts/library-unit');
mkdirSync(root, { recursive: true });
function fixture() {
  const path = mkdtempSync(join(root, 'case-')); const store = new AppStore(path);
  return { path, store, library: new LibraryStore(store) };
}
function draft(name = '카드'): CardDraft { return { name, kind: 'feature', roles: ['utility'], actions: ['bonus_action'], range: { kind: 'self' }, tags: [] }; }
function editable(card: CardDefinition): CardDraft {
  return { id: card.id, name: card.name, imageAssetId: card.imageAssetId, kind: card.kind, roles: card.roles, actions: card.actions, range: card.range, tags: card.tags, spellLevel: card.spellLevel, description: card.description };
}

describe('AND / OR filtering', () => {
  const cards: CardDefinition[] = [
    { ...SAMPLE_CARDS[0], id: 'a', name: '치유의 빛', roles: ['heal', 'protect'], actions: ['bonus_action'], range: { kind: 'ranged' }, tags: ['t1'] },
    { ...SAMPLE_CARDS[1], id: 'b', name: '공격의 빛', roles: ['damage'], actions: ['bonus_action', 'reaction'], range: { kind: 'ranged' }, tags: ['t2'] },
    { ...SAMPLE_CARDS[2], id: 'c', name: '빛', roles: ['utility'], actions: ['action'], range: { kind: 'touch' }, tags: ['t1'] },
    { ...SAMPLE_CARDS[3], id: 'd', name: '다른 능력', roles: ['buff', 'revive', 'debuff'], actions: ['passive'], tags: [] },
  ];
  it('uses OR inside roles, actions, kinds, ranges and tags; AND between categories', () => {
    const state = { ...DEFAULT_LIBRARY_STATE, roles: ['heal', 'damage'] as const, actions: ['bonus_action'] as const, kinds: ['spell', 'attack'] as const, ranges: ['ranged'] as const, tagIds: ['t1', 't2'], query: '빛' };
    expect(filterCards(cards, { ...state, roles: [...state.roles], actions: [...state.actions], kinds: [...state.kinds], ranges: [...state.ranges] }).map(c => c.id)).toEqual(['a', 'b']);
    expect(filterCards(cards, { ...DEFAULT_LIBRARY_STATE, roles: ['damage', 'utility'], actions: ['bonus_action'] }).map(c => c.id)).toEqual(['b']);
    expect(filterCards(cards, { ...DEFAULT_LIBRARY_STATE, tagIds: ['t1'], roles: ['heal', 'damage'] }).map(c => c.id)).toEqual(['a']);
  });
  it('matches new role values, normalizes title search, and restricts a deck independently', () => {
    expect(filterCards(cards, { ...DEFAULT_LIBRARY_STATE, roles: ['revive'] }).map(c => c.id)).toEqual(['d']);
    expect(filterCards(cards, { ...DEFAULT_LIBRARY_STATE, query: '  빛  ' }).map(c => c.id)).toEqual(['a', 'b', 'c']);
    expect(filterCards(cards, { ...DEFAULT_LIBRARY_STATE, viewScope: 'deck' }, ['b', 'c']).map(c => c.id)).toEqual(['b', 'c']);
    expect(filterCards(cards, { ...DEFAULT_LIBRARY_STATE, viewScope: 'deck' })).toEqual([]);
  });
  it('does not mutate source arrays or exclude cards based on costs', () => {
    const before = structuredClone(cards);
    expect(filterCards(cards, DEFAULT_LIBRARY_STATE)).toHaveLength(4);
    expect(cards).toEqual(before);
  });
});

describe('card library persistence', () => {
  it('saves 20 independently identified cards and filters across restart', () => {
    const { path, store, library } = fixture();
    library.saveTag({ name: '집중' }); const tagId = library.getLibrary().tags[0].id;
    const input = Array.from({ length: 20 }, (_, i) => ({ ...draft(`테스트 ${i + 1}`), roles: ['protect', 'buff', 'debuff', 'revive'] as CardDraft['roles'], tags: [tagId] }));
    const saved = library.saveCards({ cards: input });
    expect(new Set(saved.cards.map(card => card.id)).size).toBe(20);
    const state = { ...DEFAULT_LIBRARY_STATE, roles: ['protect'] as CardDraft['roles'], tagIds: [tagId], query: '테스트' };
    library.saveState(state); store.close();
    const next = new AppStore(path); const reopened = new LibraryStore(next).getLibrary();
    expect(reopened.cards).toEqual(saved.cards); expect(reopened.libraryState).toEqual(state);
    expect(next.getSettings()).toEqual(DEFAULT_SETTINGS); next.close();
  });
  it('preserves identity, creation date, future costs, bindings and decks on metadata edits', () => {
    const { store, library } = fixture();
    let saved = library.saveCards({ cards: [draft('첫째'), draft('둘째')] }); const [first, other] = saved.cards;
    library.createProfile({ name: '테스트 캐릭터' });
    const profile = library.getLibrary().profiles[0]; const deckId = profile.activeDeckId!;
    library.setDeckCards({ deckId, cardIds: [first.id, other.id] });
    store.db.prepare("INSERT INTO resource_templates(id,key,name,kind,definition_json,source,version) VALUES ('t','spirit','영력','counter','{}','user',1)").run();
    store.db.prepare("INSERT INTO resource_instances(id,character_id,template_id,overrides_json,current_state_json) VALUES ('r',?,'t','{}','{\"remaining\":3}')").run(profile.id);
    store.db.prepare("INSERT INTO card_bindings VALUES ('b',?,?,'spirit','r')").run(profile.id, first.id);
    const costs = [{ id: 'future-cost', label: '강화', costs: [{ type: 'fixed', costKey: 'spirit', amount: 2 }] }];
    store.db.prepare("UPDATE card_definitions SET attributes_json=json_set(attributes_json,'$.castOptions',json(?)) WHERE id=?").run(JSON.stringify(costs), first.id);
    saved = library.saveCards({ cards: [{ ...editable(first), name: '변경', roles: ['heal', 'revive'] }] });
    expect(saved.cards[0]).toMatchObject({ id: first.id, name: '변경', createdAt: first.createdAt, castOptions: costs });
    expect(saved.cards[1]).toEqual(other);
    expect(saved.decks[0].cardIds).toEqual([first.id, other.id]);
    expect(store.db.prepare('SELECT resource_instance_id FROM card_bindings').get()).toMatchObject({ resource_instance_id: 'r' });
    expect(store.db.prepare('SELECT current_state_json FROM resource_instances').get()).toMatchObject({ current_state_json: '{"remaining":3}' });
    expect(store.db.prepare('SELECT count(*) AS n FROM play_events').get()).toMatchObject({ n: 0 }); store.close();
  });
  it('changes image references only on the edited card, retaining the old asset', () => {
    const { store, library } = fixture();
    for (const id of ['old', 'new']) library.addAsset({ id, relative_path: `assets/${id}.png`, sha256: 'hash', mime_type: 'image/png', width: 10, height: 20, original_name: `${id}.png` });
    const [first, second] = library.saveCards({ cards: [{ ...draft('첫째'), imageAssetId: 'old' }, { ...draft('둘째'), imageAssetId: 'old' }] }).cards;
    const result = library.saveCards({ cards: [{ ...editable(first), imageAssetId: 'new' }] });
    expect(result.cards[0].id).toBe(first.id); expect(result.cards[0].imageAssetId).toBe('new');
    expect(result.cards[1]).toEqual(second); expect(library.getAsset('old')).toBeDefined(); store.close();
  });
  it('rolls back the entire batch if any asset or tag is invalid', () => {
    const { store, library } = fixture();
    const saved = library.saveCards({ cards: [draft('기존')] });
    expect(() => library.saveCards({ cards: [{ ...editable(saved.cards[0]), name: '부분 변경 금지' }, { ...draft(), tags: ['missing'] }] })).toThrow();
    expect(library.getLibrary().cards).toEqual(saved.cards);
    expect(() => library.saveCards({ cards: [{ ...draft(), imageAssetId: 'unknown' }] })).toThrow();
    expect(() => library.saveCards({ cards: [{ ...draft(), remaining: 4 }] })).toThrow();
    expect(() => library.saveCards({ cards: [{ ...draft(), spellLevel: 3 }] })).toThrow();
    expect(() => library.saveCards({ cards: [{ ...draft(), castOptions: [] }] })).toThrow(); store.close();
  });
  it('changes one card tag assignment without changing the other card', () => {
    const { store, library } = fixture(); library.saveTag({ name: '공통' }); const tag = library.getLibrary().tags[0];
    const [first, second] = library.saveCards({ cards: [{ ...draft('가'), tags: [tag.id] }, { ...draft('나'), tags: [tag.id] }] }).cards;
    const updated = library.saveCards({ cards: [{ ...editable(first), tags: [] }] });
    expect(updated.cards[0].tags).toEqual([]); expect(updated.cards[1]).toEqual(second); store.close();
  });
  it('renames a common tag without changing IDs or metadata; explicitly deleting it also clears its filter', () => {
    const { store, library } = fixture(); library.saveTag({ name: '집중' }); library.saveTag({ name: '별도' });
    const tag = library.getLibrary().tags.find(tag => tag.name === '집중')!;
    const otherTag = library.getLibrary().tags.find(tag => tag.name === '별도')!;
    const first = library.saveCards({ cards: [{ ...draft(), tags: [tag.id, otherTag.id] }] }).cards[0];
    expect(() => library.saveTag({ name: ' 집중 ' })).toThrow('같은 이름');
    library.saveTag({ id: tag.id, name: '집중 유지' }); expect(library.getLibrary().cards[0]).toEqual(first);
    library.saveState({ ...DEFAULT_LIBRARY_STATE, tagIds: [tag.id, otherTag.id] });
    const next = library.deleteTag(tag.id);
    expect(next.cards[0].tags).toEqual([otherTag.id]); expect(next.libraryState.tagIds).toEqual([otherTag.id]);
    expect(next.cards[0].castOptions).toEqual(first.castOptions);
    const row = store.db.prepare('SELECT attributes_json FROM card_definitions WHERE id=?').get(first.id) as { attributes_json: string };
    expect(JSON.parse(row.attributes_json).tags).toEqual([otherTag.id]); store.close();
  });
  it('moves an archived card to trash, preserving metadata and deck snapshots', () => {
    const { store, library } = fixture(); const card = library.saveCards({ cards: [draft()] }).cards[0];
    library.createProfile({ name: '프로필' }); const deck = library.getLibrary().decks[0];
    library.setDeckCards({ deckId: deck.id, cardIds: [card.id] });
    const result = library.archiveCard(card.id);
    expect(result.cards).toEqual([]); expect(result.decks[0].cardIds).toEqual([]);expect(JSON.parse(String(store.db.prepare('SELECT decks_json FROM card_trash WHERE card_id=?').get(card.id)!.decks_json))[0].id).toBe(deck.id);
    const fresh = library.saveCards({ cards: [draft('다른 카드')] }).cards[0];
    expect(()=>library.setDeckCards({ deckId: deck.id, cardIds: [card.id, fresh.id] })).toThrow();expect(library.getLibrary().decks[0].cardIds).toEqual([fresh.id]);
    expect(store.db.prepare('SELECT archived_at FROM card_definitions WHERE id=?').get(card.id)).not.toMatchObject({ archived_at: null });
    expect(() => library.saveCards({ cards: [editable(card)] })).toThrow(); store.close();
  });
  it('keeps shared card definitions and character deck membership independent', () => {
    const { store, library } = fixture(); const cards = library.saveCards({ cards: [draft('가'), draft('나')] }).cards;
    library.createProfile({ name: 'A' }); library.createProfile({ name: 'B' });
    let data = library.getLibrary(); const [a, b] = data.profiles;
    library.setDeckCards({ deckId: a.activeDeckId!, cardIds: [cards[0].id] });
    library.setDeckCards({ deckId: b.activeDeckId!, cardIds: cards.map(card => card.id) });
    expect(() => library.selectDeck({ characterId: a.id, deckId: b.activeDeckId! })).toThrow();
    expect(() => library.setDeckCards({ deckId: a.activeDeckId!, cardIds: [cards[0].id, cards[0].id] })).toThrow();
    data = library.createDeck({ characterId: a.id, name: '새 덱' });
    expect(data.decks.find(deck => deck.id === b.activeDeckId)?.cardIds).toEqual(cards.map(card => card.id));
    expect(data.cards).toEqual(cards); expect(data.libraryState.activeCharacterId).toBe(a.id); store.close();
  });
  it('reports malformed saved cards without dropping their database rows or hiding healthy cards', () => {
    const { store, library } = fixture(); const cards = library.saveCards({ cards: [draft('정상'), draft('손상')] }).cards;
    store.db.prepare("UPDATE card_definitions SET attributes_json='{}' WHERE id=?").run(cards[1].id);
    expect(library.getLibrary().cards).toEqual([cards[0]]); expect(library.getLibrary().warnings).toHaveLength(1);
    expect(store.db.prepare('SELECT count(*) AS n FROM card_definitions').get()).toMatchObject({ n: 2 }); store.close();
  });
  it('rejects malformed filter settings without changing P0 preferences or prior filters', () => {
    const { store, library } = fixture(); library.saveState(DEFAULT_LIBRARY_STATE);
    for (const invalid of [{ ...DEFAULT_LIBRARY_STATE, roles: ['invented'] }, { ...DEFAULT_LIBRARY_STATE, unknown: true }, { ...DEFAULT_LIBRARY_STATE, activeCharacterId: 'missing' }]) expect(() => library.saveState(invalid)).toThrow();
    expect(library.getState()).toEqual(DEFAULT_LIBRARY_STATE); expect(store.getSettings()).toEqual(DEFAULT_SETTINGS); store.close();
  });
});

describe('P0 migration compatibility', () => {
  it('rolls v2 alterations back on migration failure and retains a restorable v1 backup', () => {
    const path = mkdtempSync(join(root, 'v1-failure-')); mkdirSync(join(path, 'data'));
    const dbPath = join(path, 'data', 'app.sqlite3'); const db = new DatabaseSync(dbPath);
    db.exec(migrations[0].sql); db.exec("PRAGMA user_version=1; INSERT INTO schema_migrations VALUES (1,'original'); CREATE TABLE tags(original TEXT)");
    db.prepare("INSERT INTO settings VALUES ('preferences',?)").run(JSON.stringify(DEFAULT_SETTINGS)); db.close();
    expect(() => new AppStore(path)).toThrow();
    const unchanged = new DatabaseSync(dbPath, { readOnly: true });
    expect(unchanged.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 1 });
    expect(unchanged.prepare('PRAGMA table_info(card_definitions)').all().some(row => row.name === 'archived_at')).toBe(false);
    expect(unchanged.prepare("SELECT value_json FROM settings WHERE key='preferences'").get()).toMatchObject({ value_json: JSON.stringify(DEFAULT_SETTINGS) });
    unchanged.close(); expect(readdirSync(join(path, 'backups'))).toHaveLength(1);
  });
  it('backs up v1, preserves preferences, string IDs, tags, costs and image bytes, and migrates once', () => {
    const path = mkdtempSync(join(root, 'v1-')); mkdirSync(join(path, 'data')); mkdirSync(join(path, 'assets'));
    const dbPath = join(path, 'data', 'app.sqlite3'); const db = new DatabaseSync(dbPath);
    db.exec(migrations[0].sql); db.exec('PRAGMA user_version=1');
    db.prepare('INSERT INTO schema_migrations VALUES (1,?)').run('2026-11-16T00:00:00.000Z');
    const settings = { viewMode: 'grid', reducedMotion: true, resourcePanelCollapsed: true };
    db.prepare("INSERT INTO settings VALUES ('preferences',?)").run(JSON.stringify(settings));
    const card = { ...SAMPLE_CARDS[0], id: 'legacy-card', tags: ['user:ritual'] };
    const { id, name, kind, spellLevel, createdAt, updatedAt, imageAssetId: _asset, ...attributes } = card;
    void _asset;
    db.prepare('INSERT INTO card_definitions VALUES (?,?,NULL,?,?,?,?,?)').run(id, name, kind, spellLevel!, JSON.stringify(attributes), createdAt, updatedAt);
    db.close(); const original = Buffer.from('original file bytes'); writeFileSync(join(path, 'assets', 'keep.png'), original);
    const store = new AppStore(path); const library = new LibraryStore(store);
    expect(store.getSettings()).toEqual(settings); expect(library.getLibrary().cards[0]).toEqual(card);
    expect(library.getLibrary().tags[0]).toMatchObject({ id: 'user:ritual', name: 'user:ritual' });
    expect(readFileSync(join(path, 'assets', 'keep.png'))).toEqual(original);
    const backups = readdirSync(join(path, 'backups')); expect(backups).toHaveLength(1);
    const backup = new DatabaseSync(join(path, 'backups', backups[0]), { readOnly: true });
    expect(backup.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 1 });
    expect(backup.prepare('SELECT name FROM card_definitions').get()).toMatchObject({ name: card.name }); backup.close();
    expect(store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); store.close();
    const second = new AppStore(path); expect(readdirSync(join(path, 'backups'))).toHaveLength(1); second.close();
  });
});
