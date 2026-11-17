import { moveCardsToTrash } from './trash-store';
import { randomUUID } from 'node:crypto';
import {
  cardSchema, saveCardsSchema, libraryStateSchema, DEFAULT_LIBRARY_STATE, tagMutationSchema, idSchema,
  createProfileSchema, createDeckSchema, selectDeckSchema, deckCardsSchema,
  type CardDefinition, type Library, type LibraryState, type Tag, type ProfileSummary, type Deck,
} from '../src/shared/contracts';
import { normalizeText } from '../src/shared/library';
import type { AppStore } from './store';
import { transaction } from './migrations';
import { UserInputError } from './errors';

interface CardRow {
  id: string; name: string; image_asset_id: string | null; kind: string; spell_level: number | null;
  attributes_json: string; created_at: string; updated_at: string;
}
export interface AssetRecord {
  id: string; relative_path: string; sha256: string; mime_type: string;
  width: number; height: number; original_name: string | null;
}

export class LibraryStore {
  readonly db;
  constructor(store: AppStore) { this.db = store.db; }

  getState(): LibraryState {
    const row = this.db.prepare("SELECT value_json FROM settings WHERE key='library_state'").get() as { value_json: string } | undefined;
    return row ? libraryStateSchema.parse(JSON.parse(row.value_json)) : structuredClone(DEFAULT_LIBRARY_STATE);
  }
  private writeState(state: LibraryState): void {
    this.db.prepare("INSERT INTO settings(key,value_json) VALUES ('library_state',?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json").run(JSON.stringify(state));
  }
  saveState(input: unknown): LibraryState {
    const state = libraryStateSchema.parse(input);
    if (state.activeCharacterId && !this.db.prepare('SELECT id FROM character_profiles WHERE id=?').get(state.activeCharacterId)) throw new UserInputError('캐릭터를 찾을 수 없습니다.');
    if (state.viewScope === 'deck' && !state.activeCharacterId) throw new UserInputError('먼저 캐릭터를 선택해 주세요.');
    transaction(this.db, () => this.writeState(state));
    return state;
  }
  private readCard(row: CardRow): CardDefinition {
    const tags = this.db.prepare('SELECT tag_id FROM card_tags WHERE card_id=? ORDER BY rowid').all(row.id) as { tag_id: string }[];
    return cardSchema.parse({
      ...JSON.parse(row.attributes_json), id: row.id, name: row.name, kind: row.kind,
      imageAssetId: row.image_asset_id ?? undefined, spellLevel: row.spell_level ?? undefined,
      tags: tags.map(tag => tag.tag_id), createdAt: row.created_at, updatedAt: row.updated_at,
    });
  }
  private getCard(id: string): CardDefinition {
    const row = this.db.prepare('SELECT * FROM card_definitions WHERE id=? AND archived_at IS NULL').get(id) as CardRow | undefined;
    if (!row) throw new UserInputError('등록된 카드를 찾을 수 없습니다.');
    return this.readCard(row);
  }
  getLibrary(): Library {
    const warnings: string[] = [];
    const cards: CardDefinition[] = [];
    for (const row of this.db.prepare('SELECT * FROM card_definitions WHERE archived_at IS NULL ORDER BY created_at,rowid').all() as unknown as CardRow[]) {
      try { cards.push(this.readCard(row)); }
      catch { warnings.push(`“${row.name}” 카드 정보를 읽지 못했습니다. 저장 데이터는 보존되어 있습니다.`); }
    }
    const tags = this.db.prepare(`SELECT t.id,t.name,COUNT(c.id) AS usageCount FROM tags t
      LEFT JOIN card_tags ct ON ct.tag_id=t.id LEFT JOIN card_definitions c ON c.id=ct.card_id AND c.archived_at IS NULL
      GROUP BY t.id ORDER BY t.name`).all() as unknown as Tag[];
    const profileRows = this.db.prepare('SELECT id,name,active_deck_id,class_id,level,ruleset FROM character_profiles ORDER BY rowid').all() as { id: string; name: string; active_deck_id: string | null; class_id:string|null; level:number;ruleset:'dnd5e_2014'|'homebrew' }[];
    const profiles: ProfileSummary[] = profileRows.map(row => ({ id: row.id, name: row.name, activeDeckId: row.active_deck_id ?? undefined,classId:row.class_id??undefined,level:row.level,ruleset:row.ruleset }));
    const decks = (this.db.prepare('SELECT id,character_id,name FROM decks ORDER BY rowid').all() as { id: string; character_id: string; name: string }[]).map(row => ({
      id: row.id, characterId: row.character_id, name: row.name,
      cardIds: (this.db.prepare('SELECT dc.card_id FROM deck_cards dc JOIN card_definitions c ON c.id=dc.card_id WHERE dc.deck_id=? AND c.archived_at IS NULL ORDER BY dc.position').all(row.id) as { card_id: string }[]).map(v => v.card_id),
    } satisfies Deck));
    return { cards, tags, profiles, decks, libraryState: this.getState(), warnings };
  }
  saveCards(input: unknown, withinTransaction = false): Library {
    const { cards: drafts, registrationTarget, initialRules } = saveCardsSchema.parse(input);
    if (initialRules) throw new UserInputError('초기 사용 규칙은 통합 등록 경로에서 저장해 주세요.');
    const ids = drafts.flatMap(card => card.id ? [card.id] : []);
    if (new Set(ids).size !== ids.length) throw new UserInputError('같은 카드를 한 번에 두 번 수정할 수 없습니다.');
    const execute = () => {
      const state = this.getState();
      const profile = state.activeCharacterId ? this.db.prepare('SELECT id,active_deck_id FROM character_profiles WHERE id=?').get(state.activeCharacterId) as { id: string; active_deck_id: string | null } | undefined : undefined;
      const currentTarget = profile?.active_deck_id ? { characterId: profile.id, deckId: profile.active_deck_id } : null;
      if (drafts.some(card => !card.id) && registrationTarget !== undefined && (registrationTarget?.characterId !== currentTarget?.characterId || registrationTarget?.deckId !== currentTarget?.deckId)) throw new UserInputError('활성 캐릭터 또는 덱이 바뀌었습니다. 등록 창을 다시 열어 목적지를 확인해 주세요.');
      const target = registrationTarget === undefined ? currentTarget : registrationTarget;
      if (drafts.some(card => !card.id) && target && !this.db.prepare('SELECT id FROM decks WHERE id=? AND character_id=?').get(target.deckId, target.characterId)) throw new UserInputError('선택한 덱의 소유 캐릭터가 일치하지 않습니다.');
      for (const draft of drafts) {
        const existing = draft.id ? this.getCard(draft.id) : undefined;
        const imageAssetId = draft.imageAssetId ?? existing?.imageAssetId;
        if (imageAssetId && !this.getAsset(imageAssetId)) throw new UserInputError('가져온 이미지를 찾을 수 없습니다. 이미지를 다시 선택해 주세요.');
        for (const tag of draft.tags) if (!this.db.prepare('SELECT id FROM tags WHERE id=?').get(tag)) throw new UserInputError('삭제되었거나 존재하지 않는 태그입니다.');
        const now = new Date().toISOString();
        const card = cardSchema.parse({
          ...draft, id: existing?.id ?? randomUUID(), imageAssetId,
          roles: [...new Set(draft.roles)], actions: [...new Set(draft.actions)], tags: [...new Set(draft.tags)],
          costStatus: existing?.costStatus,
          castOptions: existing?.castOptions ?? [{ id: randomUUID(), label: '일반 사용', costs: [] }],
          createdAt: existing?.createdAt ?? now, updatedAt: now,
        });
        const { id, name, kind, spellLevel, createdAt, updatedAt, imageAssetId: assetId, ...attributes } = card;
        this.db.prepare(`INSERT INTO card_definitions(id,name,image_asset_id,kind,spell_level,attributes_json,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,image_asset_id=excluded.image_asset_id,
          kind=excluded.kind,spell_level=excluded.spell_level,attributes_json=excluded.attributes_json,updated_at=excluded.updated_at`)
          .run(id, name, assetId ?? null, kind, spellLevel ?? null, JSON.stringify(attributes), createdAt, updatedAt);
        this.db.prepare('DELETE FROM card_tags WHERE card_id=?').run(id);
        const insertTag = this.db.prepare('INSERT INTO card_tags(card_id,tag_id) VALUES (?,?)');
        for (const tagId of card.tags) insertTag.run(id, tagId);
        if (!existing && target) this.db.prepare('INSERT INTO deck_cards(deck_id,card_id,position) VALUES (?,?,(SELECT COALESCE(MAX(position),-1)+1 FROM deck_cards WHERE deck_id=?))').run(target.deckId, id, target.deckId);
      }
    };
    if (withinTransaction) execute(); else transaction(this.db, execute);
    return this.getLibrary();
  }
  archiveCard(input: unknown): Library {
    const id = idSchema.parse(input);
    this.getCard(id);
    transaction(this.db, () => moveCardsToTrash(this.db,[id],randomUUID()));
    return this.getLibrary();
  }
  saveTag(input: unknown): Library {
    const value = tagMutationSchema.parse(input);
    const tags = this.db.prepare('SELECT id,name FROM tags').all() as { id: string; name: string }[];
    if (value.id && !tags.some(tag => tag.id === value.id)) throw new UserInputError('태그를 찾을 수 없습니다.');
    if (tags.some(tag => tag.id !== value.id && normalizeText(tag.name) === normalizeText(value.name))) throw new UserInputError('같은 이름의 태그가 이미 있습니다.');
    const now = new Date().toISOString();
    transaction(this.db, () => this.db.prepare(`INSERT INTO tags(id,name,created_at,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at`).run(value.id ?? randomUUID(), value.name, now, now));
    return this.getLibrary();
  }
  deleteTag(input: unknown): Library {
    const id = idSchema.parse(input);
    if (!this.db.prepare('SELECT id FROM tags WHERE id=?').get(id)) throw new UserInputError('태그를 찾을 수 없습니다.');
    transaction(this.db, () => {
      const affected = this.db.prepare('SELECT card_id FROM card_tags WHERE tag_id=?').all(id) as { card_id: string }[];
      this.db.prepare('DELETE FROM tags WHERE id=?').run(id);
      for (const { card_id } of affected) {
        this.db.prepare(`UPDATE card_definitions SET attributes_json=json_set(attributes_json,'$.tags',json((SELECT json_group_array(tag_id) FROM card_tags WHERE card_id=?))),updated_at=? WHERE id=?`)
          .run(card_id, new Date().toISOString(), card_id);
      }
      const state = this.getState();
      this.writeState({ ...state, tagIds: state.tagIds.filter(tagId => tagId !== id) });
    });
    return this.getLibrary();
  }
  createProfile(input: unknown): Library {
    const { name } = createProfileSchema.parse(input);
    transaction(this.db, () => {
      const id = randomUUID(); const deckId = randomUUID();
      this.db.prepare("INSERT INTO character_profiles(id,name,ruleset,level) VALUES (?,?,'dnd5e_2014',1)").run(id, name);
      this.db.prepare('INSERT INTO decks(id,character_id,name) VALUES (?,?,?)').run(deckId, id, '기본 덱');
      this.db.prepare('UPDATE character_profiles SET active_deck_id=? WHERE id=?').run(deckId, id);
      this.writeState({ ...this.getState(), activeCharacterId: id, viewScope: 'deck' });
    });
    return this.getLibrary();
  }
  createDeck(input: unknown): Library {
    const { characterId, name } = createDeckSchema.parse(input);
    if (!this.db.prepare('SELECT id FROM character_profiles WHERE id=?').get(characterId)) throw new UserInputError('캐릭터를 찾을 수 없습니다.');
    transaction(this.db, () => {
      const id = randomUUID();
      this.db.prepare('INSERT INTO decks(id,character_id,name) VALUES (?,?,?)').run(id, characterId, name);
      this.db.prepare('UPDATE character_profiles SET active_deck_id=? WHERE id=?').run(id, characterId);
      this.writeState({ ...this.getState(), activeCharacterId: characterId, viewScope: 'deck' });
    });
    return this.getLibrary();
  }
  selectDeck(input: unknown): Library {
    const { characterId, deckId } = selectDeckSchema.parse(input);
    if (!this.db.prepare('SELECT id FROM decks WHERE id=? AND character_id=?').get(deckId, characterId)) throw new UserInputError('이 캐릭터의 덱이 아닙니다.');
    transaction(this.db, () => this.db.prepare('UPDATE character_profiles SET active_deck_id=? WHERE id=?').run(deckId, characterId));
    return this.getLibrary();
  }
  setDeckCards(input: unknown): Library {
    const { deckId, cardIds } = deckCardsSchema.parse(input);
    if (!this.db.prepare('SELECT id FROM decks WHERE id=?').get(deckId)) throw new UserInputError('덱을 찾을 수 없습니다.');
    if (new Set(cardIds).size !== cardIds.length) throw new UserInputError('덱에 같은 카드를 두 번 넣을 수 없습니다.');
    transaction(this.db, () => {
      const existing = new Set((this.db.prepare('SELECT card_id FROM deck_cards WHERE deck_id=?').all(deckId) as { card_id: string }[]).map(row => row.card_id));
      // Preserve already-linked archived references while editing other deck cards.
      for (const id of cardIds) if (!existing.has(id)) this.getCard(id);
      this.db.prepare('DELETE FROM deck_cards WHERE deck_id=?').run(deckId);
      cardIds.forEach((id, position) => this.db.prepare('INSERT INTO deck_cards(deck_id,card_id,position) VALUES (?,?,?)').run(deckId, id, position));
    });
    return this.getLibrary();
  }
  getAsset(id: string): AssetRecord | undefined {
    return this.db.prepare('SELECT * FROM assets WHERE id=? AND NOT EXISTS(SELECT 1 FROM asset_cleanup WHERE asset_id=assets.id)').get(id) as unknown as AssetRecord | undefined;
  }
  addAsset(asset: AssetRecord): void {
    transaction(this.db, () => this.db.prepare('INSERT INTO assets(id,relative_path,sha256,mime_type,width,height,original_name) VALUES (?,?,?,?,?,?,?)')
      .run(asset.id, asset.relative_path, asset.sha256, asset.mime_type, asset.width, asset.height, asset.original_name));
  }
}
