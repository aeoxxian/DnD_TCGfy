import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_SETTINGS, settingsSchema, type Settings } from '../src/shared/contracts';
import { migrate, SCHEMA_VERSION, transaction } from './migrations';
import { UserInputError } from './errors';

function versionOf(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}
export function inspectDatabase(db: DatabaseSync): number {
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
      try { version = inspectDatabase(reader); } finally { reader.close(); }
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
    const display = this.db.prepare("SELECT value_json FROM settings WHERE key = 'resource_display'").get() as { value_json: string } | undefined;
    const appearance = this.db.prepare("SELECT value_json FROM settings WHERE key = 'appearance'").get() as { value_json: string } | undefined;
    const history = this.db.prepare("SELECT value_json FROM settings WHERE key = 'history_view'").get() as { value_json: string } | undefined;
    const effects = this.db.prepare("SELECT value_json FROM settings WHERE key = 'effects'").get() as { value_json: string } | undefined;
    const slotColors = this.db.prepare("SELECT value_json FROM settings WHERE key = 'slot_colors'").get() as { value_json: string } | undefined;
    const handScroll = this.db.prepare("SELECT value_json FROM settings WHERE key = 'hand_scroll'").get() as { value_json: string } | undefined;
    const templates = this.db.prepare("SELECT value_json FROM settings WHERE key = 'registration_templates'").get() as { value_json: string } | undefined;
    const used = this.db.prepare("SELECT value_json FROM settings WHERE key = 'used_view'").get() as { value_json: string } | undefined;
    return settingsSchema.parse({ ...(row ? JSON.parse(row.value_json) : DEFAULT_SETTINGS), ...(display ? { resourceViews: JSON.parse(display.value_json) } : {}), ...(appearance ? { appearance: JSON.parse(appearance.value_json) } : {}), ...(history ? { historyViews: JSON.parse(history.value_json) } : {}), ...(effects ? { effects: JSON.parse(effects.value_json) } : {}), ...(slotColors ? { slotColors: JSON.parse(slotColors.value_json) } : {}), ...(handScroll ? { handScroll: JSON.parse(handScroll.value_json) } : {}), ...(templates ? { registrationTemplates: JSON.parse(templates.value_json) } : {}), ...(used ? { usedViews: JSON.parse(used.value_json) } : {}) });
  }
  saveSettings(input: unknown): Settings {
    const settings = settingsSchema.parse(input);
    transaction(this.db, () => {
      // Keep the original preferences object readable by P0–P4-A. UI display state and the
      // play-mat appearance have their own keys and never participate in resource revisions or Undo.
      // v1.1: the recent-actions "hidden through" marks are display state too (`history_view`); play events stay intact.
      // Visual effects (`effects`, e.g. the enlarged-card tilt) and spell slot colours (`slot_colors`) have their own keys as well.
      // v1.2: hand scrolling (`hand_scroll`, momentum on/off) is separate too, so 1.1.0 can still read `effects`.
      // v1.3: saved registration templates (`registration_templates`) are their own key as well.
      const { resourceViews, appearance, historyViews, effects, slotColors, handScroll, registrationTemplates, usedViews, ...preferences } = settings;
      if (appearance) for (const back of appearance.customBacks)
        if (!this.db.prepare('SELECT 1 FROM assets WHERE id = ?').get(back.assetId)) throw new UserInputError('카드 뒷면 이미지를 찾을 수 없습니다. 이미지를 다시 선택해 주세요.');
      this.db.prepare("INSERT INTO settings(key, value_json) VALUES ('preferences', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(preferences));
      if (resourceViews !== undefined) this.db.prepare("INSERT INTO settings(key, value_json) VALUES ('resource_display', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(resourceViews));
      if (appearance !== undefined) this.db.prepare("INSERT INTO settings(key, value_json) VALUES ('appearance', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(appearance));
      if (historyViews !== undefined) this.db.prepare("INSERT INTO settings(key, value_json) VALUES ('history_view', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(historyViews));
      if (effects !== undefined) this.db.prepare("INSERT INTO settings(key, value_json) VALUES ('effects', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(effects));
      if (slotColors !== undefined) this.db.prepare("INSERT INTO settings(key, value_json) VALUES ('slot_colors', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(slotColors));
      if (handScroll !== undefined) this.db.prepare("INSERT INTO settings(key, value_json) VALUES ('hand_scroll', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(handScroll));
      if (registrationTemplates !== undefined) this.db.prepare("INSERT INTO settings(key, value_json) VALUES ('registration_templates', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(registrationTemplates));
      if (usedViews !== undefined) this.db.prepare("INSERT INTO settings(key, value_json) VALUES ('used_view', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(usedViews));
    });
    return this.getSettings();
  }
  close(): void { this.db.close(); }
}
