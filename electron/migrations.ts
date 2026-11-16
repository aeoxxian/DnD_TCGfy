import type { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 6;
export const migrations = [{
  version: 1,
  sql: `
    CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE assets(id TEXT PRIMARY KEY, relative_path TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL, mime_type TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL);
    CREATE TABLE card_definitions(id TEXT PRIMARY KEY, name TEXT NOT NULL, image_asset_id TEXT REFERENCES assets(id) ON DELETE RESTRICT, kind TEXT NOT NULL CHECK(kind IN ('spell','feature','attack','item','feat','other')), spell_level INTEGER CHECK(spell_level BETWEEN 0 AND 9), attributes_json TEXT NOT NULL CHECK(json_valid(attributes_json)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE resource_templates(id TEXT PRIMARY KEY, key TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('counter','slot_track')), definition_json TEXT NOT NULL CHECK(json_valid(definition_json)), source TEXT NOT NULL CHECK(source IN ('class_2014','user')), version INTEGER NOT NULL CHECK(version >= 1));
    CREATE TABLE character_profiles(id TEXT PRIMARY KEY, name TEXT NOT NULL, ruleset TEXT NOT NULL CHECK(ruleset IN ('dnd5e_2014','homebrew')), class_id TEXT, level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 20), ability_scores_json TEXT CHECK(ability_scores_json IS NULL OR json_valid(ability_scores_json)), active_deck_id TEXT REFERENCES decks(id) ON DELETE SET NULL);
    CREATE TABLE resource_instances(id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES character_profiles(id) ON DELETE RESTRICT, template_id TEXT NOT NULL REFERENCES resource_templates(id) ON DELETE RESTRICT, overrides_json TEXT NOT NULL CHECK(json_valid(overrides_json)), current_state_json TEXT NOT NULL CHECK(json_valid(current_state_json)), UNIQUE(id, character_id));
    CREATE TABLE decks(id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES character_profiles(id) ON DELETE RESTRICT, name TEXT NOT NULL);
    CREATE TABLE deck_cards(deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE, card_id TEXT NOT NULL REFERENCES card_definitions(id) ON DELETE RESTRICT, position INTEGER NOT NULL CHECK(position >= 0), PRIMARY KEY(deck_id, card_id), UNIQUE(deck_id, position));
    CREATE TABLE card_bindings(id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES character_profiles(id) ON DELETE RESTRICT, card_id TEXT NOT NULL REFERENCES card_definitions(id) ON DELETE RESTRICT, cost_key TEXT NOT NULL, resource_instance_id TEXT NOT NULL, FOREIGN KEY(resource_instance_id, character_id) REFERENCES resource_instances(id, character_id) ON DELETE RESTRICT, UNIQUE(character_id, card_id, cost_key));
    CREATE TABLE play_events(id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES character_profiles(id) ON DELETE RESTRICT, event_type TEXT NOT NULL CHECK(event_type IN ('card_used','manual_adjustment','recovery','undo','profile_changed')), payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), occurred_at TEXT NOT NULL);
    CREATE TABLE settings(key TEXT PRIMARY KEY, value_json TEXT NOT NULL CHECK(json_valid(value_json)));
    CREATE INDEX idx_decks_character ON decks(character_id);
    CREATE INDEX idx_instances_character ON resource_instances(character_id);
    CREATE INDEX idx_events_character_time ON play_events(character_id, occurred_at);
    CREATE INDEX idx_cards_name ON card_definitions(name);
  `,
}, {
  version: 2,
  sql: `
    ALTER TABLE card_definitions ADD COLUMN archived_at TEXT;
    ALTER TABLE assets ADD COLUMN original_name TEXT;
    CREATE TABLE tags(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE card_tags(card_id TEXT NOT NULL REFERENCES card_definitions(id) ON DELETE CASCADE, tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY(card_id, tag_id));
    INSERT OR IGNORE INTO tags(id,name,created_at,updated_at)
      SELECT j.value,j.value,c.created_at,c.updated_at FROM card_definitions c,json_each(c.attributes_json,'$.tags') j WHERE j.type='text';
    INSERT OR IGNORE INTO card_tags(card_id,tag_id)
      SELECT c.id,j.value FROM card_definitions c,json_each(c.attributes_json,'$.tags') j WHERE j.type='text';
    CREATE INDEX idx_card_tags_tag ON card_tags(tag_id);
    CREATE INDEX idx_cards_active ON card_definitions(archived_at,created_at);
  `,
}, {
  version: 3,
  sql: `
    ALTER TABLE resource_templates ADD COLUMN archived_at TEXT;
    ALTER TABLE resource_instances ADD COLUMN archived_at TEXT;
    CREATE TABLE resource_revisions(character_id TEXT PRIMARY KEY REFERENCES character_profiles(id), revision INTEGER NOT NULL CHECK(revision>=0));
    INSERT INTO resource_revisions SELECT id,0 FROM character_profiles;
    CREATE TABLE resource_requests(request_id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES character_profiles(id), fingerprint TEXT NOT NULL, event_id TEXT REFERENCES play_events(id), occurred_at TEXT NOT NULL);
    CREATE TABLE resource_undos(target_event_id TEXT PRIMARY KEY REFERENCES play_events(id), undo_event_id TEXT NOT NULL UNIQUE REFERENCES play_events(id));
    CREATE INDEX idx_resource_requests_character ON resource_requests(character_id,occurred_at);
  `,
}, {
  version: 4,
  sql: `
    ALTER TABLE resource_instances ADD COLUMN preset_key TEXT;
    CREATE UNIQUE INDEX idx_preset_owner ON resource_instances(character_id,preset_key) WHERE preset_key IS NOT NULL AND archived_at IS NULL;
    CREATE TABLE character_cost_overrides(character_id TEXT NOT NULL REFERENCES character_profiles(id), card_id TEXT NOT NULL REFERENCES card_definitions(id), cast_options_json TEXT NOT NULL CHECK(json_valid(cast_options_json)), updated_at TEXT NOT NULL, PRIMARY KEY(character_id,card_id));
  `,
}, {
  version: 5,
  sql: `
    CREATE TABLE edit_batches(id TEXT PRIMARY KEY, label TEXT NOT NULL, action_json TEXT NOT NULL CHECK(json_valid(action_json)), summary_json TEXT NOT NULL CHECK(json_valid(summary_json)), patches_json TEXT NOT NULL CHECK(json_valid(patches_json)), created_at TEXT NOT NULL, restored_at TEXT);
    CREATE TABLE edit_requests(request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, batch_id TEXT NOT NULL REFERENCES edit_batches(id), occurred_at TEXT NOT NULL);
  `,
}, {
  version: 6,
  sql: `
    CREATE TABLE card_trash(card_id TEXT PRIMARY KEY REFERENCES card_definitions(id) ON DELETE CASCADE, deleted_at TEXT NOT NULL, batch_id TEXT, decks_json TEXT NOT NULL CHECK(json_valid(decks_json)));
    INSERT INTO card_trash SELECT c.id,c.archived_at,NULL,(SELECT COALESCE(json_group_array(json_object('id',d.id,'name',d.name,'characterId',d.character_id,'characterName',p.name,'position',dc.position)),'[]') FROM deck_cards dc JOIN decks d ON dc.deck_id=d.id JOIN character_profiles p ON p.id=d.character_id WHERE dc.card_id=c.id) FROM card_definitions c WHERE c.archived_at IS NOT NULL;
    CREATE TABLE trash_requests(request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, action_json TEXT NOT NULL CHECK(json_valid(action_json)), result_json TEXT NOT NULL CHECK(json_valid(result_json)), occurred_at TEXT NOT NULL);
    CREATE TABLE purged_card_ids(id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL);
    CREATE TABLE card_asset_history(card_id TEXT NOT NULL REFERENCES card_definitions(id) ON DELETE CASCADE, asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT, PRIMARY KEY(card_id,asset_id));
    INSERT OR IGNORE INTO card_asset_history SELECT id,image_asset_id FROM card_definitions WHERE image_asset_id IS NOT NULL;
    INSERT OR IGNORE INTO card_asset_history SELECT c.id,a.id FROM edit_batches b,json_each(b.patches_json) j JOIN card_definitions c ON c.id=json_extract(j.value,'$.before.id') JOIN assets a ON a.id=json_extract(j.value,'$.before.image_asset_id') WHERE json_extract(j.value,'$.table')='card_definitions';
    INSERT OR IGNORE INTO card_asset_history SELECT c.id,a.id FROM edit_batches b,json_each(b.patches_json) j JOIN card_definitions c ON c.id=json_extract(j.value,'$.after.id') JOIN assets a ON a.id=json_extract(j.value,'$.after.image_asset_id') WHERE json_extract(j.value,'$.table')='card_definitions';
    CREATE TABLE asset_cleanup(asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE, queued_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT);
    ALTER TABLE edit_batches ADD COLUMN invalidated_at TEXT;
    CREATE TRIGGER reject_purged_card BEFORE INSERT ON card_definitions WHEN EXISTS(SELECT 1 FROM purged_card_ids WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'Permanently deleted card ID'); END;
    CREATE TRIGGER prevent_card_id_change BEFORE UPDATE OF id ON card_definitions WHEN NEW.id<>OLD.id BEGIN SELECT RAISE(ABORT,'Card ID is immutable'); END;
    CREATE TRIGGER reject_pending_image_insert BEFORE INSERT ON card_definitions WHEN EXISTS(SELECT 1 FROM asset_cleanup WHERE asset_id=NEW.image_asset_id) BEGIN SELECT RAISE(ABORT,'Image deletion pending'); END;
    CREATE TRIGGER reject_pending_image_update BEFORE UPDATE OF image_asset_id ON card_definitions WHEN EXISTS(SELECT 1 FROM asset_cleanup WHERE asset_id=NEW.image_asset_id) BEGIN SELECT RAISE(ABORT,'Image deletion pending'); END;
    CREATE TRIGGER track_card_image_insert AFTER INSERT ON card_definitions WHEN NEW.image_asset_id IS NOT NULL BEGIN INSERT INTO card_asset_history SELECT NEW.id,NEW.image_asset_id WHERE NOT EXISTS(SELECT 1 FROM card_asset_history WHERE card_id=NEW.id AND asset_id=NEW.image_asset_id); END;
    CREATE TRIGGER track_card_image_update AFTER UPDATE OF image_asset_id ON card_definitions BEGIN INSERT INTO card_asset_history SELECT NEW.id,NEW.image_asset_id WHERE NEW.image_asset_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM card_asset_history WHERE card_id=NEW.id AND asset_id=NEW.image_asset_id); INSERT INTO card_asset_history SELECT NEW.id,OLD.image_asset_id WHERE OLD.image_asset_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM card_asset_history WHERE card_id=NEW.id AND asset_id=OLD.image_asset_id); END;
    CREATE TRIGGER reject_pending_image_history BEFORE INSERT ON card_asset_history WHEN EXISTS(SELECT 1 FROM asset_cleanup WHERE asset_id=NEW.asset_id) BEGIN SELECT RAISE(ABORT,'Image deletion pending'); END;
  `,
}];

export function transaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function migrate(db: DatabaseSync, fromVersion: number): void {
  transaction(db, () => {
    for (const migration of migrations.filter(m => m.version > fromVersion)) {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(migration.version, new Date().toISOString());
      db.exec(`PRAGMA user_version = ${migration.version}`);
    }
  });
}
