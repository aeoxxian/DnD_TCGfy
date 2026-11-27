import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { AssetService } from '../electron/assets';
import { BackupService, applyPendingRestore } from '../electron/backup';
import { DeckExchange, parseDeckDocument, readDeckDocument } from '../electron/deck-exchange';
import { LibraryStore } from '../electron/library-store';
import { migrations } from '../electron/migrations';
import { ResourceStore } from '../electron/resource-store';
import { AppStore } from '../electron/store';
import { planUse } from '../src/shared/resource-engine';
import type { CastOption } from '../src/shared/contracts';
import type { ResourceAction } from '../src/shared/resources';
import { MAX_DECK_BYTES } from '../src/shared/deck-exchange';
import { effectiveCard } from '../src/shared/casting';

const root = resolve('artifacts/deck-exchange-unit');
mkdirSync(root, { recursive: true });
const fixture = (path = mkdtempSync(join(root, 'case-'))) => {
  const store = new AppStore(path);
  const library = new LibraryStore(store);
  const resources = new ResourceStore(store);
  const exchange = new DeckExchange(library, resources, new AssetService(path, library));
  return { path, store, library, resources, exchange };
};
type Fixture = ReturnType<typeof fixture>;
const newProfile = (f: Fixture, name: string) => {
  const { profiles, libraryState } = f.library.createProfile({ name });
  return profiles.find(profile => profile.id === libraryState.activeCharacterId)!;
};
const change = (f: Fixture, characterId: string, action: ResourceAction) => f.resources.change({
  requestId: randomUUID(), characterId, expectedRevision: f.resources.snapshot(characterId).revision, action,
});
const definition = {
  id: '04d673e9-c25f-43a1-80cd-a699a5026a22', name: '고유 빛', maximum: 7, amount: 2, unit: '회',
  recovery: [{ triggers: ['dawn' as const], amount: { type: 'full' as const } }],
};
const info = { kind: 'spell' as const, spellLevel: 2, roles: ['buff' as const], actions: ['bonus_action' as const], range: { kind: 'ranged' as const, feet: 60 } };
const shared: CastOption[] = [{
  id: 'normal-local', label: '상위 슬롯 사용', casting: { mode: 'standard', allowUpcast: true, allowBelowBase: false, minSlotLevel: 2, maxSlotLevel: 4 },
  costs: [
    { type: 'slot', costKey: 'slot-local', slotSelection: 'standard', autoBind: true },
    { type: 'variable', costKey: 'variable-local', min: 1, max: 5, step: 2, requirement: { key: 'external:never-held', kind: 'counter' } },
  ],
}, { id: 'ritual-local', label: '의식', ritual: true, costs: [] }];
const privateRules: CastOption[] = [{
  id: 'override-local', label: '직접 연결 두 개', costs: [
    { type: 'fixed', costKey: 'fixed-portable', amount: 2, slotLevel: 2 },
    { type: 'fixed', costKey: 'fixed-private', amount: 1 },
  ],
}, { id: 'owned-only-local', label: '고유 빛만', costs: [] }];

function seed(f: Fixture) {
  const profile = newProfile(f, '보내는 캐릭터');
  const { id, activeDeckId: deckId } = profile;
  f.store.db.prepare('UPDATE decks SET name=? WHERE id=?').run('교환 덱', deckId!);
  const tags = f.library.saveTag({ name: '빛' }).tags.map(tag => tag.id);
  const image = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex');
  const imageHash = createHash('sha256').update(image).digest('hex');
  writeFileSync(join(f.path, 'assets', 'managed.png'), image);
  f.store.db.prepare('INSERT INTO assets(id,relative_path,sha256,mime_type,width,height) VALUES (?,?,?,?,?,?)')
    .run('source-image', 'assets/managed.png', imageHash, 'image/png', 1, 1);
  f.library.saveCards({ cards: [
    { ...info, name: '별빛 주문', description: '긴 설명\n원본을 보존', tags, imageMode: 'illustration', imageAssetId: 'source-image', concentration: true, ritual: true, upcastEffect: true, ownedResources: [definition] },
    { ...info, name: '이미지 없는 주문', tags: [], imageMode: 'none', concentration: false },
  ] });
  const c = f.library.getLibrary().cards[0];
  change(f, id, { type: 'save_costs', scope: 'shared', cardId: c.id, castOptions: shared, bindings: [] });
  change(f, id, { type: 'create_resource', scope: 'character', template: {
    kind: 'slot_track', slotKind: 'standard', name: '이식 슬롯', matchKey: 'pool:standard', unit: '슬롯', recovery: [], slotCapacity: { '2': { type: 'fixed', value: 3 } },
  } });
  change(f, id, { type: 'create_resource', scope: 'character', template: {
    kind: 'counter', name: '로컬 전용', unit: '회', recovery: [], capacity: { type: 'fixed', value: 5 },
  } });
  const pools = f.resources.snapshot(id).resources;
  const manual = [pools.find(resource => resource.name === '이식 슬롯')!, pools.find(resource => resource.name === '로컬 전용')!];
  change(f, id, { type: 'save_costs', scope: 'character', cardId: c.id, castOptions: privateRules, bindings: [
    { costKey: 'fixed-portable', resourceInstanceId: manual[0].id }, { costKey: 'fixed-private', resourceInstanceId: manual[1].id },
  ] });
  const action = { type: 'use' as const, cardId: c.id, optionId: 'owned-only-local', choices: {} };
  change(f, id, { ...action, quote: f.resources.preview({ characterId: id, action }).quote });
  const order = [...f.library.getLibrary().decks[0].cardIds].reverse();
  f.library.setDeckCards({ deckId, cardIds: order });
  return { id, deckId: deckId!, tags, c, manual, image, imageHash };
}

describe('v1.4 P4 deck JSON', () => {
  it('round-trips advanced definitions, absent requirements and portable overrides in a fresh DB, strips state, and preserves spent state on repeat', async () => {
    const source = fixture(); let target = fixture();
    try {
      const s = seed(source);
      const json = join(source.path, 'deck.json');
      await source.exchange.export(s.deckId, json);
      const bytes = readFileSync(json, 'utf8');
      for (const privateValue of [s.id, s.deckId, s.c.id, 'source-image', ...s.tags, definition.id, ...s.manual.map(resource => resource.id),
        'owned-only-local', 'fixed-private', 'remaining', 'play_events', 'undoTargetId', 'resourceInstanceId', 'assets/managed.png']) {
        expect(bytes).not.toContain(privateValue);
      }
      const portable = await readDeckDocument(json);
      expect(portable.cards.map(card => card.name)).toEqual(['이미지 없는 주문', '별빛 주문']);
      expect(portable.cards[1]).toMatchObject({ concentration: true, ritual: true, upcastEffect: true, ownedResources: [expect.objectContaining({ maximum: 7, amount: 2, recovery: definition.recovery })], image: { sha256: s.imageHash } });
      const character = newProfile(target, '받는 캐릭터');
      const originalLibrary = target.library.getLibrary();
      const preview = await target.exchange.inspect(character.id, json);
      expect(preview.notices).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'image' }), expect.objectContaining({ kind: 'reconnect' })]));
      expect(target.library.getLibrary()).toEqual(originalLibrary);
      const added = await target.exchange.apply({ token: preview.token, characterId: character.id });
      expect(added.replayed).toBe(false);
      const deck = added.library.decks.find(item => item.id === added.deckId)!;
      const card = added.library.cards.find(item => item.id === deck.cardIds[1])!;
      expect(card).toMatchObject({ imageReference: { sha256: s.imageHash }, imageMode: 'illustration', concentration: true, description: s.c.description });
      expect(card.imageAssetId).toBeUndefined();
      const snapshot = target.resources.snapshot(character.id);
      expect(snapshot.events).toEqual([]);
      expect(snapshot.bindings).toEqual([]);
      expect(snapshot.resources[0]).toMatchObject({ remaining: 7, inactive: true });
      const effective = effectiveCard(card, snapshot);
      expect(effective.castOptions[0].costs).toMatchObject([
        { type: 'fixed', slotLevel: 2, amount: 2, requirement: { kind: 'track', slotKind: 'standard', key: 'pool:standard' } },
        { type: 'fixed', reconnect: 'counter', amount: 1 },
      ]);
      target.library.selectDeck({ characterId: character.id, deckId: deck.id });
      const action = { type: 'use' as const, cardId: card.id, optionId: effective.castOptions[1].id, choices: {} };
      change(target, character.id, { ...action, quote: target.resources.preview({ characterId: character.id, action }).quote });
      const spent = target.resources.snapshot(character.id);
      expect(spent.resources[0].remaining).toBe(5);
      expect(() => planUse(effective, effective.castOptions[0].id, spent.resources, [], {})).toThrow('pool:standard');
      const roundTrip = join(target.path, 'round-trip.json');
      await target.exchange.export(added.deckId, roundTrip);
      expect(await readDeckDocument(roundTrip)).toEqual(portable);
      target.library.saveCards({ cards: [{
        ...info, id: card.id, name: card.name, tags: card.tags, imageMode: 'illustration', description: '이미지 없이 정보를 수정',
      }] });
      expect(target.library.getLibrary().cards.find(item => item.id === card.id)).toMatchObject({
        imageReference: { sha256: s.imageHash }, imageMode: 'illustration', description: '이미지 없이 정보를 수정',
      });
      const path = target.path;
      target.store.close();
      target = fixture(path);
      const repeat = await target.exchange.inspect(character.id, json);
      expect(repeat.existing).toBe(true);
      expect(await target.exchange.apply({ token: repeat.token, characterId: character.id })).toMatchObject({ replayed: true, deckId: added.deckId });
      expect(target.resources.snapshot(character.id)).toEqual(spent);
      change(target, character.id, { type: 'create_resource', scope: 'character', template: {
        kind: 'slot_track', slotKind: 'standard', name: '받는 슬롯', matchKey: 'pool:standard', unit: '슬롯', recovery: [], slotCapacity: { '2': { type: 'fixed', value: 3 } },
      } });
      change(target, character.id, { type: 'create_resource', scope: 'character', template: {
        kind: 'counter', name: '로컬 전용', unit: '회', recovery: [], capacity: { type: 'fixed', value: 5 },
      } });
      const unlinked = target.resources.snapshot(character.id);
      expect(() => planUse(effective, effective.castOptions[0].id, unlinked.resources, [], {})).toThrow('직접 연결');
      const local = unlinked.resources.find(resource => resource.name === '로컬 전용')!;
      change(target, character.id, { type: 'save_costs', scope: 'character', cardId: card.id, castOptions: effective.castOptions, bindings: [
        { costKey: effective.castOptions[0].costs[1].costKey, resourceInstanceId: local.id },
      ] });
      const use = { type: 'use' as const, cardId: card.id, optionId: effective.castOptions[0].id, choices: {} };
      const quote = target.resources.preview({ characterId: character.id, action: use });
      expect(quote.changes.map(item => [item.before, item.after])).toEqual([[3, 1], [5, 4], [5, 3]]);
      change(target, character.id, { ...use, quote: quote.quote });
      expect(target.store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { source.store.close(); target.store.close(); }
  });

  it('reuses only a matching managed image and creates collision-safe cards and a new deck without modifying a same-name deck', async () => {
    const f = fixture();
    try {
      const s = seed(f);
      const json = join(f.path, 'deck.json');
      await f.exchange.export(s.deckId, json);
      f.store.db.prepare("INSERT INTO card_definitions (id,name,kind,attributes_json,created_at,updated_at) SELECT 'card1','기존 충돌 카드',kind,attributes_json,created_at,updated_at FROM card_definitions WHERE id=?").run(s.c.id);
      const previous = f.library.getLibrary().decks[0];
      const preview = await f.exchange.inspect(s.id, json);
      expect(preview).toMatchObject({ name: '교환 덱 (2)', renamed: true, duplicateCardNames: 2, existing: false });
      expect(preview.notices.map(notice => notice.kind)).not.toContain('image');
      const result = await f.exchange.apply({ token: preview.token, characterId: s.id });
      expect(result.library.decks[0]).toEqual(previous);
      expect(result.library.cards.find(card => card.id === 'card1')?.name).toBe('기존 충돌 카드');
      const copyId = result.library.decks.find(deck => deck.id === result.deckId)!.cardIds[1];
      expect(copyId).not.toBe(s.c.id);
      expect(result.library.cards.find(card => card.id === copyId)).toMatchObject({ tags: s.tags, imageAssetId: 'source-image', imageMode: 'illustration' });
      expect(readFileSync(join(f.path, 'assets', 'managed.png'))).toEqual(s.image);
      expect(f.resources.snapshot(s.id).resources.find(resource => resource.overrides.ownerCardId === s.c.id)?.remaining).toBe(5);
      const ownCopy = f.resources.snapshot(s.id).resources.find(resource => resource.overrides.ownerCardId === copyId);
      expect(ownCopy?.remaining).toBe(7);
    } finally { f.store.close(); }
  });

  it('rejects unexpected paths, bad references, duplicate aliases and unsupported versions before writing; rolls back a late insert failure', async () => {
    const source = fixture(); const dest = fixture();
    try {
      const s = seed(source);
      const json = join(source.path, 'deck.json');
      await source.exchange.export(s.deckId, json);
      const portable = await readDeckDocument(json);
      const profile = newProfile(dest, '대상');
      const cases: [string, unknown][] = [
        ['version', { ...portable, schemaVersion: 90 }],
        ['path', { ...portable, cards: [{ ...portable.cards[1], image: { ...portable.cards[1].image, path: 'C:/outside.png' } }] }],
        ['reference', { ...portable, cards: [{ ...portable.cards[0], tags: ['unknown'] }] }],
        ['duplicate', { ...portable, cards: [portable.cards[1], portable.cards[1]] }],
        ['live state', { ...portable, cards: [{ ...portable.cards[1], remaining: 2 }] }],
      ];
      const previous = dest.library.getLibrary();
      for (const [name, value] of cases) {
        const file = join(dest.path, `${name}.json`);
        writeFileSync(file, JSON.stringify(value));
        await expect(dest.exchange.inspect(profile.id, file)).rejects.toThrow();
        expect(dest.library.getLibrary()).toEqual(previous);
      }
      const huge = join(dest.path, 'huge.json');
      writeFileSync(huge, Buffer.alloc(MAX_DECK_BYTES + 1));
      await expect(dest.exchange.inspect(profile.id, huge)).rejects.toThrow('16 MiB');
      expect(() => parseDeckDocument({ ...portable, cards: [{ ...portable.cards[1], ref: '../../path' }] })).toThrow();
      const preview = await dest.exchange.inspect(profile.id, json);
      dest.store.db.exec("CREATE TRIGGER unit_reject_late BEFORE INSERT ON deck_exchange_imports BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
      await expect(dest.exchange.apply({ token: preview.token, characterId: profile.id })).rejects.toThrow('fixture failure');
      expect(dest.library.getLibrary()).toEqual(previous);
      expect(dest.resources.snapshot(profile.id).resources).toEqual([]);
      expect(dest.store.db.prepare('SELECT count(*) AS n FROM card_owned_resources').get()).toMatchObject({ n: 0 });
      expect(dest.store.db.prepare('SELECT count(*) AS n FROM character_cost_overrides').get()).toMatchObject({ n: 0 });
      expect(dest.store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { source.store.close(); dest.store.close(); }
  });

  it('preserves the v8 database, and full ZIP restore keeps import receipts and live stored resources', async () => {
    const path = mkdtempSync(join(root, 'v8-'));
    mkdirSync(join(path, 'data'));
    const old = new DatabaseSync(join(path, 'data', 'app.sqlite3'));
    for (const migration of migrations.filter(m => m.version <= 8)) {
      old.exec(migration.sql);
      old.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(migration.version, 'before');
    }
    old.exec("PRAGMA user_version=8; INSERT INTO character_profiles(id,name,ruleset,level) VALUES ('old','기존 캐릭터','homebrew',5)");
    old.close();
    const f = fixture(path); const other = fixture();
    try {
      expect(f.library.getLibrary().profiles[0]).toMatchObject({ id: 'old', level: 5 });
      const migrationBackup = readdirSync(join(path, 'backups'));
      expect(migrationBackup).toEqual([expect.stringMatching(/^before-v8-to-v9-/)]);
      const backupDb = new DatabaseSync(join(path, 'backups', migrationBackup[0]), { readOnly: true });
      expect(backupDb.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 8 });
      backupDb.close();
      const s = seed(f);
      const json = join(path, 'deck.json');
      await f.exchange.export(s.deckId, json);
      const portrait = await f.exchange.inspect('old', json);
      await f.exchange.apply({ token: portrait.token, characterId: 'old' });
      const before = f.resources.snapshot('old');
      const zip = join(path, 'all.zip');
      await new BackupService(f.store, '1.3.0').exportTo(zip);
      const backup = new BackupService(other.store, '1.3.0');
      await backup.scheduleReplace((await backup.inspect(zip)).token);
      other.store.close();
      expect(applyPendingRestore(other.path).notice).toContain('복원했습니다');
      const restored = fixture(other.path);
      try {
        expect(restored.resources.snapshot('old')).toEqual(before);
        expect((await restored.exchange.inspect('old', json)).existing).toBe(true);
      } finally { restored.store.close(); }
    } finally { f.store.close(); if (other.store.db.isOpen) other.store.close(); }
  });
});
