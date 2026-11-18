import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { AppStore } from '../electron/store';
import { DEFAULT_SETTINGS } from '../src/shared/contracts';
import { migrate, SCHEMA_VERSION, transaction } from '../electron/migrations';

const root = resolve('artifacts/unit-data');
mkdirSync(root, { recursive: true });
function fixture() { return mkdtempSync(join(root, 'store-')); }

describe('SQLite persistence and compatibility', () => {
  it('initializes separate domain tables, FK, WAL and version exactly once', () => {
    const path = fixture();
    const first = new AppStore(path);
    expect(first.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(first.db.prepare('PRAGMA foreign_keys').get()).toMatchObject({ foreign_keys: 1 });
    expect(first.db.prepare('PRAGMA journal_mode').get()).toMatchObject({ journal_mode: 'wal' });
    expect(first.db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: SCHEMA_VERSION });
    for (const table of ['card_definitions', 'character_profiles', 'resource_templates', 'resource_instances', 'decks', 'deck_cards', 'card_bindings', 'play_events', 'assets', 'settings']) {
      expect(first.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toMatchObject({ n: 0 });
    }
    const migration = first.db.prepare('SELECT * FROM schema_migrations').all();
    first.close();
    const second = new AppStore(path);
    expect(second.db.prepare('SELECT * FROM schema_migrations').all()).toEqual(migration);
    expect(second.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    second.close();
    expect(readdirSync(join(path, 'backups'))).toEqual([]);
  });
  it('persists Korean preferences over multiple restarts without changing domain data', () => {
    const path = fixture();
    const first = new AppStore(path);
    first.db.prepare("INSERT INTO character_profiles(id,name,ruleset,level) VALUES (?,?,?,?)").run('stable-id', '한글 캐릭터', 'homebrew', 1);
    const settings = { viewMode: 'grid' as const, reducedMotion: true, resourcePanelCollapsed: true };
    first.saveSettings(settings);
    first.close();
    const second = new AppStore(path);
    expect(second.getSettings()).toEqual(settings);
    expect(second.db.prepare('SELECT id,name FROM character_profiles').get()).toMatchObject({ id: 'stable-id', name: '한글 캐릭터' });
    second.close();
  });
  it('v1.1: keeps recent-action display marks in their own settings key without touching play events or preferences', () => {
    const path = fixture();
    const first = new AppStore(path);
    const mark = { clearedEventId: 'event-1', clearedAt: '2026-11-18T10:00:00.000Z' };
    const events = first.db.prepare('SELECT COUNT(*) AS n FROM play_events').get();
    first.saveSettings({ ...DEFAULT_SETTINGS, historyViews: { 'character-1': mark } });
    const raw = (key: string, store = first) => JSON.parse((store.db.prepare('SELECT value_json FROM settings WHERE key=?').get(key) as { value_json: string }).value_json);
    expect(raw('preferences')).toEqual(DEFAULT_SETTINGS);
    expect(raw('history_view')).toEqual({ 'character-1': mark });
    expect(first.db.prepare('SELECT COUNT(*) AS n FROM play_events').get()).toEqual(events);
    first.saveSettings(DEFAULT_SETTINGS);
    first.close();
    const second = new AppStore(path);
    expect(second.getSettings().historyViews).toEqual({ 'character-1': mark });
    for (const bad of [{ c: { clearedEventId: '', clearedAt: mark.clearedAt } }, { c: { clearedEventId: 'e', clearedAt: 'yesterday' } }, { c: { ...mark, extra: 1 } }])
      expect(() => second.saveSettings({ ...DEFAULT_SETTINGS, historyViews: bad })).toThrow();
    expect(raw('history_view', second)).toEqual({ 'character-1': mark });
    second.saveSettings({ ...DEFAULT_SETTINGS, historyViews: {} });
    expect(second.getSettings().historyViews).toEqual({});
    second.close();
  });
  it('v1.1: keeps the enlarged-card tilt option in its own effects key, readable after restart', () => {
    const path = fixture();
    const first = new AppStore(path);
    first.saveSettings({ ...DEFAULT_SETTINGS, reducedMotion: true, effects: { cardTilt: false } });
    const raw = (key: string, store = first) => JSON.parse((store.db.prepare('SELECT value_json FROM settings WHERE key=?').get(key) as { value_json: string }).value_json);
    expect(raw('preferences')).toEqual({ ...DEFAULT_SETTINGS, reducedMotion: true });
    expect(raw('effects')).toEqual({ cardTilt: false });
    first.close();
    const second = new AppStore(path);
    expect(second.getSettings().effects).toEqual({ cardTilt: false });
    for (const bad of [{ cardTilt: 'yes' }, { cardTilt: true, extra: 1 }, { systemCursor: 1 }]) expect(() => second.saveSettings({ ...DEFAULT_SETTINGS, effects: bad })).toThrow();
    second.saveSettings({ ...DEFAULT_SETTINGS, effects: { cardTilt: false, systemCursor: true } });
    expect(raw('effects', second)).toEqual({ cardTilt: false, systemCursor: true });
    second.saveSettings({ ...DEFAULT_SETTINGS, effects: { cardTilt: false } });
    expect(raw('effects', second)).toEqual({ cardTilt: false });
    second.close();
  });
  it('v1.1: keeps spell slot colours per character in their own slot_colors key', () => {
    const path = fixture();
    const first = new AppStore(path);
    const colors = { 'char-a': { pact: { base: '#a3283a', levels: { '5': '#2f7d4f' } } }, 'char-b': { standard: { base: '#7547a3' } } };
    first.saveSettings({ ...DEFAULT_SETTINGS, slotColors: colors });
    const raw = (key: string, store = first) => JSON.parse((store.db.prepare('SELECT value_json FROM settings WHERE key=?').get(key) as { value_json: string }).value_json);
    expect(raw('preferences')).toEqual(DEFAULT_SETTINGS);
    expect(raw('slot_colors')).toEqual(colors);
    first.close();
    const second = new AppStore(path);
    expect(second.getSettings().slotColors).toEqual(colors);
    for (const bad of [{ a: { pact: { base: 'red' } } }, { a: { pact: { base: '#A3283A' } } }, { a: { pact: { levels: { '10': '#a3283a' } } } }, { a: { arcane: { base: '#a3283a' } } }])
      expect(() => second.saveSettings({ ...DEFAULT_SETTINGS, slotColors: bad })).toThrow();
    expect(raw('slot_colors', second)).toEqual(colors);
    second.close();
  });
  it('v1.2: keeps hand momentum in its own hand_scroll key so 1.1.0 can still read effects', () => {
    const path = fixture();
    const first = new AppStore(path);
    first.saveSettings({ ...DEFAULT_SETTINGS, effects: { cardTilt: true, systemCursor: true }, handScroll: { inertia: false } });
    const raw = (key: string, store = first) => JSON.parse((store.db.prepare('SELECT value_json FROM settings WHERE key=?').get(key) as { value_json: string }).value_json);
    expect(raw('hand_scroll')).toEqual({ inertia: false });
    // The v1.1 keys keep exactly the fields 1.1.0 validates (effects is a strict object there).
    expect(raw('effects')).toEqual({ cardTilt: true, systemCursor: true });
    expect(raw('preferences')).toEqual(DEFAULT_SETTINGS);
    first.close();
    const second = new AppStore(path);
    expect(second.getSettings().handScroll).toEqual({ inertia: false });
    for (const bad of [{ inertia: 'no' }, { inertia: true, speed: 2 }]) expect(() => second.saveSettings({ ...DEFAULT_SETTINGS, handScroll: bad })).toThrow();
    expect(raw('hand_scroll', second)).toEqual({ inertia: false });
    // Saving without the field (an older renderer) leaves the stored choice alone.
    second.saveSettings({ ...DEFAULT_SETTINGS });
    expect(second.getSettings().handScroll).toEqual({ inertia: false });
    second.close();
  });
  it('rejects invalid inputs and preserves last saved settings', () => {
    const store = new AppStore(fixture());
    store.saveSettings(DEFAULT_SETTINGS);
    for (const value of [undefined, null, {}, { ...DEFAULT_SETTINGS, viewMode: 'fan' }, { ...DEFAULT_SETTINGS, reducedMotion: 1 }, { ...DEFAULT_SETTINGS, path: '../../file' }]) {
      expect(() => store.saveSettings(value)).toThrow();
      expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
    }
    store.close();
  });
  it('reports invalid persisted settings without silently resetting them', () => {
    const store = new AppStore(fixture());
    store.db.exec("INSERT INTO settings VALUES ('preferences', '{\"viewMode\":\"future\"}')");
    expect(() => store.getSettings()).toThrow();
    expect(store.db.prepare("SELECT value_json FROM settings WHERE key='preferences'").get()).toMatchObject({ value_json: '{"viewMode":"future"}' });
    store.close();
  });
  it('rejects a newer DB before any file change', () => {
    const path = fixture();
    mkdirSync(join(path, 'data'));
    const dbPath = join(path, 'data', 'app.sqlite3');
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA user_version = 999; CREATE TABLE future_data(value TEXT); INSERT INTO future_data VALUES (\'keep me\');');
    db.close();
    const before = readFileSync(dbPath);
    expect(() => new AppStore(path)).toThrow('더 새로운 버전');
    expect(readFileSync(dbPath)).toEqual(before);
    expect(readdirSync(path)).toEqual(['data']);
  });
  it('backs up existing version 0 DB before migration', () => {
    const path = fixture();
    mkdirSync(join(path, 'data'));
    const empty = new DatabaseSync(join(path, 'data', 'app.sqlite3'));
    empty.exec('PRAGMA user_version = 0');
    empty.close();
    const store = new AppStore(path);
    const backups = readdirSync(join(path, 'backups'));
    expect(backups).toHaveLength(1);
    const backup = new DatabaseSync(join(path, 'backups', backups[0]), { readOnly: true });
    expect(backup.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 0 });
    backup.close();
    store.close();
  });
  it('preserves unrecognized existing DB and rejects migration history mismatch', () => {
    const path = fixture();
    mkdirSync(join(path, 'data'));
    const dbPath = join(path, 'data', 'app.sqlite3');
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE original(value TEXT);');
    db.close();
    const before = readFileSync(dbPath);
    expect(() => new AppStore(path)).toThrow('인식할 수 없는');
    expect(readFileSync(dbPath)).toEqual(before);
    const path2 = fixture();
    const store = new AppStore(path2);
    store.db.exec('DELETE FROM schema_migrations');
    store.close();
    expect(() => new AppStore(path2)).toThrow('이력이 일치하지');
  });
  it('rolls back all writes after a failed transaction', () => {
    const store = new AppStore(fixture());
    expect(() => transaction(store.db, () => {
      store.db.exec("INSERT INTO settings VALUES ('first','true')");
      store.db.exec("INSERT INTO settings VALUES ('broken','not json')");
    })).toThrow();
    expect(store.db.prepare('SELECT * FROM settings').all()).toEqual([]);
    store.close();
  });
  it('rolls back DDL and migration version on migration failure', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE card_definitions(existing TEXT)');
    expect(() => migrate(db, 0)).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='schema_migrations'").get()).toBeUndefined();
    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 0 });
    expect(db.prepare('PRAGMA table_info(card_definitions)').all()).toMatchObject([{ name: 'existing' }]);
    db.close();
  });
  it('enforces character ownership of card resource bindings', () => {
    const store = new AppStore(fixture());
    store.db.exec(`INSERT INTO character_profiles(id,name,ruleset,level) VALUES ('a','가','homebrew',1),('b','나','homebrew',1);
      INSERT INTO resource_templates(id,key,name,kind,definition_json,source,version) VALUES ('t','points','점수','counter','{}','user',1);
      INSERT INTO resource_instances(id,character_id,template_id,overrides_json,current_state_json) VALUES ('r','a','t','{}','{}');
      INSERT INTO card_definitions(id,name,image_asset_id,kind,spell_level,attributes_json,created_at,updated_at) VALUES ('c','카드',NULL,'other',NULL,'{}','now','now');`);
    expect(() => store.db.exec("INSERT INTO card_bindings VALUES ('bad','b','c','points','r')")).toThrow();
    store.db.exec("INSERT INTO card_bindings VALUES ('good','a','c','points','r')");
    expect(store.db.prepare('SELECT count(*) AS n FROM card_bindings').get()).toMatchObject({ n: 1 });
    store.close();
  });
});
