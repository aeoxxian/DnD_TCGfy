import { createHash, randomUUID } from 'node:crypto';
import { open, rename, rm, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { cardSchema, resourceMatchKeySchema, type CardDefinition, type CastOption } from '../src/shared/contracts';
import { castingLevels, resolveCostResource, slotLevels } from '../src/shared/casting';
import {
  DECK_FORMAT, DECK_VERSION, MAX_DECK_BYTES, deckApplySchema, deckDocumentSchema,
  type DeckDocument, type DeckImportResult, type DeckNotice, type DeckPreview,
} from '../src/shared/deck-exchange';
import { normalizeText } from '../src/shared/library';
import type { ResourceSnapshot, ResourceView } from '../src/shared/resources';
import type { AssetService, PreparedOriginal } from './assets';
import { readDeckZip, writeDeckZip } from './deck-zip';
import { UserInputError } from './errors';
import type { LibraryStore } from './library-store';
import { transaction } from './migrations';
import type { ResourceStore } from './resource-store';
import { restoreCardFromTrash } from './trash-store';
import type { TrashDeck } from '../src/shared/trash';

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
  const { ref, tags, castOptions, characterRules, ownedResources, costStatus, ...metadata } = card;
  void ref;
  const rules = remapRules(castOptions, characterRules, (prefix,index) => prefix + index);
  const design = { ...metadata, tags: tags.map(tag => normalizeText(tagNames.get(tag) ?? tag)).sort(),
    ownedResources: ownedResources?.map(({id,...definition}) => { void id; return definition; }) };
  return { design:digest(stableOrder(design)),
    full:digest(stableOrder({ ...design, costStatus, castOptions:rules.castOptions, characterRules:rules.characterRules })) };
}

type AppendChoice = { card: ExchangeCard; existingId?: string; restore?: boolean };
const deckHashes = (deck: DeckDocument) => new Set(deck.cards.flatMap(card => card.image ? [card.image.sha256] : []));
interface ExchangePlan {
  identity: string;
  existing?: { id: string; name: string };
  choices: AppendChoice[];
  matches?: Map<string,string>;
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

type Draft = { token: string; characterId: string; deckId?: string; deck: DeckDocument; fingerprint: string; newFingerprint?:string; zipPath?: string; archivedDecks?: DeckPreview['archivedDecks'] };
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

  async export(deckId: string, path: string, format: 'json' | 'zip' = 'json') {
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
    const originals = new Map<string, {path:string; mime:string; size:number}>();
    try {
      if (format === 'zip') {
        for (const [sha,id] of await this.assets.findOriginals(deckHashes(payload))) {
          const original = await this.assets.originalFile(id,sha);
          if (original && ['image/png','image/jpeg','image/webp'].includes(original.mime)) originals.set(sha,original);
        }
        await writeDeckZip(temporary,json,originals);
      } else await writeFile(temporary, json, { flag: 'wx' });
      await rename(temporary, path);
    } finally { await rm(temporary, { force: true }).catch(() => undefined); }
    const notices = cards.flatMap(card => noticesFor(card, !card.image || originals.has(card.image.sha256)));
    return { path, cards: cards.length, notices: notices.map(notice => notice.kind === 'image' && format === 'json'
      ? { ...notice, detail: 'JSON에는 이미지 참조만 포함됩니다. 받는 라이브러리에 같은 원본이 있어야 합니다.' } : notice) };
  }

  private archivedCards(snapshot: ResourceSnapshot, tags: Map<string,string>) {
    return this.library.trashedCards().map(card => ({
      card, ...cardIdentity(this.portableCard(card,snapshot,'local',card.tags),tags),
    }));
  }

  private archivedDecks(id: string) {
    const db = this.library.db;
    const entry = db.prepare('SELECT decks_json FROM card_trash WHERE card_id=?').get(id);
    const recorded = JSON.parse(String(entry?.decks_json ?? '[]')) as TrashDeck[];
    return recorded.flatMap(deck => {
      const current = db.prepare('SELECT d.name,p.name AS characterName FROM decks d JOIN character_profiles p ON p.id=d.character_id WHERE d.id=? AND p.id=?')
        .get(deck.id,deck.characterId);
      return current ? [`${current.characterName} · ${current.name}`] : [];
    });
  }

  private restoreCandidates(cards: { card: CardDefinition }[]) {
    return cards.map(({card},index)=>{
      const decks = this.archivedDecks(card.id).join(' / ');
      return { id:card.id, label:`${card.name} ${index+1} · ${decks || '이전 덱 연결 없음'}` };
    });
  }

  private appendPlan(targetId: string, characterId: string, characterName: string, deck: DeckDocument, identity: string, images: Map<string,string>, snapshot: ResourceSnapshot): ExchangePlan {
    const db = this.library.db;
    const target = db.prepare('SELECT name FROM decks WHERE id=? AND character_id=? AND id NOT IN (SELECT deck_id FROM deck_trash)').get(targetId,characterId) as { name: string } | undefined;
    if (!target) throw new UserInputError('선택한 캐릭터의 활성 덱을 다시 골라 주세요.');
    const memberIds = (db.prepare('SELECT card_id FROM deck_cards WHERE deck_id=? ORDER BY position').all(targetId) as { card_id: string }[]).map(row => row.card_id);
    const members = new Set(memberIds);
    const receipt = db.prepare('SELECT 1 FROM deck_exchange_appends WHERE deck_id=? AND digest=?').get(targetId,identity);
    const prior = db.prepare('SELECT card_ref,card_id FROM deck_exchange_cards WHERE deck_id=? AND digest=?')
      .all(targetId,identity) as { card_ref: string; card_id: string | null }[];
    const remembered = new Map(prior.map(row=>[row.card_ref,row.card_id]));
    const library = this.library.getLibrary();
    const localTags = new Map(library.tags.map(tag => [tag.id,tag.name]));
    const importedTags = new Map(deck.tags.map(tag => [tag.ref,tag.name]));
    const cardsByDesign = new Map<string,{ card: CardDefinition; full: string; label: string }[]>();
    const liveCards = new Map(library.cards.map(card=>[card.id,card]));
    const trash = this.archivedCards(snapshot,localTags);
    const archiveById = new Map(trash.map(item=>[item.card.id,item]));
    const hashes = deckHashes(deck);
    const localNames = new Set(library.cards.map(card => normalizeText(card.name)));
    for (const card of library.cards) {
      const portable = this.portableCard(card,snapshot,'local',card.tags);
      const key = cardIdentity(portable,localTags);
      const matches = cardsByDesign.get(key.design) ?? [];
      const labels = (portable.characterRules??portable.castOptions).map(option=>option.label).join(' / ');
      matches.push({card,full:key.full,label:`${card.name} · ${labels}`});
      cardsByDesign.set(key.design,matches);
    }
    const choices: AppendChoice[] = [];
    const added: string[] = [];
    const duplicates: string[] = [];
    const conflicts: NonNullable<DeckPreview['append']>['conflicts'] = [];
    const restorable: NonNullable<DeckPreview['restorable']> = [];
    const ambiguousRestores: NonNullable<DeckPreview['ambiguousRestores']> = [];
    const seen = new Set<string>();
    const matches = new Map<string,string>();
    for (const card of deck.cards) {
      const key = cardIdentity(card,importedTags);
      const same = cardsByDesign.get(key.design) ?? [];
      const exact = same.filter(item => item.full === key.full);
      const rememberedId = remembered.get(card.ref);
      const archived = rememberedId === null ? [] : trash.filter(item => item.card.id === rememberedId || item.design === key.design);
      const archivedExact = archived.filter(item => item.full === key.full);
      const restore = archived.find(item => item.card.id === rememberedId) ?? (archivedExact.length === 1 ? archivedExact[0] : archived.length === 1 ? archived[0] : undefined);
      const previous = rememberedId ? liveCards.get(rememberedId) : undefined;
      const member = (previous && members.has(previous.id) ? previous : undefined) ?? exact.find(item=>members.has(item.card.id))?.card;
      const existing = previous ?? (exact.length === 1 ? exact[0].card : undefined);
      if (member || seen.has(key.full)) {
        duplicates.push(card.name);
        if (member) matches.set(card.ref,member.id);
      } else if (restore && (restore.card.id === rememberedId || !existing && (archivedExact.length === 1 || !same.length))) {
        choices.push({card,existingId:restore.card.id,restore:true});
        restorable.push({ref:card.ref,card:card.name,id:restore.card.id,decks:this.archivedDecks(restore.card.id)});
      } else if (existing) {
        choices.push({card,existingId:existing.id});
        added.push(card.name);
      } else if (same.length) {
        conflicts.push({card:card.name,ref:card.ref,detail:'같은 정의의 후보가 여러 개이거나 비용 규칙이 다릅니다. 기존 비용을 유지해 연결하거나 별도 카드로 등록할 수 있습니다.',
          candidates:same.map((item,index)=>({id:item.card.id,label:same.length>1?`${item.label} (${index+1})`:item.label,inDeck:members.has(item.card.id)})),
          copyNotices:noticesFor(card,!!card.image&&images.has(card.image.sha256),snapshot)});
      } else if (archived.length) {
        ambiguousRestores.push({ref:card.ref,card:card.name,candidates:this.restoreCandidates(archivedExact.length ? archivedExact : archived)});
      } else {
        if (localNames.has(normalizeText(card.name))) conflicts.push({card:card.name,detail:'같은 이름의 다른 정의가 있습니다. 별도 카드로 추가합니다.'});
        choices.push({card});
        added.push(card.name);
      }
      seen.add(key.full);
    }
    const notices = choices.concat(deck.cards.filter(card=>matches.has(card.ref)).map(card=>({card,existingId:matches.get(card.ref)})))
      .flatMap(({card,existingId})=>{
        const local = existingId ? liveCards.get(existingId) ?? archiveById.get(existingId)?.card : undefined;
        const image = local ? this.portableCard(local,snapshot,'local',local.tags).image : card.image;
        const missing = image && !images.has(image.sha256);
        if (local && image && !hashes.has(image.sha256)) return [];
        return noticesFor({...card,image},!missing,existingId ? undefined : snapshot).filter(notice=>!existingId || notice.kind==='image');
      });
    const linkedChoices=choices.filter(choice=>choice.existingId&&!choice.restore);
    const linked=linkedChoices.map(choice=>choice.card.name);
    const linkedIds=linkedChoices.map(choice=>choice.existingId!);
    const created=choices.filter(choice=>!choice.existingId).map(choice=>choice.card.name);
    const preview = {characterName,name:target.name,cards:deck.cards.map(card => card.name),notices,existing:!!receipt&&!choices.length&&!conflicts.some(item=>item.ref),
      duplicateCardNames:duplicates.length,renamed:false,restorable,ambiguousRestores,append:{added,linked,linkedIds,created,duplicates,conflicts,trashed:[]}};
    return {identity,choices,matches,preview,existing:{id:targetId,name:target.name},
      fingerprint:digest({preview,memberIds,matches:[...matches],remembered:[...remembered],choices:choices.map(item=>[item.card.ref,item.existingId]),images:[...images]})};
  }

  private plan(characterId: string, deck: DeckDocument, images: Map<string, string>, targetId?: string, createAnother=false): ExchangePlan {
    const db = this.library.db;
    const profile = db.prepare('SELECT name FROM character_profiles WHERE id=? AND id NOT IN (SELECT profile_id FROM profile_trash)').get(characterId) as { name: string } | undefined;
    if (!profile) throw new UserInputError('가져올 캐릭터를 다시 선택해 주세요.');
    const identity = digest(deck);
    const snapshot = this.resources.snapshot(characterId);
    for (const [sha, id] of images) if (id !== 'zip' && !this.library.getAsset(id)) images.delete(sha);
    if (targetId) return this.appendPlan(targetId,characterId,profile.name,deck,identity,images,snapshot);
    const receipts = db.prepare(`SELECT d.id,d.name,t.deleted_at AS deletedAt,
      (SELECT COUNT(*) FROM deck_cards WHERE deck_id=d.id) AS cards
      FROM deck_exchange_imports r JOIN decks d ON d.id=r.deck_id
      LEFT JOIN deck_trash t ON t.deck_id=d.id WHERE r.character_id=? AND r.digest=?
      ORDER BY t.deleted_at DESC,d.rowid DESC`).all(characterId, identity) as {id:string; name:string; deletedAt:string|null; cards:number}[];
    const existing = receipts.find(receipt=>!receipt.deletedAt);
    const archivedDecks = receipts.flatMap(({id,name,deletedAt,cards})=>deletedAt?[{id,name,deletedAt,cards}]:[]);
    if (existing && !archivedDecks.length && !createAnother) {
      const plan = this.appendPlan(existing.id,characterId,profile.name,deck,identity,images,snapshot);
      return {...plan,preview:{...plan.preview,existing:!plan.choices.length&&!plan.preview.append?.conflicts.some(item=>item.ref)}};
    }
    const deckNames = new Set((db.prepare('SELECT name FROM decks WHERE character_id=?').all(characterId) as { name: string }[]).map(item => normalizeText(item.name)));
    let name = deck.name;
    for (let n = 2; deckNames.has(normalizeText(name)); n++) {
      const suffix = ` (${n})`;
      name = deck.name.slice(0, 100 - suffix.length) + suffix;
    }
    const cardNames = new Set((db.prepare('SELECT name FROM card_definitions WHERE archived_at IS NULL').all() as { name: string }[]).map(card => normalizeText(card.name)));
    const duplicateCardNames = deck.cards.filter(card => cardNames.has(normalizeText(card.name))).length;
    const notices = deck.cards.flatMap(card => noticesFor(card, !!card.image && images.has(card.image.sha256), snapshot));
    const local = this.library.getLibrary();
    const parkedDecks = new Set(archivedDecks.map(item=>item.id));
    const preservesParkedDeck = (cardId:string) => {
      if (!parkedDecks.size) return true;
      const entry = db.prepare('SELECT decks_json FROM card_trash WHERE card_id=?').get(cardId);
      return !(JSON.parse(String(entry?.decks_json??'[]')) as TrashDeck[]).some(item=>parkedDecks.has(item.id));
    };
    const localTags = new Map(local.tags.map(tag=>[tag.id,tag.name]));
    const liveIds = new Set(local.cards.map(card=>card.id));
    const remembered = new Map<string,Set<string>>();
    for (const row of db.prepare(`SELECT c.card_ref,c.card_id FROM deck_exchange_imports i
      JOIN deck_exchange_cards c ON c.deck_id=i.deck_id AND c.digest=i.digest
      WHERE i.character_id=? AND i.digest=? AND c.card_id IS NOT NULL`).all(characterId,identity) as {card_ref:string;card_id:string}[]) {
      if (!liveIds.has(row.card_id)) continue;
      const previous=remembered.get(row.card_ref)??new Set<string>();
      previous.add(row.card_id);
      remembered.set(row.card_ref,previous);
    }
    const matches = new Map<string,string[]>();
    for (const card of local.cards) {
      const key = cardIdentity(this.portableCard(card,snapshot,'local',card.tags),localTags).full;
      matches.set(key,[...(matches.get(key)??[]),card.id]);
    }
    const importedTags = new Map(deck.tags.map(tag=>[tag.ref,tag.name]));
    const trash = this.archivedCards(snapshot,localTags);
    const restorable: NonNullable<DeckPreview['restorable']> = [];
    const ambiguousRestores: NonNullable<DeckPreview['ambiguousRestores']> = [];
    const choices: AppendChoice[] = [];
    const seen = new Set<string>();
    const newDeckDuplicates: string[] = [];
    for (const card of deck.cards) {
      const key=cardIdentity(card,importedTags);
      if (seen.has(key.full)) { newDeckDuplicates.push(card.name); continue; }
      seen.add(key.full);
      const previous = remembered.get(card.ref);
      if (previous?.size===1) { choices.push({card,existingId:[...previous][0]}); continue; }
      const existingCard = matches.get(key.full);
      if (existingCard?.length===1) { choices.push({card,existingId:existingCard[0]}); continue; }
      const archived=trash.filter(item=>item.design===key.design && preservesParkedDeck(item.card.id));
      const exact=archived.filter(item=>item.full===key.full);
      const match=exact.length===1 ? exact[0] : archived.length===1 ? archived[0] : undefined;
      if (!match) {
        if (archived.length) ambiguousRestores.push({ref:card.ref,card:card.name,candidates:this.restoreCandidates(exact.length ? exact : archived)});
        else choices.push({card});
        continue;
      }
      restorable.push({ ref:card.ref,card:card.name,id:match.card.id,decks:this.archivedDecks(match.card.id) });
      choices.push({card,existingId:match.card.id,restore:true});
    }
    const preview = { characterName: profile.name, name, cards: deck.cards.map(card => card.name), notices, existing: false,
      duplicateCardNames, renamed: name !== deck.name, restorable, ambiguousRestores, archivedDecks,
      newDeckCardCount:choices.length+ambiguousRestores.length, newDeckDuplicates,
      reusedCardCount:choices.filter(choice=>choice.existingId&&!choice.restore).length };
    return { identity, choices, preview, fingerprint: digest({ preview, images: [...images], choices, receipts }) };
  }

  async inspect(characterId: string, path: string, deckId?: string): Promise<DeckPreview> {
    this.draft = undefined;
    const isZip = extname(path).toLowerCase() === '.zip';
    const archive = isZip ? await readDeckZip(path,parseDeckDocument) : undefined;
    const deck = archive?.deck ?? await readDeckDocument(path);
    const images = await this.assets.findOriginals(deckHashes(deck));
    for (const sha of archive?.images ?? []) if (!images.has(sha)) images.set(sha,'zip');
    const token = randomUUID();
    const plan = this.plan(characterId, deck, images, deckId);
    const alternative = !deckId&&plan.existing ? this.plan(characterId,deck,images,undefined,true) : undefined;
    this.draft = { token, characterId, deckId, deck, fingerprint: plan.fingerprint, newFingerprint:alternative?.fingerprint,
      zipPath:isZip ? path : undefined, archivedDecks:plan.preview.archivedDecks };
    return { ...plan.preview, token, format:isZip ? 'zip' : 'json', alternativeNew:alternative?.preview };
  }

  async apply(input: unknown): Promise<DeckImportResult> {
    const { token, characterId, deckId, restoreDeckId, createAnother, decisions = {} } = deckApplySchema.parse(input);
    const draft = this.draft;
    if (!draft || draft.token !== token || draft.characterId !== characterId || draft.deckId !== deckId) throw new UserInputError('가져올 파일과 캐릭터를 다시 확인해 주세요.');
    const { deck } = draft;
    if (restoreDeckId) {
      const archived=draft.archivedDecks?.find(item=>item.id===restoreDeckId);
      if (!archived || createAnother || Object.keys(decisions).length) throw new UserInputError('미리보기에서 복원할 덱을 다시 선택해 주세요.');
      transaction(this.library.db,()=>{
        const current=this.library.db.prepare(`SELECT d.name,t.deleted_at AS deletedAt,
          (SELECT COUNT(*) FROM deck_cards WHERE deck_id=d.id) AS cards FROM deck_exchange_imports r
          JOIN decks d ON d.id=r.deck_id JOIN deck_trash t ON t.deck_id=d.id WHERE r.deck_id=? AND r.character_id=? AND r.digest=?`)
          .get(archived.id,characterId,digest(deck));
        if (current?.name!==archived.name||current.deletedAt!==archived.deletedAt||current.cards!==archived.cards)
          throw new UserInputError('복원할 덱이 변경됐습니다. 다시 확인해 주세요.');
        this.library.restoreDeck(archived.id,characterId);
      });
      this.draft=undefined;
      return {deckId:archived.id,name:archived.name,replayed:false,restoredDeck:true,notices:[],library:this.library.getLibrary()};
    }
    if (createAnother&&!draft.newFingerprint) throw new UserInputError('새 덱 가져오기 미리보기를 다시 열어 주세요.');
    const hashes = deckHashes(deck);
    const images = await this.assets.findOriginals(hashes);
    const repairs = await this.assets.missingOriginals(hashes);
    const prepared = new Map<string,PreparedOriginal>();
    try {
      if (draft.zipPath) {
        const archive = await readDeckZip(draft.zipPath,parseDeckDocument, async (sha,bytes) => {
          if (!images.has(sha)) prepared.set(sha,await this.assets.prepareOriginal(bytes,sha));
        });
        if (digest(archive.deck) !== digest(deck)) throw new UserInputError('덱 ZIP이 변경됐습니다. 파일을 다시 선택해 주세요.');
        for (const sha of archive.images) if (!images.has(sha)) images.set(sha,'zip');
      }
      if (this.draft !== draft) throw new UserInputError('미리보기가 변경됐습니다. 다시 확인해 주세요.');
      const result = transaction(this.library.db, () => {
        const plan = this.plan(characterId, deck, images, deckId, createAnother);
        if (plan.fingerprint !== (createAnother ? draft.newFingerprint : draft.fingerprint)) throw new UserInputError('대상 덱, 자원 또는 이미지가 변경됐습니다. 파일을 다시 열어 확인해 주세요.');
        const db = this.library.db;
        const destination = plan.existing?.id ?? randomUUID();
        const members = new Set(db.prepare('SELECT card_id FROM deck_cards WHERE deck_id=?').all(destination).map(row=>String(row.card_id)));
        const summary = { linked: [] as string[], created: [] as string[], restored: [] as string[], duplicates:[...(plan.preview.append?.duplicates??plan.preview.newDeckDuplicates??[])],
          trashed:[...(plan.preview.append?.trashed??[])], skipped:[] as string[] };
        const choices = new Map(plan.choices.map(choice=>[choice.card.ref,choice]));
        const conflicts = new Map(plan.preview.append?.conflicts.filter(item=>item.ref).map(item=>[item.ref!,item]));
        const disputed = new Map(plan.preview.ambiguousRestores?.map(item=>[item.ref,item]));
        for (const [ref,decision] of Object.entries(decisions)) {
          if (choices.get(ref)?.restore && (decision.mode==='restore' || decision.mode==='skip')) {
            if (decision.mode==='skip') { summary.trashed.push(choices.get(ref)!.card.name); choices.delete(ref); }
          } else if (disputed.has(ref)) {
            if (decision.mode!=='skip' && (decision.mode!=='restore' || !disputed.get(ref)?.candidates.some(candidate=>candidate.id===decision.cardId)))
              throw new UserInputError('복원할 휴지통 카드를 다시 선택해 주세요.');
          } else if (!conflicts.has(ref) || decision.mode==='restore') {
            throw new UserInputError('미리보기의 복원 및 충돌 항목을 다시 확인해 주세요.');
          }
        }
        for (const card of deck.cards) {
          if (disputed.has(card.ref)) {
            const choice=decisions[card.ref];
            if (choice?.mode==='restore') choices.set(card.ref,{card,existingId:choice.cardId,restore:true});
            else summary.trashed.push(card.name);
            continue;
          }
          if (!conflicts.has(card.ref)) continue;
          const decision = decisions[card.ref];
          if (!decision || decision.mode==='skip') { summary.skipped.push(card.name); continue; }
          if (decision.mode==='link' && !conflicts.get(card.ref)?.candidates?.some(candidate=>candidate.id===decision.cardId))
            throw new UserInputError('연결할 카드를 다시 선택해 주세요.');
          choices.set(card.ref,{card,existingId:decision.mode==='link'?decision.cardId:undefined});
        }
        const now = new Date().toISOString();
        const existingTags = new Map((db.prepare('SELECT id,name FROM tags ORDER BY rowid').all() as { id: string; name: string }[])
          .map(tag => [normalizeText(tag.name), tag.id]));
        const usedTags = new Set([...choices.values()].filter(choice=>!choice.existingId).flatMap(({card})=>card.tags));
        const tagIds = new Map(deck.tags.filter(tag=>usedTags.has(tag.ref)).map(tag => {
          const existing = existingTags.get(normalizeText(tag.name));
          const id = existing ?? randomUUID();
          if (!existing) db.prepare('INSERT INTO tags(id,name,created_at,updated_at) VALUES (?,?,?,?)').run(id, tag.name, now, now);
          return [tag.ref, id];
        }));
        if (!plan.existing) db.prepare('INSERT INTO decks(id,character_id,name) VALUES (?,?,?)').run(destination, characterId, plan.preview.name);
        const insertCard = db.prepare('INSERT INTO card_definitions(id,name,image_asset_id,kind,spell_level,attributes_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)');
        const insertTag = db.prepare('INSERT INTO card_tags(card_id,tag_id) VALUES (?,?)');
        const insertMember = db.prepare('INSERT INTO deck_cards(deck_id,card_id,position) VALUES (?,?,(SELECT COALESCE(MAX(position),-1)+1 FROM deck_cards WHERE deck_id=?)) ON CONFLICT(deck_id,card_id) DO NOTHING');
        const insertOverride = db.prepare('INSERT INTO character_cost_overrides VALUES (?,?,?,?)');
        const remember = db.prepare('INSERT INTO deck_exchange_cards VALUES (?,?,?,?) ON CONFLICT(deck_id,digest,card_ref) DO UPDATE SET card_id=excluded.card_id');
        for (const [ref,id] of plan.matches??[]) remember.run(destination,plan.identity,ref,id);
        const confirmedNames = new Set([...choices.values()].map(choice=>choice.card.name).concat(summary.duplicates));
        const notices = plan.preview.notices.filter(notice=>notice.kind!=='image' || confirmedNames.has(notice.card));
        const warnings: string[] = [];
        const resolvedImages = new Map<string,string>();
        const imageId = (sha: string) => {
          const original = images.get(sha);
          if (original !== 'zip') return original;
          if (!resolvedImages.has(sha)) resolvedImages.set(sha,this.assets.storeOriginal(prepared.get(sha)!));
          return resolvedImages.get(sha);
        };
        const repairsByCard = new Map(repairs.map(row=>[row.id,row]));
        const repairImage = (id: string) => {
          const row = repairsByCard.get(id);
          if (!row) return;
          const asset = imageId(row.sha);
          if (asset) this.assets.linkOriginal(row,asset);
        };
        for (const id of plan.matches?.values() ?? []) repairImage(id);
        for (const fileCard of deck.cards) {
          const choice = choices.get(fileCard.ref);
          if (!choice) continue;
          const {card,existingId} = choice;
          if (existingId) {
            if (choice.restore && !members.has(existingId)) {
              warnings.push(...restoreCardFromTrash(db,existingId));
              summary.restored.push(card.name);
              insertMember.run(destination,existingId,destination);
              members.add(existingId);
            } else if (members.has(existingId)) summary.duplicates.push(card.name);
            else { insertMember.run(destination,existingId,destination); members.add(existingId); summary.linked.push(card.name); }
            repairImage(existingId);
            remember.run(destination,plan.identity,card.ref,existingId);
            continue;
          }
          notices.push(...(conflicts.get(card.ref)?.copyNotices??[]));
          const { image, tags, castOptions, characterRules, ownedResources, ...fields } = card;
          const rules = remapRules(castOptions, characterRules, () => randomUUID());
          const id = randomUUID();
          const imageAssetId = image && imageId(image.sha256);
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
          insertMember.run(destination, id, destination);
          remember.run(destination,plan.identity,card.ref,id);
          summary.created.push(card.name);
        }
        const added = summary.linked.length+summary.created.length+summary.restored.length;
        if (deckId && added) db.prepare('INSERT INTO deck_exchange_appends VALUES (?,?) ON CONFLICT DO NOTHING').run(destination,plan.identity);
        else if (!plan.existing) {
          db.prepare('INSERT INTO deck_exchange_imports VALUES (?,?,?)').run(characterId,plan.identity,destination);
          db.prepare('UPDATE character_profiles SET active_deck_id=? WHERE id=? AND active_deck_id IS NULL').run(destination,characterId);
        }
        return { deckId:destination, name:plan.preview.name, replayed:!!plan.existing&&!added, notices, added, summary, warnings };
      });
      this.draft = undefined;
      return { ...result, library: this.library.getLibrary() };
    } finally { await this.assets.cleanPrepared(prepared.values()); }
  }
}
