import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { copyFile, mkdir, open, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { ZipFile } from 'yazl';
import { open as openZip, type Entry, type ZipFile as ZipReader } from 'yauzl';
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, backupManifestSchema, type BackupCounts, type BackupExportResult, type BackupManifest, type BackupStatus, type RestorePreview } from '../src/shared/backup';
import { cardSchema } from '../src/shared/contracts';
import type { AppStore } from './store';
import { inspectDatabase } from './store';
import { SCHEMA_VERSION, transaction } from './migrations';
import { UserInputError } from './errors';
import type { AssetService, PreparedOriginal } from './assets';

const MB = 2 ** 20;
export const LIMITS = { entries: 20000, assetBytes: 64 * MB, dbBytes: 2048 * MB, manifestBytes: 16 * MB, totalBytes: 8192 * MB, ratio: 200 };
const ASSET_ENTRY = /^assets\/[A-Za-z0-9_-]{1,128}\.(png|jpg|jpeg|webp)$/;
const DB_ENTRY = 'data/app.sqlite3';
const AUTO_NAME = /^app-(\d{8})-(\d{6})\.sqlite3$/;
const AUTO_KEEP = 14;
const AUTO_INTERVAL_MS = 20 * 60 * 60 * 1000;

function stamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}-${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
}
function count(db: DatabaseSync, sql: string): number { return Number((db.prepare(sql).get() as { n: number }).n); }
export function countLibrary(db: DatabaseSync): BackupCounts {
  return {
    cards: count(db, 'SELECT count(*) AS n FROM card_definitions WHERE archived_at IS NULL'),
    trashedCards: count(db, 'SELECT count(*) AS n FROM card_definitions WHERE archived_at IS NOT NULL'),
    characters: count(db, 'SELECT count(*) AS n FROM character_profiles'),
    decks: count(db, 'SELECT count(*) AS n FROM decks'),
    events: count(db, 'SELECT count(*) AS n FROM play_events'),
    assets: count(db, 'SELECT count(*) AS n FROM assets'),
    tags: count(db, 'SELECT count(*) AS n FROM tags'),
  };
}
async function hashFile(path: string): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk as Buffer); bytes += (chunk as Buffer).length; }
  return { bytes, sha256: hash.digest('hex') };
}
function inside(root: string, path: string): boolean { const rel = relative(root, path); return !!rel && !rel.startsWith('..') && !isAbsolute(rel); }

/** Open the staged copy of a backup database and run every structural check before it is trusted. */
function checkStagedDatabase(path: string): { db: DatabaseSync; version: number } {
  const db = new DatabaseSync(path);
  try {
    const version = inspectDatabase(db);
    if (version < 1) throw new UserInputError('백업 데이터베이스가 비어 있거나 인식할 수 없습니다.');
    const integrity = db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new UserInputError('백업 데이터베이스 무결성 검사에 실패했습니다.');
    if ((db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length) throw new UserInputError('백업 데이터베이스의 참조 관계가 맞지 않습니다.');
    return { db, version };
  } catch (error) {
    db.close();
    if (error instanceof UserInputError) throw error;
    throw new UserInputError(error instanceof Error && /새로운 버전/.test(error.message) ? '더 새로운 버전의 앱에서 만든 백업입니다. 최신 앱으로 복원해 주세요.' : '백업 데이터베이스를 열 수 없거나 손상되었습니다.');
  }
}

function readEntries(zip: ZipReader): Promise<Entry[]> {
  return new Promise((resolveEntries, reject) => {
    const entries: Entry[] = [];
    zip.on('entry', (entry: Entry) => { entries.push(entry); if (entries.length > LIMITS.entries + 2) { reject(new UserInputError('백업에 파일이 너무 많습니다.')); zip.close(); return; } zip.readEntry(); });
    zip.on('end', () => resolveEntries(entries));
    zip.on('error', () => reject(new UserInputError('ZIP 파일 구조가 손상되었습니다.')));
    zip.readEntry();
  });
}
function entryStream(zip: ZipReader, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolveStream, reject) => zip.openReadStream(entry, (error, stream) => error || !stream ? reject(new UserInputError('ZIP 항목을 읽을 수 없습니다.')) : resolveStream(stream)));
}

export class BackupService {
  readonly restoreRoot: string;
  constructor(private store: AppStore, private appVersion: string) { this.restoreRoot = join(store.userData, 'restore'); }
  private get userData() { return this.store.userData; }

  status(): BackupStatus {
    const folder = join(this.userData, 'backups', 'auto');
    const files = existsSync(folder) ? readdirSync(folder).filter(name => AUTO_NAME.test(name)).sort() : [];
    const last = files.at(-1)?.match(AUTO_NAME);
    return {
      dataPath: this.userData, autoBackupFolder: folder, autoBackups: files.length,
      lastAutoBackup: last ? `${last[1].slice(0, 4)}-${last[1].slice(4, 6)}-${last[1].slice(6, 8)}T${last[2].slice(0, 2)}:${last[2].slice(2, 4)}:${last[2].slice(4, 6)}.000Z` : undefined,
    };
  }

  /** Daily DB snapshot. Only files this method names (app-YYYYMMDD-HHMMSS.sqlite3) are ever pruned. */
  autoSnapshot(now = new Date()): string | undefined {
    const folder = join(this.userData, 'backups', 'auto');
    mkdirSync(folder, { recursive: true });
    const files = readdirSync(folder).filter(name => AUTO_NAME.test(name)).sort();
    const latest = this.status().lastAutoBackup;
    if (latest && now.getTime() - Date.parse(latest) < AUTO_INTERVAL_MS) return undefined;
    const name = `app-${stamp(now)}.sqlite3`;
    const partial = join(folder, `${name}.partial`);
    rmSync(partial, { force: true });
    this.store.db.prepare('VACUUM INTO ?').run(partial);
    renameSync(partial, join(folder, name));
    const all = [...files, name].sort();
    for (const old of all.slice(0, Math.max(0, all.length - AUTO_KEEP))) unlinkSync(join(folder, old));
    return join(folder, name);
  }

  /** Remove app-made temporary folders left by an interrupted export/inspection (never user data). */
  cleanupStale(maxAgeMs = 24 * 60 * 60 * 1000): void {
    for (const parent of [this.restoreRoot, join(this.restoreRoot, 'staging')]) {
      if (!existsSync(parent)) continue;
      for (const name of readdirSync(parent)) {
        const path = join(parent, name);
        if (!/^(export-)?[0-9a-f-]{36}$/.test(name)) continue;
        try { if (Date.now() - statSync(path).mtimeMs > maxAgeMs) rmSync(path, { recursive: true, force: true }); } catch { /* Next start retries. */ }
      }
    }
  }

  async exportTo(target: string): Promise<BackupExportResult> {
    const work = join(this.restoreRoot, `export-${randomUUID()}`);
    await mkdir(work, { recursive: true });
    const dbCopy = join(work, 'app.sqlite3');
    try {
      this.store.db.prepare('VACUUM INTO ?').run(dbCopy);
      const snapshot = new DatabaseSync(dbCopy, { readOnly: true });
      let counts: BackupCounts; let schemaVersion: number; let assets: { id: string; relative_path: string; sha256: string }[];
      try {
        counts = countLibrary(snapshot);
        schemaVersion = Number((snapshot.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
        assets = snapshot.prepare('SELECT id, relative_path, sha256 FROM assets ORDER BY id').all() as typeof assets;
      } finally { snapshot.close(); }
      const warnings: string[] = [];
      const files: { path: string; source: string; bytes: number; sha256: string }[] = [{ path: DB_ENTRY, source: dbCopy, ...(await hashFile(dbCopy)) }];
      for (const asset of assets) {
        if (!ASSET_ENTRY.test(asset.relative_path)) { warnings.push(`이미지 경로 형식이 올바르지 않아 제외했습니다: ${asset.id}`); continue; }
        const source = join(this.userData, asset.relative_path);
        if (!existsSync(source)) { warnings.push(`이미지 파일이 없어 제외했습니다: ${basename(asset.relative_path)}`); continue; }
        const info = await hashFile(source);
        if (info.sha256 !== asset.sha256) warnings.push(`이미지 내용이 기록과 달라 그대로 포함했습니다: ${basename(asset.relative_path)}`);
        files.push({ path: asset.relative_path, source, ...info });
      }
      const manifest: BackupManifest = {
        format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, appVersion: this.appVersion, schemaVersion,
        createdAt: new Date().toISOString(), counts, files: files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
      };
      const zip = new ZipFile();
      zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), 'manifest.json');
      // Images are already compressed; store them as-is and deflate only the database.
      for (const file of files) zip.addFile(file.source, file.path, { compress: file.path === DB_ENTRY });
      const partial = `${target}.partial-${randomUUID()}`;
      const written = pipeline(zip.outputStream, createWriteStream(partial, { flags: 'wx' }));
      zip.end();
      try {
        await written;
        const handle = await open(partial, 'r+'); try { await handle.sync(); } finally { await handle.close(); }
        await rename(partial, target);
      } catch (error) { await rm(partial, { force: true }); throw error; }
      return { canceled: false, path: target, bytes: (await stat(target)).size, files: files.length, counts, warnings };
    } finally { await rm(work, { recursive: true, force: true }); }
  }

  async inspect(zipPath: string): Promise<RestorePreview> {
    const token = randomUUID();
    const staging = join(this.restoreRoot, 'staging', token);
    await mkdir(staging, { recursive: true });
    try {
      if ((await stat(zipPath)).size > LIMITS.totalBytes) throw new UserInputError('백업 파일이 너무 큽니다.');
      const zip = await new Promise<ZipReader>((ok, fail) => openZip(zipPath, { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true, decodeStrings: true },
        (error, file) => error || !file ? fail(new UserInputError('ZIP 파일이 아니거나 손상되었습니다.')) : ok(file)));
      let manifest: BackupManifest; let total = 0;
      try {
        const entries = await readEntries(zip);
        if (entries.some(entry=>entry.fileName==='deck.json') && !entries.some(entry=>entry.fileName===DB_ENTRY))
          throw new UserInputError('덱 교환 ZIP입니다. 관리 → 덱 JSON·ZIP 교환에서 열어 주세요.');
        const names = new Set<string>(); const files = new Map<string, Entry>();
        for (const entry of entries) {
          const name = entry.fileName;
          if (names.has(name)) throw new UserInputError('같은 이름의 파일이 중복된 백업입니다.');
          names.add(name);
          if (name.endsWith('/')) { if (!['data/', 'assets/'].includes(name)) throw new UserInputError(`허용되지 않은 폴더가 있습니다: ${name}`); continue; }
          if (name !== 'manifest.json' && name !== DB_ENTRY && !ASSET_ENTRY.test(name)) throw new UserInputError(`허용되지 않은 파일이 있습니다: ${name.slice(0, 80)}`);
          if (entry.isEncrypted()) throw new UserInputError('암호화된 백업은 지원하지 않습니다.');
          const limit = name === 'manifest.json' ? LIMITS.manifestBytes : name === DB_ENTRY ? LIMITS.dbBytes : LIMITS.assetBytes;
          if (entry.uncompressedSize > limit) throw new UserInputError(`파일 크기 제한을 넘었습니다: ${name}`);
          if (entry.uncompressedSize > MB && entry.uncompressedSize / Math.max(1, entry.compressedSize) > LIMITS.ratio) throw new UserInputError('압축 비율이 비정상적인 파일이 있습니다.');
          total += entry.uncompressedSize;
          if (total > LIMITS.totalBytes) throw new UserInputError('백업의 전체 크기가 제한을 넘었습니다.');
          files.set(name, entry);
        }
        const manifestEntry = files.get('manifest.json');
        if (!manifestEntry) throw new UserInputError('백업 설명 파일(manifest.json)이 없습니다.');
        const chunks: Buffer[] = [];
        for await (const chunk of await entryStream(zip, manifestEntry)) chunks.push(chunk as Buffer);
        let parsed: unknown;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new UserInputError('백업 설명 파일을 읽을 수 없습니다.'); }
        const result = backupManifestSchema.safeParse(parsed);
        if (!result.success) throw new UserInputError('이 앱의 백업 형식이 아니거나 지원하지 않는 형식 버전입니다.');
        manifest = result.data;
        if (manifest.schemaVersion > SCHEMA_VERSION) throw new UserInputError('더 새로운 버전의 앱에서 만든 백업입니다. 최신 앱으로 복원해 주세요.');
        const listed = new Map(manifest.files.map(file => [file.path, file]));
        if (listed.size !== manifest.files.length) throw new UserInputError('백업 설명 파일에 중복 항목이 있습니다.');
        const archived = [...files.keys()].filter(name => name !== 'manifest.json');
        if (!listed.has(DB_ENTRY)) throw new UserInputError('백업에 데이터베이스가 없습니다.');
        if (archived.length !== listed.size || archived.some(name => !listed.has(name))) throw new UserInputError('백업 설명과 실제 파일 목록이 일치하지 않습니다.');
        for (const name of archived) {
          const entry = files.get(name)!; const expected = listed.get(name)!;
          const destination = resolve(staging, ...name.split('/'));
          if (!inside(staging, destination)) throw new UserInputError('허용되지 않은 파일 경로입니다.');
          await mkdir(dirname(destination), { recursive: true });
          const hash = createHash('sha256'); let bytes = 0;
          const meter = new Transform({ transform(chunk: Buffer, _encoding, done) { hash.update(chunk); bytes += chunk.length; done(null, chunk); } });
          await pipeline(await entryStream(zip, entry), meter, createWriteStream(destination, { flags: 'wx' }));
          if (bytes !== expected.bytes || hash.digest('hex') !== expected.sha256) throw new UserInputError(`파일이 손상되었거나 바뀌었습니다: ${name}`);
        }
      } finally { zip.close(); }

      const { db } = checkStagedDatabase(join(staging, 'data', 'app.sqlite3'));
      const warnings: string[] = [];
      let counts: BackupCounts; let backupCardIds: string[]; let backupNames: string[];
      try {
        const assets = db.prepare('SELECT id, relative_path, sha256 FROM assets').all() as { id: string; relative_path: string; sha256: string }[];
        const archivedAssets = new Set(manifest.files.map(file => file.path).filter(path => path !== DB_ENTRY));
        for (const asset of assets) {
          if (!ASSET_ENTRY.test(asset.relative_path)) throw new UserInputError('백업 데이터의 이미지 경로가 올바르지 않습니다.');
          if (!archivedAssets.delete(asset.relative_path)) warnings.push(`이미지 파일이 백업에 없어 해당 카드는 대체 표시됩니다: ${basename(asset.relative_path)}`);
          else if (manifest.files.find(file => file.path === asset.relative_path)!.sha256 !== asset.sha256) warnings.push(`이미지 내용이 기록과 달라 표시되지 않을 수 있습니다: ${basename(asset.relative_path)}`);
        }
        if (archivedAssets.size) throw new UserInputError('데이터베이스에 없는 이미지 파일이 백업에 들어 있습니다.');
        counts = countLibrary(db);
        backupCardIds = (db.prepare('SELECT id FROM card_definitions').all() as { id: string }[]).map(row => row.id);
        backupNames = (db.prepare('SELECT name FROM card_definitions WHERE archived_at IS NULL').all() as { name: string }[]).map(row => row.name);
      } finally { db.close(); }
      const current = countLibrary(this.store.db);
      const known = this.store.db.prepare('SELECT 1 FROM card_definitions WHERE id = ?');
      const currentNames = new Set((this.store.db.prepare('SELECT name FROM card_definitions WHERE archived_at IS NULL').all() as { name: string }[]).map(row => row.name));
      const preview: RestorePreview = {
        canceled: false, token, fileName: basename(zipPath),
        backup: { appVersion: manifest.appVersion, schemaVersion: manifest.schemaVersion, createdAt: manifest.createdAt, counts, totalBytes: total, files: manifest.files.length },
        current,
        sharedCardIds: backupCardIds.filter(id => known.get(id)).length,
        duplicateNames: backupNames.filter(name => currentNames.has(name)).length,
        checks: [
          `파일 ${manifest.files.length}개의 크기와 SHA-256이 백업 설명과 일치합니다.`,
          '허용된 경로의 파일만 들어 있습니다(경로 순회·숨은 파일 없음).',
          '데이터베이스 무결성·참조 관계 검사를 통과했습니다.',
          manifest.schemaVersion < SCHEMA_VERSION ? `스키마 v${manifest.schemaVersion} 백업입니다. 복원 시 v${SCHEMA_VERSION}으로 마이그레이션합니다(사전 백업 포함).` : `현재와 같은 스키마 v${SCHEMA_VERSION}입니다.`,
        ],
        warnings,
      };
      await writeFile(join(staging, 'preview.json'), JSON.stringify({ token, createdAt: new Date().toISOString(), fileName: preview.fileName }), { flag: 'wx' });
      return preview;
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      if (error instanceof UserInputError) throw error;
      throw new UserInputError('백업 파일을 확인하지 못했습니다. 손상되었거나 이 앱의 백업이 아닙니다.');
    }
  }

  private staged(token: string): string {
    const staging = join(this.restoreRoot, 'staging', token);
    if (!/^[0-9a-f-]{36}$/.test(token) || !existsSync(join(staging, 'preview.json')) || !existsSync(join(staging, 'data', 'app.sqlite3'))) throw new UserInputError('확인한 백업을 찾을 수 없습니다. 백업 파일을 다시 열어 주세요.');
    return staging;
  }

  async discard(token: string): Promise<true> {
    if (/^[0-9a-f-]{36}$/.test(token)) await rm(join(this.restoreRoot, 'staging', token), { recursive: true, force: true });
    return true;
  }

  /** Recover only byte-identical originals; do not import backup card definitions or play state. */
  async recoverImages(token: string, assets: AssetService) {
    const staging = this.staged(token);
    const source = new DatabaseSync(join(staging, 'data', 'app.sqlite3'), { readOnly: true });
    const originals = new Map<string,string>();
    try {
      for (const row of source.prepare('SELECT sha256,relative_path FROM assets ORDER BY id').all()) {
        const path = String(row.relative_path);
        if (ASSET_ENTRY.test(path) && existsSync(join(staging,path))) originals.set(String(row.sha256),join(staging,path));
      }
    } finally { source.close(); }
    const missing = await assets.missingOriginals();
    const wanted = new Set(missing.map(row=>row.sha));
    const local = await assets.findOriginals(wanted);
    const prepared = new Map<string,PreparedOriginal>();
    try {
      for (const sha of wanted) {
        const path = originals.get(sha);
        if (path && !local.has(sha) && existsSync(path)) prepared.set(sha,await assets.prepareOriginal(path,sha));
      }
      const recovered = transaction(assets.library.db,()=>{
        let count = 0;
        for (const row of missing) {
          let id = local.get(row.sha);
          const image = prepared.get(row.sha);
          if (!id && image) {
            id = assets.storeOriginal(image);
            local.set(row.sha,id);
          }
          if (id && assets.linkOriginal(row,id)) count++;
        }
        return count;
      });
      await this.discard(token).catch(()=>undefined);
      return { recovered, remaining:(await assets.missingOriginals()).length };
    } finally { await assets.cleanPrepared(prepared.values()); }
  }

  /** Schedule a full replacement. The swap itself runs at the next start, before the database is opened. */
  async scheduleReplace(token: string): Promise<string> {
    this.staged(token);
    const pending = join(this.restoreRoot, 'pending.json');
    await writeFile(pending, JSON.stringify({ token, requestedAt: new Date().toISOString() }));
    return join(this.userData, 'backups', 'replaced-<복원 시각>');
  }

  /** Add the backup's active cards (with images and tags) as new copies. Current data is never modified otherwise. */
  async importCopies(token: string): Promise<{ added: number; images: number; tagsCreated: number }> {
    const staging = this.staged(token);
    const source = new DatabaseSync(join(staging, 'data', 'app.sqlite3'), { readOnly: true });
    type Row = { id: string; name: string; image_asset_id: string | null; kind: string; spell_level: number | null; attributes_json: string };
    type AssetRow = { id: string; relative_path: string; sha256: string; mime_type: string; width: number; height: number; original_name: string | null };
    let cards: (Row & { tagNames: string[] })[]; let assets: Map<string, AssetRow>;
    try {
      cards = (source.prepare('SELECT id,name,image_asset_id,kind,spell_level,attributes_json FROM card_definitions WHERE archived_at IS NULL ORDER BY created_at,rowid').all() as Row[])
        .map(row => ({ ...row, tagNames: (source.prepare('SELECT t.name FROM card_tags ct JOIN tags t ON t.id=ct.tag_id WHERE ct.card_id=? ORDER BY ct.rowid').all(row.id) as { name: string }[]).map(tag => tag.name) }));
      assets = new Map((source.prepare('SELECT id,relative_path,sha256,mime_type,width,height,original_name FROM assets').all() as AssetRow[]).map(row => [row.id, row]));
    } finally { source.close(); }
    if (!cards.length) throw new UserInputError('백업에 추가할 카드가 없습니다.');
    const copied: string[] = []; const assetIds = new Map<string, string>();
    try {
      await mkdir(join(this.userData, 'assets'), { recursive: true });
      for (const card of cards) {
        const asset = card.image_asset_id ? assets.get(card.image_asset_id) : undefined;
        if (!asset || assetIds.has(card.image_asset_id!)) continue;
        const from = join(staging, ...asset.relative_path.split('/'));
        if (!existsSync(from) || (await hashFile(from)).sha256 !== asset.sha256) continue;
        const id = randomUUID(); const relativePath = `assets/${id}.${asset.relative_path.split('.').pop()}`;
        await copyFile(from, join(this.userData, relativePath), fsConstants.COPYFILE_EXCL);
        copied.push(join(this.userData, relativePath)); assetIds.set(card.image_asset_id!, id);
      }
      let added = 0; let tagsCreated = 0;
      transaction(this.store.db, () => {
        const db = this.store.db; const now = new Date().toISOString();
        const tagIds = new Map((db.prepare('SELECT id,name FROM tags').all() as { id: string; name: string }[]).map(tag => [tag.name, tag.id]));
        for (const [oldId, newId] of assetIds) {
          const asset = assets.get(oldId)!;
          db.prepare('INSERT INTO assets(id,relative_path,sha256,mime_type,width,height,original_name) VALUES (?,?,?,?,?,?,?)')
            .run(newId, `assets/${newId}.${asset.relative_path.split('.').pop()}`, asset.sha256, asset.mime_type, asset.width, asset.height, asset.original_name);
        }
        for (const card of cards) {
          const tagIdsForCard = card.tagNames.map(name => {
            let id = tagIds.get(name);
            if (!id) { id = randomUUID(); db.prepare('INSERT INTO tags(id,name,created_at,updated_at) VALUES (?,?,?,?)').run(id, name, now, now); tagIds.set(name, id); tagsCreated++; }
            return id;
          });
          const id = randomUUID();
          const imageAssetId = card.image_asset_id ? assetIds.get(card.image_asset_id) : undefined;
          const attributes = { ...JSON.parse(card.attributes_json), tags: tagIdsForCard };
          cardSchema.parse({ ...attributes, id, name: card.name, kind: card.kind, imageAssetId, spellLevel: card.spell_level ?? undefined, createdAt: now, updatedAt: now });
          db.prepare('INSERT INTO card_definitions(id,name,image_asset_id,kind,spell_level,attributes_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
            .run(id, card.name, imageAssetId ?? null, card.kind, card.spell_level, JSON.stringify(attributes), now, now);
          for (const tagId of tagIdsForCard) db.prepare('INSERT OR IGNORE INTO card_tags(card_id,tag_id) VALUES (?,?)').run(id, tagId);
          added++;
        }
      });
      await rm(staging, { recursive: true, force: true });
      return { added, images: assetIds.size, tagsCreated };
    } catch (error) {
      // Only files created by this import are removed; nothing that existed before is touched.
      for (const path of copied) await unlink(path).catch(() => undefined);
      if (error instanceof UserInputError) throw error;
      throw new UserInputError('카드를 추가하지 못했습니다. 현재 데이터는 바뀌지 않았습니다.');
    }
  }
}

/**
 * Runs at start-up before the database is opened. Moves the current data aside (never deletes it)
 * and puts the staged backup in place. Any failure restores the original layout.
 */
export function applyPendingRestore(userData: string): { notice?: string; warning?: string } {
  const restoreRoot = join(userData, 'restore');
  const marker = join(restoreRoot, 'pending.json');
  if (!existsSync(marker)) return {};
  let token = '';
  try { token = String((JSON.parse(readFileSync(marker, 'utf8')) as { token?: unknown }).token ?? ''); } catch { /* handled below */ }
  unlinkSync(marker); // Never loop on a broken request.
  const staging = join(restoreRoot, 'staging', token);
  if (!/^[0-9a-f-]{36}$/.test(token) || !existsSync(join(staging, 'data', 'app.sqlite3'))) return { warning: '예약된 백업 복원을 찾을 수 없어 현재 데이터를 그대로 열었습니다.' };
  const preserved = join(userData, 'backups', `replaced-${stamp()}`);
  const items = [['data', 'data'], ['assets', 'assets'], [join('cache', 'thumbnails'), 'thumbnails']] as const;
  const movedOut: [string, string][] = []; const movedIn: [string, string][] = [];
  try {
    mkdirSync(preserved, { recursive: true });
    for (const [from, to] of items) {
      const source = join(userData, from);
      if (existsSync(source)) { renameSync(source, join(preserved, to)); movedOut.push([source, join(preserved, to)]); }
    }
    for (const name of ['data', 'assets']) {
      const source = join(staging, name);
      if (existsSync(source)) { renameSync(source, join(userData, name)); movedIn.push([join(userData, name), source]); }
      else mkdirSync(join(userData, name), { recursive: true });
    }
    writeFileSync(join(preserved, 'README.txt'), `복원 전에 쓰던 데이터입니다 (${new Date().toISOString()}).\n되돌리려면 앱을 종료한 뒤 data, assets 폴더를 앱 데이터 폴더로 다시 옮기세요.\n`);
    rmSync(staging, { recursive: true, force: true });
    return { notice: `백업에서 복원했습니다. 이전 데이터는 ${preserved}에 보존했습니다.` };
  } catch {
    for (const [now, back] of movedIn.reverse()) { try { renameSync(now, back); } catch { /* keep going */ } }
    for (const [original, moved] of movedOut.reverse()) { try { if (!existsSync(original)) renameSync(moved, original); } catch { /* keep going */ } }
    return { warning: '백업 복원 중 파일을 옮기지 못해 원래 데이터로 되돌렸습니다. 다른 프로그램이 데이터 폴더를 쓰고 있는지 확인해 주세요.' };
  }
}
