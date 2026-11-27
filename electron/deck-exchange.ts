import { createHash, randomUUID } from 'node:crypto';
import { open, rename, rm, writeFile } from 'node:fs/promises';
import { cardSchema, resourceMatchKeySchema, type CardDefinition, type CastOption } from '../src/shared/contracts';
import { castingLevels, resolveCostResource, slotLevels } from '../src/shared/casting';
import {
  DECK_FORMAT, DECK_VERSION, MAX_DECK_BYTES, deckApplySchema, deckDocumentSchema,
  type DeckDocument, type DeckImportResult, type DeckNotice, type DeckPreview,
} from '../src/shared/deck-exchange';
import { normalizeText } from '../src/shared/library';
import type { ResourceSnapshot, ResourceView } from '../src/shared/resources';
import type { AssetService } from './assets';
import { UserInputError } from './errors';
import type { LibraryStore } from './library-store';
import { transaction } from './migrations';
import type { ResourceStore } from './resource-store';

type Cost = CastOption['costs'][number];
type ExchangeCard = DeckDocument['cards'][number];
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function parseDeckDocument(input: unknown): DeckDocument {
  if (typeof input !== 'object' || input === null || !('format' in input) || input.format !== DECK_FORMAT) {
    throw new UserInputError('DnD TCG-fy 덱 JSON 파일을 선택해 주세요.');
  }
  if (!('schemaVersion' in input) || input.schemaVersion !== DECK_VERSION) throw new UserInputError('지원하지 않는 덱 JSON 버전입니다.');
  const result = deckDocumentSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new UserInputError(`덱 JSON 내용을 확인해 주세요. ${issue.path.join('.')} ${issue.code === 'custom' ? issue.message : ''}`.trim());
  }
  return result.data;
}

export async function readDeckDocument(path: string): Promise<DeckDocument> {
  let contents: string;
  try {
    const file = await open(path, 'r');
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_DECK_BYTES) throw new UserInputError('덱 JSON은 16 MiB 이하의 일반 파일이어야 합니다.');
      const buffer = Buffer.alloc(info.size + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset !== info.size) throw new UserInputError('읽는 동안 파일이 변경됐습니다. 다시 선택해 주세요.');
      contents = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset));
    } finally { await file.close(); }
  } catch (error) {
    if (error instanceof UserInputError) throw error;
    throw new UserInputError('덱 파일을 UTF-8로 읽을 수 없습니다. 파일과 읽기 권한을 확인해 주세요.');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(contents); }
  catch { throw new UserInputError('올바른 JSON 형식의 덱 파일이 아닙니다.'); }
  return parseDeckDocument(parsed);
}

function remapRules(shared: CastOption[], character: CastOption[] | undefined, id: (prefix: string, index: number) => string) {
  const costs = new Map<string, string>();
  const options = new Map<string, string>();
  const map = (rules: CastOption[]) => rules.map(option => {
    if (!options.has(option.id)) options.set(option.id, id('option', options.size + 1));
    return { ...option, id: options.get(option.id)!, costs: option.costs.map(cost => {
      if (!costs.has(cost.costKey)) costs.set(cost.costKey, id('cost', costs.size + 1));
      return { ...cost, costKey: costs.get(cost.costKey)! };
    }) };
  });
  return { castOptions: map(shared), characterRules: character && map(character) };
}

function portableBinding(cost: Cost, resource?: ResourceView): Cost {
  const family = resource?.kind === 'slot_track' ? resource.template.slotKind ?? 'generic' : undefined;
  const fallback = family ?? (resource?.kind === 'counter' ? 'counter' : cost.reconnect ?? 'unknown');
  const key = resource?.template.matchKey ?? (resource?.presetKey?.startsWith('2014:') ? resource.template.key : undefined);
  const compatible = cost.type === 'slot' ? family === cost.slotSelection
    : cost.slotLevel === undefined ? resource?.kind === 'counter' : !!family;
  if (!compatible || !key || !resourceMatchKeySchema.safeParse(key).success || resource?.overrides.scope !== 'character' || resource.inactive) {
    return { ...cost, reconnect: fallback };
  }
  return { ...cost, reconnect: undefined, requirement: { key, kind: family ? 'track' : 'counter', ...(family ? { slotKind: family } : {}) } };
}

function toCharacterRules(card: CardDefinition, snapshot: ResourceSnapshot) {
  const bindings = new Map(snapshot.bindings.filter(binding => binding.cardId === card.id).map(binding => [binding.costKey, binding.resourceInstanceId]));
  const override = snapshot.costOverrides?.find(item => item.cardId === card.id);
  const effective = override?.castOptions ?? card.castOptions;
  if (!override && !effective.some(option => option.costs.some(cost => bindings.has(cost.costKey)))) return;
  return effective.map(option => ({
    ...option, costs: option.costs.map(cost => bindings.has(cost.costKey)
      ? portableBinding(cost, snapshot.resources.find(resource => resource.id === bindings.get(cost.costKey))) : cost),
  }));
}

function stableOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableOrder);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([,item]) => item !== undefined).sort(([a],[b]) => a.localeCompare(b))
    .map(([key,item]) => [key,stableOrder(item)]));
  return value;
}

function cardIdentity(card: ExchangeCard, tagNames: Map<string,string>) {
  const { ref, tags, castOptions, characterRules, ownedResources, ...metadata } = card;
  void ref;
  const rules = remapRules(castOptions, characterRules, (prefix,index) => prefix + index);
  const common = { ...metadata, tags: tags.map(tag => normalizeText(tagNames.get(tag) ?? tag)).sort(),
    ownedResources: ownedResources?.map(({id,...definition}) => { void id; return definition; }), castOptions: rules.castOptions };
  return { common: digest(stableOrder(common)), full: digest(stableOrder({ ...common, characterRules: rules.characterRules })) };
}

type AppendChoice = { card: ExchangeCard; existingId?: string };
interface ExchangePlan {
  identity: string;
  existing?: { id: string; name: string };
  choices: AppendChoice[];
  preview: Omit<DeckPreview,'token'>;
  fingerprint: string;
}

function noticesFor(card: ExchangeCard, hasImage: boolean, snapshot?: ResourceSnapshot): DeckNotice[] {
  const notices: DeckNotice[] = [];
  if (card.image && !hasImage) notices.push({ card: card.name, kind: 'image', detail: '같은 원본 이미지가 없습니다. 기본 카드로 표시하며 정보 수정에서 이미지를 연결할 수 있습니다.' });
  const rules = card.characterRules ?? card.castOptions;
  const reconnect = new Set<string>();
  for (const option of rules) {
    if (option.casting || option.costs.some(cost => cost.type === 'slot')) {
      try {
        if (!castingLevels(card, option).length) reconnect.add('카드의 주문 레벨과 시전 범위를 확인해 주세요.');
      } catch (error) { reconnect.add((error as Error).message); }
    }
  }
  for (const option of rules) for (const cost of option.costs) {
    if (cost.type === 'slot' && card.spellLevel === 0) continue;
    if (cost.reconnect || !cost.requirement && !(cost.type === 'slot' && cost.autoBind)) {
      reconnect.add('직접 연결해야 하는 비용이 있습니다. 카드 사용 규칙에서 자원을 선택해 주세요.');
      continue;
    }
    if (!snapshot) continue;
    try {
      const resource = resolveCostResource(card.ref, cost, snapshot.resources, []);
      const level = cost.type === 'slot' ? undefined : cost.slotLevel;
      if (cost.type === 'slot' && !slotLevels({ id: card.ref, kind: card.kind, spellLevel: card.spellLevel }, option, cost.costKey, snapshot.resources, []).length
        || level !== undefined && !(resource.capacityByLevel?.[String(level)] ?? 0)) {
        reconnect.add('현재 캐릭터에 필요한 슬롯 레벨이 없습니다. 해당 레벨을 획득하면 사용할 수 있습니다.');
      }
    } catch (error) {
      reconnect.add((error as Error).message);
    }
  }
  return [...notices, ...[...reconnect].map(detail => ({ card: card.name, kind: 'reconnect' as const, detail }))];
}

type Draft = { token: string; characterId: string; deckId?: string; deck: DeckDocument; fingerprint: string };
export class DeckExchange {
  private draft?: Draft;
  constructor(private library: LibraryStore, private resources: ResourceStore, private assets: AssetService) {}

  private portableCard(card: CardDefinition, snapshot: ResourceSnapshot, ref: string, tags: string[]): ExchangeCard {
    const asset = card.imageAssetId ? this.library.getAsset(card.imageAssetId) : undefined;
    const { name, kind, roles, actions, range, description, spellLevel, concentration, ritual, upcastEffect, imageMode, costStatus } = card;
    return {
      ref, name, kind, roles, actions, range, description, spellLevel, concentration, ritual, upcastEffect, imageMode,
      image: asset ? { sha256: asset.sha256 } : card.imageReference, costStatus, tags,
      ownedResources: card.ownedResources?.map((entry,n) => ({ ...entry, id: `00000000-0000-4000-8000-${String(n + 1).padStart(12,'0')}` })),
      ...remapRules(card.castOptions, toCharacterRules(card,snapshot), (prefix,n) => prefix + n),
    };
  }

  async export(deckId: string, path: string) {
    const source = this.library.getLibrary();
    const deck = source.decks.find(item => item.id === deckId);
    if (!deck) throw new UserInputError('내보낼 덱을 찾을 수 없습니다.');
    const snapshot = this.resources.snapshot(deck.characterId);
    const sourceCards = new Map(source.cards.map(card => [card.id, card]));
    const sourceTags = new Map(source.tags.map(tag => [tag.id, tag]));
    const tags = new Map<string, { ref: string; name: string }>();
    const cards = deck.cardIds.map((cardId, index): ExchangeCard => {
      const card = sourceCards.get(cardId);
      if (!card) throw new UserInputError('덱에 읽을 수 없는 카드가 있어 내보내지 않았습니다.');
      const tagRefs = card.tags.map(tagId => {
        const tag = sourceTags.get(tagId);
        if (!tag) throw new UserInputError('덱에 읽을 수 없는 태그가 있습니다.');
        if (!tags.has(tagId)) tags.set(tagId, { ref: `tag${tags.size + 1}`, name: tag.name });
        return tags.get(tagId)!.ref;
      });
      return this.portableCard(card,snapshot,`card${index + 1}`,tagRefs);
    });
    const payload = parseDeckDocument({ format: DECK_FORMAT, schemaVersion: DECK_VERSION, name: deck.name, tags: [...tags.values()], cards });
    const json = Buffer.from(JSON.stringify(payload, null, 2) + '\n', 'utf8');
    if (json.length > MAX_DECK_BYTES) throw new UserInputError('덱 파일이 16 MiB를 초과합니다.');
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, json, { flag: 'wx' });
      await rename(temporary, path);
    } finally { await rm(temporary, { force: true }).catch(() => undefined); }
    const notices = cards.flatMap(card => noticesFor(card, !card.image));
    return { path, cards: cards.length, notices: notices.map(notice => notice.kind === 'image'
      ? { ...notice, detail: 'JSON에는 이미지 참조만 포함됩니다. 받는 라이브러리에 같은 원본이 있어야 합니다.' } : notice) };
  }

  private async images(deck: DeckDocument) {
    const result = new Map<string, string>();
    const query = this.library.db.prepare('SELECT id FROM assets WHERE sha256=? ORDER BY id');
    for (const sha of new Set(deck.cards.flatMap(card => card.image ? [card.image.sha256] : []))) {
      for (const row of query.all(sha) as { id: string }[]) {
        if (!await this.assets.matchesOriginal(row.id, sha)) continue;
        result.set(sha, row.id);
        break;
      }
    }
    return result;
  }

  private appendPlan(targetId: string, characterId: string, characterName: string, deck: DeckDocument, identity: string, images: Map<string,string>, snapshot: ResourceSnapshot): ExchangePlan {
    const db = this.library.db;
    const target = db.prepare('SELECT name FROM decks WHERE id=? AND character_id=? AND id NOT IN (SELECT deck_id FROM deck_trash)').get(targetId,characterId) as { name: string } | undefined;
    if (!target) throw new UserInputError('선택한 캐릭터의 활성 덱을 다시 골라 주세요.');
    const memberIds = (db.prepare('SELECT card_id FROM deck_cards WHERE deck_id=? ORDER BY position').all(targetId) as { card_id: string }[]).map(row => row.card_id);
    const members = new Set(memberIds);
    const receipt = db.prepare('SELECT 1 FROM deck_exchange_appends WHERE deck_id=? AND digest=?').get(targetId,identity);
    const library = this.library.getLibrary();
    const localTags = new Map(library.tags.map(tag => [tag.id,tag.name]));
    const importedTags = new Map(deck.tags.map(tag => [tag.ref,tag.name]));
    const cardsByCommon = new Map<string,{ id: string; full: string }[]>();
    const localNames = new Set(library.cards.map(card => normalizeText(card.name)));
    for (const card of library.cards) {
      const key = cardIdentity(this.portableCard(card,snapshot,'local',card.tags),localTags);
      const matches = cardsByCommon.get(key.common) ?? [];
      matches.push({id:card.id,full:key.full});
      cardsByCommon.set(key.common,matches);
    }
    const choices: AppendChoice[] = [];
    const added: string[] = [];
    const duplicates: string[] = [];
    const conflicts: NonNullable<DeckPreview['append']>['conflicts'] = [];
    const seen = new Set<string>();
    for (const card of deck.cards) {
      const key = cardIdentity(card,importedTags);
      const same = cardsByCommon.get(key.common) ?? [];
      const exact = same.filter(item => item.full === key.full);
      if (receipt || seen.has(key.full) || exact.some(item => members.has(item.id))) {
        duplicates.push(card.name);
      } else if (exact.length === 1 && !same.some(item => members.has(item.id))) {
        choices.push({card,existingId:exact[0].id});
        added.push(card.name);
      } else if (same.length) {
        conflicts.push({card:card.name,detail:'같은 카드 정의의 후보가 여러 개이거나 캐릭터 비용이 다릅니다. 기존 설정을 보존하고 건너뜁니다.'});
      } else {
        if (localNames.has(normalizeText(card.name))) conflicts.push({card:card.name,detail:'같은 이름의 다른 정의가 있습니다. 별도 카드로 추가합니다.'});
        choices.push({card});
        added.push(card.name);
      }
      seen.add(key.full);
    }
    const notices = choices.flatMap(({card}) => noticesFor(card,!!card.image && images.has(card.image.sha256),snapshot));
    const preview = {characterName,name:target.name,cards:deck.cards.map(card => card.name),notices,existing:!!receipt,
      duplicateCardNames:duplicates.length,renamed:false,append:{added,duplicates,conflicts}};
    return {identity,choices,preview,existing:receipt?{id:targetId,name:target.name}:undefined,
      fingerprint:digest({preview,memberIds,choices:choices.map(item=>[item.card.ref,item.existingId]),images:[...images]})};
  }

  private plan(characterId: string, deck: DeckDocument, images: Map<string, string>, targetId?: string): ExchangePlan {
    const db = this.library.db;
    const profile = db.prepare('SELECT name FROM character_profiles WHERE id=? AND id NOT IN (SELECT profile_id FROM profile_trash)').get(characterId) as { name: string } | undefined;
    if (!profile) throw new UserInputError('가져올 캐릭터를 다시 선택해 주세요.');
    const identity = digest(deck);
    const snapshot = this.resources.snapshot(characterId);
    for (const [sha, id] of images) if (!this.library.getAsset(id)) images.delete(sha);
    if (targetId) return this.appendPlan(targetId,characterId,profile.name,deck,identity,images,snapshot);
    const existing = db.prepare('SELECT d.id,d.name FROM deck_exchange_imports r JOIN decks d ON d.id=r.deck_id WHERE r.character_id=? AND r.digest=?')
      .get(characterId, identity) as { id: string; name: string } | undefined;
    if (existing && db.prepare('SELECT 1 FROM deck_trash WHERE deck_id=?').get(existing.id))
      throw new UserInputError('이미 가져온 덱이 휴지통에 있습니다. 먼저 덱을 복원해 주세요.');
    const deckNames = new Set((db.prepare('SELECT name FROM decks WHERE character_id=?').all(characterId) as { name: string }[]).map(item => normalizeText(item.name)));
    let name = existing?.name ?? deck.name;
    for (let n = 2; !existing && deckNames.has(normalizeText(name)); n++) {
      const suffix = ` (${n})`;
      name = deck.name.slice(0, 100 - suffix.length) + suffix;
    }
    const cardNames = new Set((db.prepare('SELECT name FROM card_definitions WHERE archived_at IS NULL').all() as { name: string }[]).map(card => normalizeText(card.name)));
    const duplicateCardNames = deck.cards.filter(card => cardNames.has(normalizeText(card.name))).length;
    const notices = deck.cards.flatMap(card => noticesFor(card, !!card.image && images.has(card.image.sha256), snapshot));
    const preview = { characterName: profile.name, name, cards: deck.cards.map(card => card.name), notices, existing: !!existing, duplicateCardNames, renamed: !existing && name !== deck.name };
    return { identity, existing, choices:deck.cards.map(card=>({card})), preview, fingerprint: digest({ preview, existing, images: [...images] }) };
  }

  async inspect(characterId: string, path: string, deckId?: string): Promise<DeckPreview> {
    this.draft = undefined;
    const deck = await readDeckDocument(path);
    const images = await this.images(deck);
    const token = randomUUID();
    const plan = this.plan(characterId, deck, images, deckId);
    this.draft = { token, characterId, deckId, deck, fingerprint: plan.fingerprint };
    return { ...plan.preview, token };
  }

  async apply(input: unknown): Promise<DeckImportResult> {
    const { token, characterId, deckId } = deckApplySchema.parse(input);
    const draft = this.draft;
    if (!draft || draft.token !== token || draft.characterId !== characterId || draft.deckId !== deckId) throw new UserInputError('가져올 파일과 캐릭터를 다시 확인해 주세요.');
    const { deck } = draft;
    const images = await this.images(deck);
    if (this.draft !== draft) throw new UserInputError('미리보기가 변경됐습니다. 다시 확인해 주세요.');
    const result = transaction(this.library.db, () => {
      const plan = this.plan(characterId, deck, images, deckId);
      if (!plan.existing && plan.fingerprint !== draft.fingerprint) throw new UserInputError('대상 덱, 자원 또는 이미지가 변경됐습니다. 파일을 다시 열어 확인해 주세요.');
      // A receipt returns the existing import for this character, without rewriting its current state.
      if (plan.existing) return { deckId: plan.existing.id, name: plan.existing.name, replayed: true, notices: plan.preview.notices };
      const db = this.library.db;
      const now = new Date().toISOString();
      const existingTags = new Map((db.prepare('SELECT id,name FROM tags ORDER BY rowid').all() as { id: string; name: string }[])
        .map(tag => [normalizeText(tag.name), tag.id]));
      const usedTags = new Set(plan.choices.filter(choice=>!choice.existingId).flatMap(({card})=>card.tags));
      const tagIds = new Map(deck.tags.filter(tag=>!deckId||usedTags.has(tag.ref)).map(tag => {
        const existing = existingTags.get(normalizeText(tag.name));
        const id = existing ?? randomUUID();
        if (!existing) db.prepare('INSERT INTO tags(id,name,created_at,updated_at) VALUES (?,?,?,?)').run(id, tag.name, now, now);
        return [tag.ref, id];
      }));
      const destination = deckId ?? randomUUID();
      if (!deckId) db.prepare('INSERT INTO decks(id,character_id,name) VALUES (?,?,?)').run(destination, characterId, plan.preview.name);
      const insertCard = db.prepare('INSERT INTO card_definitions(id,name,image_asset_id,kind,spell_level,attributes_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)');
      const insertTag = db.prepare('INSERT INTO card_tags(card_id,tag_id) VALUES (?,?)');
      const insertMember = db.prepare('INSERT INTO deck_cards(deck_id,card_id,position) VALUES (?,?,?)');
      const insertOverride = db.prepare('INSERT INTO character_cost_overrides VALUES (?,?,?,?)');
      let position = Number(db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS position FROM deck_cards WHERE deck_id=?').get(destination)!.position);
      for (const {card,existingId} of plan.choices) {
        if (existingId) { insertMember.run(destination,existingId,position++); continue; }
        const { image, tags, castOptions, characterRules, ownedResources, ...fields } = card;
        const rules = remapRules(castOptions, characterRules, () => randomUUID());
        const id = randomUUID();
        const imageAssetId = image && images.get(image.sha256);
        // Construct from the allowlisted portable fields. The file's card reference has no DB meaning.
        const { ref, ...metadata } = fields;
        void ref;
        const row = cardSchema.parse({
          ...metadata, id, imageAssetId, imageReference: imageAssetId ? undefined : image, tags: tags.map(tag => tagIds.get(tag)),
          createdAt: now, updatedAt: now, castOptions: rules.castOptions,
          ownedResources: ownedResources?.map(definition => ({ ...definition, id: randomUUID() })),
        });
        const { id: rowId, name, kind, spellLevel, imageAssetId: assetId, createdAt, updatedAt, ...attributes } = row;
        insertCard.run(rowId, name, assetId ?? null, kind, spellLevel ?? null, JSON.stringify(attributes), createdAt, updatedAt);
        for (const tagId of row.tags) insertTag.run(id, tagId);
        if (rules.characterRules) insertOverride.run(characterId, id, JSON.stringify(rules.characterRules), now);
        insertMember.run(destination, id, position++);
      }
      if (deckId) db.prepare('INSERT INTO deck_exchange_appends VALUES (?,?)').run(destination,plan.identity);
      else db.prepare('INSERT INTO deck_exchange_imports VALUES (?,?,?)').run(characterId,plan.identity,destination);
      return { deckId:destination, name:plan.preview.name, replayed:false, notices:plan.preview.notices, added:deckId?plan.choices.length:undefined };
    });
    return { ...result, library: this.library.getLibrary() };
  }
}
