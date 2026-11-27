import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ZipFile } from 'yazl';
import { open as openZip, type Entry } from 'yauzl';
import { AppStore } from '../electron/store';
import { BackupService, applyPendingRestore, countLibrary } from '../electron/backup';
import type { BackupManifest } from '../src/shared/backup';

const root = resolve('artifacts/unit-data');
mkdirSync(root, { recursive: true });
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const now = '2026-11-17T00:00:00.000Z';
const attributes = (tags: string[]) => JSON.stringify({ roles: ['damage'], actions: ['action'], range: { kind: 'ranged', feet: 60 }, tags, castOptions: [{ id: 'use', label: '사용', costs: [] }] });

function seeded(): { store: AppStore; image: Buffer } {
  const store = new AppStore(mkdtempSync(join(root, 'backup-')));
  const db = store.db; const image = Buffer.from('png-bytes-of-a-card-image');
  mkdirSync(join(store.userData, 'assets'), { recursive: true });
  writeFileSync(join(store.userData, 'assets', 'img-1.png'), image);
  db.prepare('INSERT INTO assets(id,relative_path,sha256,mime_type,width,height) VALUES (?,?,?,?,?,?)').run('img-1', 'assets/img-1.png', sha(image), 'image/png', 10, 15);
  db.prepare('INSERT INTO tags(id,name,created_at,updated_at) VALUES (?,?,?,?)').run('tag-fire', '화염', now, now);
  const card = db.prepare('INSERT INTO card_definitions(id,name,image_asset_id,kind,spell_level,attributes_json,created_at,updated_at,archived_at) VALUES (?,?,?,?,?,?,?,?,?)');
  card.run('card-1', '화염구', 'img-1', 'spell', 3, JSON.stringify({ ...JSON.parse(attributes(['tag-fire'])),
    imageMode: 'illustration', ritual: true, concentration: true, upcastEffect: false,
    ownedResources: [{ id: '04d673e9-c25f-43a1-80cd-a699a5026a22', name: '불꽃', unit: '회', maximum: 7, amount: 1, recovery: [] }] }), now, now, null);
  card.run('card-2', '검격', null, 'attack', null, attributes([]), now, now, null);
  card.run('card-3', '버린 카드', null, 'other', null, attributes([]), now, now, now);
  db.prepare('INSERT INTO card_tags(card_id,tag_id) VALUES (?,?)').run('card-1', 'tag-fire');
  db.prepare('INSERT INTO character_profiles(id,name,ruleset,level) VALUES (?,?,?,?)').run('hero', '엘라라', 'homebrew', 5);
  db.prepare('INSERT INTO decks(id,character_id,name) VALUES (?,?,?)').run('deck-1', 'hero', '주문서 덱');
  db.prepare('INSERT INTO deck_cards(deck_id,card_id,position) VALUES (?,?,?)').run('deck-1', 'card-1', 0);
  db.prepare("UPDATE resource_instances SET current_state_json=json_object('remaining',2) WHERE id IN (SELECT instance_id FROM card_owned_resources)").run();
  return { store, image };
}
async function unzipAll(path: string): Promise<Map<string, Buffer>> {
  const zip = await new Promise<import('yauzl').ZipFile>((ok, fail) => openZip(path, { lazyEntries: true }, (error, file) => error ? fail(error) : ok(file!)));
  const out = new Map<string, Buffer>();
  await new Promise<void>((done, fail) => {
    zip.on('entry', (entry: Entry) => zip.openReadStream(entry, (error, stream) => {
      if (error) return fail(error);
      const chunks: Buffer[] = []; stream!.on('data', chunk => chunks.push(chunk)); stream!.on('end', () => { out.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); });
    }));
    zip.on('end', () => done()); zip.readEntry();
  });
  return out;
}
async function zipOf(entries: Map<string, Buffer>, path: string, rename?: [string, string]): Promise<string> {
  const zip = new ZipFile();
  for (const [name, data] of entries) zip.addBuffer(data, name);
  zip.end();
  const chunks: Buffer[] = [];
  await new Promise<void>(done => { zip.outputStream.on('data', chunk => chunks.push(chunk)); zip.outputStream.on('end', () => done()); });
  let bytes = Buffer.concat(chunks);
  if (rename) bytes = Buffer.from(bytes.toString('latin1').split(rename[0]).join(rename[1]), 'latin1');
  writeFileSync(path, bytes);
  return path;
}
async function exported(): Promise<{ store: AppStore; backup: BackupService; zip: string; files: Map<string, Buffer> }> {
  const { store } = seeded();
  const backup = new BackupService(store, '0.6.0');
  const zip = join(store.userData, '..', `${store.userData.split(/[\\/]/).pop()}.zip`);
  await backup.exportTo(zip);
  return { store, backup, zip, files: await unzipAll(zip) };
}
function emptyStore(): { store: AppStore; backup: BackupService } { const store = new AppStore(mkdtempSync(join(root, 'restore-'))); return { store, backup: new BackupService(store, '0.6.0') }; }
const stagingEmpty = (backup: BackupService) => !existsSync(join(backup.restoreRoot, 'staging')) || readdirSync(join(backup.restoreRoot, 'staging')).length === 0;

describe('ZIP backup export', () => {
  it('writes a manifest, a consistent database snapshot and byte-identical originals with matching hashes', async () => {
    const { store, files, zip } = await exported();
    expect([...files.keys()].sort()).toEqual(['assets/img-1.png', 'data/app.sqlite3', 'manifest.json']);
    const manifest = JSON.parse(files.get('manifest.json')!.toString('utf8')) as BackupManifest;
    expect(manifest).toMatchObject({ format: 'dnd-tcg-fy-backup', formatVersion: 1, appVersion: '0.6.0', schemaVersion: 12, counts: { cards: 2, trashedCards: 1, characters: 1, decks: 1, assets: 1, tags: 1 } });
    for (const file of manifest.files) expect(sha(files.get(file.path)!)).toBe(file.sha256);
    expect(files.get('assets/img-1.png')).toEqual(readFileSync(join(store.userData, 'assets', 'img-1.png')));
    expect(existsSync(`${zip}.partial`)).toBe(false);
    store.close();
  });
});

describe('restore: replace the whole library', () => {
  it('restores into an empty profile with identical cards, decks, images and settings, preserving the replaced data', async () => {
    const source = await exported();
    const target = emptyStore();
    target.store.saveSettings({ viewMode: 'grid', reducedMotion: true, resourcePanelCollapsed: false });
    const preview = await target.backup.inspect(source.zip);
    expect(preview.backup.counts).toEqual(countLibrary(source.store.db));
    expect(preview.current.cards).toBe(0);
    await target.backup.scheduleReplace(preview.token);
    const folder = target.store.userData; target.store.close();
    const result = applyPendingRestore(folder);
    expect(result.notice).toContain('복원했습니다');
    const reopened = new AppStore(folder);
    expect(countLibrary(reopened.db)).toEqual(countLibrary(source.store.db));
    expect((reopened.db.prepare('SELECT id FROM card_definitions ORDER BY id').all() as { id: string }[]).map(row => row.id)).toEqual(['card-1', 'card-2', 'card-3']);
    expect(reopened.db.prepare("SELECT attributes_json FROM card_definitions WHERE id='card-1'").get())
      .toEqual(source.store.db.prepare("SELECT attributes_json FROM card_definitions WHERE id='card-1'").get());
    expect(readFileSync(join(folder, 'assets', 'img-1.png'))).toEqual(readFileSync(join(source.store.userData, 'assets', 'img-1.png')));
    expect(reopened.getSettings()).toEqual(source.store.getSettings());
    const owned = "SELECT m.*, json_extract(i.current_state_json,'$.remaining') AS remaining FROM card_owned_resources m JOIN resource_instances i ON i.id=m.instance_id";
    expect(reopened.db.prepare(owned).all()).toEqual(source.store.db.prepare(owned).all());
    expect(reopened.db.prepare(owned).get()).toMatchObject({ card_id: 'card-1', remaining: 2 });
    expect(reopened.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const preserved = readdirSync(join(folder, 'backups')).filter(name => name.startsWith('replaced-'));
    expect(preserved).toHaveLength(1);
    const old = new DatabaseSync(join(folder, 'backups', preserved[0], 'data', 'app.sqlite3'), { readOnly: true });
    expect(JSON.parse((old.prepare("SELECT value_json FROM settings WHERE key='preferences'").get() as { value_json: string }).value_json).viewMode).toBe('grid');
    old.close(); reopened.close(); source.store.close();
    expect(applyPendingRestore(folder)).toEqual({});
  });
  it('ignores a broken restore request and opens the current data unchanged', () => {
    const { store } = seeded(); const folder = store.userData; store.close();
    mkdirSync(join(folder, 'restore'), { recursive: true });
    writeFileSync(join(folder, 'restore', 'pending.json'), '{"token":"not-a-token"}');
    expect(applyPendingRestore(folder).warning).toContain('현재 데이터를 그대로');
    expect(existsSync(join(folder, 'restore', 'pending.json'))).toBe(false);
    const reopened = new AppStore(folder); expect(countLibrary(reopened.db).cards).toBe(2); reopened.close();
  });
});

describe('restore: add cards as new copies', () => {
  it('adds active cards with new IDs, copies images, reuses tags by name and skips trashed cards', async () => {
    const { store, backup, zip } = await exported();
    const preview = await backup.inspect(zip);
    expect(preview.sharedCardIds).toBe(3);
    expect(preview.duplicateNames).toBe(2);
    const result = await backup.importCopies(preview.token);
    expect(result).toEqual({ added: 2, images: 1, tagsCreated: 0 });
    const counts = countLibrary(store.db);
    expect(counts).toMatchObject({ cards: 4, trashedCards: 1, tags: 1, assets: 2, characters: 1, decks: 1 });
    const copies = store.db.prepare("SELECT c.id, a.relative_path, a.sha256 FROM card_definitions c JOIN assets a ON a.id=c.image_asset_id WHERE c.name='화염구' AND c.id<>'card-1'").all() as { id: string; relative_path: string; sha256: string }[];
    expect(copies).toHaveLength(1);
    expect(sha(readFileSync(join(store.userData, copies[0].relative_path)))).toBe(copies[0].sha256);
    expect(store.db.prepare('SELECT tag_id FROM card_tags WHERE card_id=?').all(copies[0].id)).toEqual([{ tag_id: 'tag-fire' }]);
    expect(store.db.prepare('SELECT count(*) AS n FROM deck_cards').get()).toEqual({ n: 1 });
    expect(stagingEmpty(backup)).toBe(true);
    store.close();
  });
});

describe('restore: rejects damaged or manipulated archives without leaving files behind', () => {
  async function rejects(mutate: (files: Map<string, Buffer>, manifest: BackupManifest) => void, message: RegExp, rename?: [string, string]) {
    const { store, backup, files, zip } = await exported();
    const manifest = JSON.parse(files.get('manifest.json')!.toString('utf8')) as BackupManifest;
    mutate(files, manifest);
    files.set('manifest.json', Buffer.from(JSON.stringify(manifest)));
    const bad = await zipOf(files, `${zip}.bad.zip`, rename);
    await expect(backup.inspect(bad)).rejects.toThrow(message);
    expect(stagingEmpty(backup)).toBe(true);
    expect(countLibrary(store.db).cards).toBe(2);
    store.close();
  }
  it('an unknown file', () => rejects((files, manifest) => { const data = Buffer.from('run me'); files.set('notes.exe', data); manifest.files.push({ path: 'notes.exe', bytes: data.length, sha256: sha(data) }); }, /허용되지 않은 파일/));
  it('a path that escapes the folder', () => rejects((files, manifest) => {
    const data = Buffer.from('x'); files.set('zz/evil.png', data); manifest.files.push({ path: 'zz/evil.png', bytes: 1, sha256: sha(data) });
  }, /손상|허용되지 않은/, ['zz/evil.png', '../evil.png']));
  it('an image whose bytes were changed', () => rejects(files => { files.set('assets/img-1.png', Buffer.from('tampered-bytes-of-image!!')); }, /손상되었거나 바뀌었습니다/));
  it('a manifest that lists a missing file', () => rejects((_files, manifest) => { manifest.files.push({ path: 'assets/ghost.png', bytes: 1, sha256: 'a'.repeat(64) }); }, /일치하지 않습니다/));
  it('a backup from a newer app', () => rejects((_files, manifest) => { manifest.schemaVersion = 99; }, /더 새로운 버전/));
  it('a database with a newer schema than the manifest claims', () => rejects((files, manifest) => {
    const path = join(root, `newer-${Date.now()}.sqlite3`); writeFileSync(path, files.get('data/app.sqlite3')!);
    const db = new DatabaseSync(path); db.exec('PRAGMA user_version = 99'); db.close();
    const data = readFileSync(path); files.set('data/app.sqlite3', data);
    const entry = manifest.files.find(file => file.path === 'data/app.sqlite3')!; entry.bytes = data.length; entry.sha256 = sha(data);
  }, /더 새로운 버전/));
  it('a file that is not a ZIP', async () => {
    const { store, backup } = await exported();
    const path = join(root, `not-zip-${Date.now()}.zip`); writeFileSync(path, Buffer.from('definitely not a zip archive'));
    await expect(backup.inspect(path)).rejects.toThrow(/ZIP/);
    expect(stagingEmpty(backup)).toBe(true); store.close();
  });
});

describe('automatic database snapshots', () => {
  it('makes one snapshot per day and prunes only its own old snapshots', () => {
    const { store } = seeded(); const backup = new BackupService(store, '0.6.0');
    const folder = join(store.userData, 'backups', 'auto'); mkdirSync(folder, { recursive: true });
    for (let day = 1; day <= 16; day++) writeFileSync(join(folder, `app-202601${String(day).padStart(2, '0')}-000000.sqlite3`), 'old');
    writeFileSync(join(folder, 'keep-me.txt'), 'user file');
    const first = backup.autoSnapshot(new Date('2026-11-17T08:00:00Z'));
    expect(first).toBeDefined();
    expect(backup.autoSnapshot(new Date('2026-11-17T20:00:00Z'))).toBeUndefined();
    expect(backup.autoSnapshot(new Date('2026-11-18T06:00:00Z'))).toBeDefined();
    const names = readdirSync(folder);
    expect(names.filter(name => name.endsWith('.sqlite3'))).toHaveLength(14);
    expect(names).toContain('keep-me.txt');
    const snapshot = new DatabaseSync(first!, { readOnly: true });
    expect(countLibrary(snapshot).cards).toBe(2); snapshot.close();
    store.close();
  });
});
