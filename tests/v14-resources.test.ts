import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { AppStore } from '../electron/store';
import { EditStore } from '../electron/edit-store';
import { LibraryStore } from '../electron/library-store';
import { RegistrationStore } from '../electron/registration-store';
import { ResourceStore } from '../electron/resource-store';
import { TrashStore } from '../electron/trash-store';
import { migrations } from '../electron/migrations';
import { cardUsability } from '../src/components/CardResources';
import type { CardDefinition, CardDraft, CastOption, OwnedResource } from '../src/shared/contracts';
import type { ResourceAction, TemplateDraft } from '../src/shared/resources';
import type { TrashAction } from '../src/shared/trash';

const root = resolve('artifacts/v14-resources-unit');
mkdirSync(root, { recursive: true });
const info = { name: '별빛 부적', kind: 'item', roles: [], actions: ['action'], range: { kind: 'self' }, tags: [] } satisfies CardDraft;
const owned = (): OwnedResource => ({
  id: randomUUID(), name: '별빛', unit: '회', maximum: 7, amount: 1,
  recovery: [{ triggers: ['short_rest'], amount: { type: 'fixed', value: 1 } }],
});
const sharedCost: CastOption = { id: 'play', label: '동시 차감', costs: [
  { type: 'fixed', costKey: 'mana', amount: 2, requirement: { key: 'homebrew:mana', kind: 'counter' } },
] };
const counter: TemplateDraft = {
  name: '캐릭터 마나', matchKey: 'homebrew:mana', unit: '점', kind: 'counter', capacity: { type: 'fixed', value: 4 }, recovery: [],
};
const track: TemplateDraft = {
  name: '사용자 슬롯', matchKey: 'homebrew:mana', unit: '슬롯', kind: 'slot_track', slotKind: 'generic',
  slotCapacity: { '3': { type: 'fixed', value: 1 } }, recovery: [],
};

function fixture(path = mkdtempSync(join(root, 'case-'))) {
  const store = new AppStore(path);
  const library = new LibraryStore(store);
  const resources = new ResourceStore(store);
  return { path, store, library, resources, registration: new RegistrationStore(store, library, resources), trash: new TrashStore(store), edit: new EditStore(store) };
}
type Fixture = ReturnType<typeof fixture>;
function profile(f: Fixture, name = 'A') {
  const library = f.library.createProfile({ name });
  const characterId = library.libraryState.activeCharacterId!;
  return { characterId, deckId: library.decks.find(d => d.characterId === characterId)!.id };
}
function change(f: Fixture, characterId: string, action: ResourceAction) {
  return f.resources.change({ requestId: randomUUID(), characterId, expectedRevision: f.resources.snapshot(characterId).revision, action });
}
function use(f: Fixture, characterId: string, card: CardDefinition, optionId = card.castOptions[0].id, override = false) {
  const action = { type: 'use', cardId: card.id, optionId, choices: {} } as const;
  const { quote } = f.resources.preview({ characterId, action });
  return change(f, characterId, { ...action, quote, override });
}
function trash(f: Fixture, action: TrashAction) {
  return f.trash.change({ requestId: randomUUID(), confirmed: true, action, quote: f.trash.preview(action).quote });
}
function state(f: Fixture, characterId: string, definitionId: string) {
  return f.resources.snapshot(characterId).resources.find(r => r.ownedDefinitionId === definitionId);
}

describe('v1.4 P3 resource lifecycle', () => {
  it('creates on first deck membership, preserves 2/7 across decks and restart, recovers while inactive, then clamps without invalidating Undo', () => {
    let f = fixture();
    try {
      const a = profile(f);
      const definition = owned();
      const c = f.library.saveCards({ cards: [{ ...info, ownedResources: [definition] }], addToDeck: false }).cards[0];
      expect(state(f, a.characterId, definition.id)).toBeUndefined();
      const put = (deckId: string, cardIds = [c.id]) => f.library.setDeckCards({ deckId, cardIds });
      put(a.deckId);
      const instance = state(f, a.characterId, definition.id)!;
      expect(instance).toMatchObject({ remaining: 7, inactive: false });
      for (let i = 0; i < 5; i++) use(f, a.characterId, c);
      put(a.deckId, []);
      expect(state(f, a.characterId, definition.id)).toMatchObject({ id: instance.id, remaining: 2, inactive: true });
      expect(cardUsability(c, f.resources.snapshot(a.characterId))).toBe('missing');
      put(a.deckId);
      expect(state(f, a.characterId, definition.id)).toMatchObject({ id: instance.id, remaining: 2, inactive: false });
      const otherDeck = f.library.createDeck({ characterId: a.characterId, name: '다른 덱' }).decks.find(d => d.id !== a.deckId)!.id;
      expect(state(f, a.characterId, definition.id)!.inactive).toBe(true);
      change(f, a.characterId, { type: 'recover', trigger: 'short_rest' });
      expect(state(f, a.characterId, definition.id)!.remaining).toBe(3);
      put(otherDeck);
      put(otherDeck);
      expect(state(f, a.characterId, definition.id)).toMatchObject({ id: instance.id, remaining: 3, inactive: false });
      expect(f.resources.snapshot(a.characterId).resources).toHaveLength(1);
      const b = profile(f, 'B');
      put(b.deckId);
      expect(state(f, b.characterId, definition.id)).toMatchObject({ remaining: 7, inactive: false });
      expect(state(f, b.characterId, definition.id)!.id).not.toBe(instance.id);
      f.store.close();
      f = fixture(f.path);
      expect(state(f, a.characterId, definition.id)).toMatchObject({ id: instance.id, remaining: 3 });
      use(f, a.characterId, c);
      const updated = f.library.saveCards({ cards: [{ ...info, id: c.id, ownedResources: [{ ...definition, maximum: 1 }] }] }).cards[0];
      expect(state(f, a.characterId, definition.id)).toMatchObject({ remaining: 1, capacity: 1 });
      expect(state(f, b.characterId, definition.id)).toMatchObject({ remaining: 1, capacity: 1 });
      change(f, a.characterId, { type: 'undo' });
      f.library.saveCards({ cards: [{ ...info, id: updated.id, ownedResources: [{ ...definition, maximum: 10 }] }] });
      expect(state(f, a.characterId, definition.id)).toMatchObject({ id: instance.id, remaining: 1, capacity: 10 });
      expect(f.store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { f.store.close(); }
  });

  it('preserves managed state through bulk membership restore, trash restore and permanent deletion', () => {
    const f = fixture();
    try {
      const a = profile(f);
      const definition = owned();
      const c = f.library.saveCards({ cards: [{ ...info, ownedResources: [definition] }], addToDeck: false }).cards[0];
      const action = { type: 'deck_cards', deckId: a.deckId, operation: 'add', cardIds: [c.id] } as const;
      const preview = f.edit.preview(action);
      expect(state(f, a.characterId, definition.id)).toBeUndefined();
      const saved = f.edit.apply({ requestId: randomUUID(), action, quote: preview.quote, confirmImpact: true });
      const instance = state(f, a.characterId, definition.id)!;
      use(f, a.characterId, c);
      const restore = { type: 'restore', batchId: saved.batchId } as const;
      f.edit.apply({ requestId: randomUUID(), action: restore, quote: f.edit.preview(restore).quote, confirmImpact: true });
      expect(state(f, a.characterId, definition.id)).toMatchObject({ id: instance.id, remaining: 6, inactive: true });
      f.library.setDeckCards({ deckId: a.deckId, cardIds: [c.id] });
      trash(f, { type: 'move', cardIds: [c.id] });
      expect(state(f, a.characterId, definition.id)).toMatchObject({ remaining: 6, inactive: true, retired: false });
      trash(f, { type: 'restore', cardIds: [c.id] });
      expect(state(f, a.characterId, definition.id)).toMatchObject({ id: instance.id, remaining: 6, inactive: false });
      trash(f, { type: 'move', cardIds: [c.id] });
      trash(f, { type: 'purge', cardIds: [c.id] });
      expect(state(f, a.characterId, definition.id)).toMatchObject({ remaining: 6, inactive: true, retired: true });
      change(f, a.characterId, { type: 'recover', trigger: 'short_rest' });
      expect(state(f, a.characterId, definition.id)!.remaining).toBe(6);
      expect(f.resources.snapshot(a.characterId).events.find(e => e.cardId === c.id)).toMatchObject({ costSnapshot: { name: c.name } });
      expect(f.store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { f.store.close(); }
  });

  it('registers external requirements without a character and applies exact matches, mixed spending, explicit override, and Undo', () => {
    const f = fixture();
    try {
      const definition = owned();
      const request = { cards: [{ ...info, ownedResources: [definition] }], initialRules: {
        configured: true, requestId: randomUUID(), scope: 'shared', castOptions: [sharedCost], bindings: [],
      } };
      const c = f.registration.save(request).cards[0];
      expect(f.registration.save(request).cards).toHaveLength(1);
      const a = profile(f);
      f.library.setDeckCards({ deckId: a.deckId, cardIds: [c.id] });
      expect(cardUsability(c, f.resources.snapshot(a.characterId))).toBe('missing');
      expect(() => use(f, a.characterId, c)).toThrow('보유하지 않았습니다');
      change(f, a.characterId, { type: 'create_resource', template: track, scope: 'character' });
      expect(() => use(f, a.characterId, c)).toThrow('종류');
      change(f, a.characterId, { type: 'create_resource', template: counter, scope: 'character' });
      const mana = f.resources.snapshot(a.characterId).resources.find(r => r.name === counter.name)!;
      use(f, a.characterId, c);
      use(f, a.characterId, c);
      expect(cardUsability(c, f.resources.snapshot(a.characterId))).toBe('insufficient');
      const before = f.resources.snapshot(a.characterId).resources;
      expect(() => use(f, a.characterId, c)).toThrow('부족');
      expect(f.resources.snapshot(a.characterId).resources).toEqual(before);
      use(f, a.characterId, c, undefined, true);
      expect(f.resources.snapshot(a.characterId).resources).toEqual(before);
      change(f, a.characterId, { type: 'undo' });
      expect(state(f, a.characterId, definition.id)!.remaining).toBe(6);
      expect(f.resources.snapshot(a.characterId).resources.find(r => r.id === mana.id)!.remaining).toBe(2);
      change(f, a.characterId, { type: 'attach', templateId: mana.templateId, scope: 'character' });
      expect(() => use(f, a.characterId, c)).toThrow('여러 개');
      change(f, a.characterId, { type: 'save_costs', cardId: c.id, scope: 'character', castOptions: [sharedCost], bindings: [
        { costKey: 'mana', resourceInstanceId: mana.id },
      ] });
      use(f, a.characterId, c);
      change(f, a.characterId, { type: 'delete_resource', resourceId: mana.id });
      expect(() => use(f, a.characterId, c)).toThrow('삭제');
    } finally { f.store.close(); }
  });

  it('distinguishes unavailable, exhausted and acquired V-tier resources', () => {
    const f = fixture();
    try {
      const a = profile(f);
      const options: CastOption[] = [{ id: 'v', label: 'V 주문', costs: [
        { type: 'slot', costKey: 'v', slotSelection: 'standard', autoBind: true },
      ] }];
      const wizard = (level: number) => {
        const configuration = { classId: 'wizard' as const, level };
        const { quote } = f.resources.previewClass({ characterId: a.characterId, configuration });
        change(f, a.characterId, { type: 'configure_class', configuration, quote });
      };
      wizard(5);
      const c = f.registration.save({ cards: [{ ...info, kind: 'spell', spellLevel: 5 }], initialRules: {
        configured: true, requestId: randomUUID(), scope: 'shared', characterId: a.characterId,
        expectedRevision: f.resources.snapshot(a.characterId).revision, castOptions: options, bindings: [],
      } }).cards[0];
      expect(cardUsability(c, f.resources.snapshot(a.characterId))).toBe('level');
      expect(() => use(f, a.characterId, c)).toThrow('레벨');
      wizard(9);
      expect(cardUsability(c, f.resources.snapshot(a.characterId))).toBe('usable');
      use(f, a.characterId, c);
      expect(cardUsability(c, f.resources.snapshot(a.characterId))).toBe('insufficient');
      expect(f.library.getLibrary().cards[0].castOptions).toEqual(options);
    } finally { f.store.close(); }
  });

  it('keeps generic tracks separate from standard and pact tracks at the same key', () => {
    const f = fixture();
    try {
      const a = profile(f);
      const option: CastOption = { id: 'v', label: '별자리 V', costs: [
        { type: 'fixed', costKey: 'v', amount: 1, slotLevel: 5, requirement: { kind: 'track', key: 'homebrew:mana' } },
      ] };
      const c = f.registration.save({ cards: [info], initialRules: {
        configured: true, requestId: randomUUID(), scope: 'shared', characterId: a.characterId,
        expectedRevision: f.resources.snapshot(a.characterId).revision, castOptions: [option], bindings: [],
      } }).cards[0];
      const create = (template: TemplateDraft) => change(f, a.characterId, { type: 'create_resource', template, scope: 'character' });
      const tier = { '5': { type: 'fixed' as const, value: 1 } };
      create({ ...track, name: '동일 키 일반 슬롯', slotKind: 'standard', slotCapacity: tier });
      expect(() => use(f, a.characterId, c)).toThrow('종류');
      create(track);
      expect(cardUsability(c, f.resources.snapshot(a.characterId))).toBe('level');
      const old = f.resources.snapshot(a.characterId).resources.find(r => r.name === track.name)!;
      change(f, a.characterId, { type: 'delete_resource', resourceId: old.id });
      create({ ...track, slotCapacity: tier });
      use(f, a.characterId, c);
      expect(f.resources.snapshot(a.characterId).resources.map(r => r.remainingByLevel)).toEqual([{ '5': 1 }, { '5': 0 }]);
    } finally { f.store.close(); }
  });

  it('migrates a v7 database with a backup and leaves existing rows intact', () => {
    const path = mkdtempSync(join(root, 'v7-'));
    mkdirSync(join(path, 'data'));
    const db = new DatabaseSync(join(path, 'data', 'app.sqlite3'));
    for (const migration of migrations.filter(m => m.version <= 7)) {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(migration.version, 'old');
    }
    db.exec("PRAGMA user_version=7; INSERT INTO character_profiles(id,name,ruleset,level) VALUES ('old','기존','homebrew',5)");
    const before = db.prepare('SELECT * FROM character_profiles').all();
    db.close();
    const f = fixture(path);
    try {
      expect(f.store.db.prepare('SELECT * FROM character_profiles').all()).toEqual(before);
      expect(f.store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(12);
      expect(readdirSync(join(path, 'backups'))).toEqual([expect.stringMatching(/^before-v7-to-v12-/)]);
    } finally { f.store.close(); }
  });
});
