import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { AppStore } from '../electron/store';

const tables = ['card_definitions', 'assets', 'decks', 'deck_cards', 'resource_instances', 'play_events', 'settings', 'card_trash'];
const dbPath = (directory: string) => join(directory, 'data', 'app.sqlite3');
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
function snapshot(db: DatabaseSync) {
  return Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}
function read(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return { version: db.prepare('PRAGMA user_version').get()?.user_version, rows: snapshot(db) }; }
  finally { db.close(); }
}

it('rolls back a failed v1.3 migration, keeps an intact v6 backup, and recovers a separate profile without losing data', () => {
  const root = resolve('artifacts/p5-migration-unit');
  mkdirSync(root, { recursive: true });
  const run = mkdtempSync(join(root, 'fixture-'));
  const source = resolve('repository-data/user-data');
  const failed = join(run, 'failure');
  const recovered = join(run, 'recovered');
  const baseline = read(dbPath(source));
  expect(baseline.version).toBe(6);
  cpSync(source, failed, { recursive: true });
  const oldBackups = new Set(existsSync(join(failed, 'backups')) ? readdirSync(join(failed, 'backups')) : []);
  const fixture = new DatabaseSync(dbPath(failed));
  fixture.exec('CREATE TABLE deck_exchange_imports (conflicting_fixture INTEGER)');
  fixture.close();
  expect(() => new AppStore(failed)).toThrow('deck_exchange_imports');
  expect(read(dbPath(failed))).toEqual(baseline);
  const names = readdirSync(join(failed, 'backups')).filter(name => !oldBackups.has(name) && name.startsWith('before-v6-to-v10-'));
  expect(names).toHaveLength(1);
  expect(read(join(failed, 'backups', names[0]))).toEqual(baseline);
  const db = new DatabaseSync(dbPath(failed), { readOnly: true });
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name='card_owned_resources'").get()).toBeUndefined();
  db.close();
  // Restore from the pristine pre-update profile in a new destination. Keep the failed copy for diagnosis.
  cpSync(source, recovered, { recursive: true });
  const store = new AppStore(recovered);
  expect(snapshot(store.db)).toEqual(baseline.rows);
  expect(store.db.prepare('PRAGMA user_version').get()?.user_version).toBe(10);
  expect(store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  for (const row of baseline.rows.assets) {
    const path = String(row.relative_path);
    expect(digest(join(recovered, path))).toBe(digest(join(source, path)));
  }
  store.close();
  const backups = readdirSync(join(recovered, 'backups'));
  const reopened = new AppStore(recovered);
  expect(snapshot(reopened.db)).toEqual(baseline.rows);
  expect(readdirSync(join(recovered, 'backups'))).toEqual(backups);
  reopened.close();
});
