import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_SETTINGS, settingsSchema, type Settings } from '../src/shared/contracts';
import { migrate, SCHEMA_VERSION, transaction } from './migrations';

function versionOf(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}
function inspect(db: DatabaseSync): number {
  const version = versionOf(db);
  if (version > SCHEMA_VERSION) throw new Error('더 새로운 버전의 데이터입니다. 최신 앱으로 열어 주세요.');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
  if (version === 0 && tables.length > 0) throw new Error('인식할 수 없는 기존 데이터베이스입니다. 원본을 보존했습니다.');
  if (version > 0) {
    const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[];
    if (versions.length !== version || versions.some((v, i) => v.version !== i + 1)) throw new Error('데이터 마이그레이션 이력이 일치하지 않습니다.');
  }
  const check = db.prepare('PRAGMA quick_check').get() as { quick_check: string };
  if (check.quick_check !== 'ok') throw new Error('데이터베이스 무결성 검사에 실패했습니다. 원본을 보존했습니다.');
  return version;
}

export class AppStore {
  readonly db: DatabaseSync;
  constructor(readonly userData: string) {
    const dbPath = join(userData, 'data', 'app.sqlite3');
    const existed = existsSync(dbPath);
    let version = 0;
    // Inspect unsupported files without modifying the database, journal or settings.
    if (existed) {
      const reader = new DatabaseSync(dbPath, { readOnly: true });
      try { version = inspect(reader); } finally { reader.close(); }
    }
    for (const directory of ['data', 'assets', 'backups']) mkdirSync(join(userData, directory), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    try {
      this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
      if (version < SCHEMA_VERSION) {
        if (existed) {
          const backupPath = join(userData, 'backups', `before-v${version}-to-v${SCHEMA_VERSION}-${randomUUID()}.sqlite3`);
          this.db.prepare('VACUUM INTO ?').run(backupPath);
        }
        migrate(this.db, version);
      }
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  getSettings(): Settings {
    const row = this.db.prepare("SELECT value_json FROM settings WHERE key = 'preferences'").get() as { value_json: string } | undefined;
    // Invalid persisted values must surface as an error, never silently reset.
    return row ? settingsSchema.parse(JSON.parse(row.value_json)) : { ...DEFAULT_SETTINGS };
  }
  saveSettings(input: unknown): Settings {
    const settings = settingsSchema.parse(input);
    transaction(this.db, () => {
      this.db.prepare("INSERT INTO settings(key, value_json) VALUES ('preferences', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(settings));
    });
    return settings;
  }
  close(): void { this.db.close(); }
}
