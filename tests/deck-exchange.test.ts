import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { ZipFile } from 'yazl';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import { AssetService } from '../electron/assets';
import { BackupService, applyPendingRestore } from '../electron/backup';
import { DeckExchange, parseDeckDocument, readDeckDocument } from '../electron/deck-exchange';
import { LibraryStore } from '../electron/library-store';
import { migrations } from '../electron/migrations';
import { ResourceStore } from '../electron/resource-store';
import { TrashStore } from '../electron/trash-store';
import { ProfilePurge } from '../electron/profile-purge';
import { EditStore } from '../electron/edit-store';
import { AppStore } from '../electron/store';
import { planUse } from '../src/shared/resource-engine';
import type { CastOption } from '../src/shared/contracts';
import type { ResourceAction } from '../src/shared/resources';
import { MAX_DECK_BYTES } from '../src/shared/deck-exchange';
import { effectiveCard } from '../src/shared/casting';

const root = resolve('artifacts/deck-exchange-unit');
mkdirSync(root, { recursive: true });
const fixture = (path = mkdtempSync(join(root, 'case-'))) => {
  const store = new AppStore(path);
  const library = new LibraryStore(store);
  const resources = new ResourceStore(store);
  const assets = new AssetService(path, library);
  const exchange = new DeckExchange(library, resources, assets);
  return { path, store, library, resources, assets, exchange };
};
type Fixture = ReturnType<typeof fixture>;
const newProfile = (f: Fixture, name: string) => {
  const { profiles, libraryState } = f.library.createProfile({ name });
  return profiles.find(profile => profile.id === libraryState.activeCharacterId)!;
};
const change = (f: Fixture, characterId: string, action: ResourceAction) => f.resources.change({
  requestId: randomUUID(), characterId, expectedRevision: f.resources.snapshot(characterId).revision, action,
});
const definition = {
  id: '04d673e9-c25f-43a1-80cd-a699a5026a22', name: '고유 빛', maximum: 7, amount: 2, unit: '회',
  recovery: [{ triggers: ['dawn' as const], amount: { type: 'full' as const } }],
};
const info = { kind: 'spell' as const, spellLevel: 2, roles: ['buff' as const], actions: ['bonus_action' as const], range: { kind: 'ranged' as const, feet: 60 } };
const shared: CastOption[] = [{
  id: 'normal-local', label: '상위 슬롯 사용', casting: { mode: 'standard', allowUpcast: true, allowBelowBase: false, minSlotLevel: 2, maxSlotLevel: 4 },
  costs: [
    { type: 'slot', costKey: 'slot-local', slotSelection: 'standard', autoBind: true },
    { type: 'variable', costKey: 'variable-local', min: 1, max: 5, step: 2, requirement: { key: 'external:never-held', kind: 'counter' } },
  ],
}, { id: 'ritual-local', label: '의식', ritual: true, costs: [] }];
const privateRules: CastOption[] = [{
  id: 'override-local', label: '직접 연결 두 개', costs: [
    { type: 'fixed', costKey: 'fixed-portable', amount: 2, slotLevel: 2 },
    { type: 'fixed', costKey: 'fixed-private', amount: 1 },
  ],
}, { id: 'owned-only-local', label: '고유 빛만', costs: [] }];

function seed(f: Fixture) {
  const profile = newProfile(f, '보내는 캐릭터');
  const { id, activeDeckId: deckId } = profile;
  f.store.db.prepare('UPDATE decks SET name=? WHERE id=?').run('교환 덱', deckId!);
  const tags = f.library.saveTag({ name: '빛' }).tags.map(tag => tag.id);
  const image = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex');
  const imageHash = createHash('sha256').update(image).digest('hex');
  writeFileSync(join(f.path, 'assets', 'managed.png'), image);
  f.store.db.prepare('INSERT INTO assets(id,relative_path,sha256,mime_type,width,height) VALUES (?,?,?,?,?,?)')
    .run('source-image', 'assets/managed.png', imageHash, 'image/png', 1, 1);
  f.library.saveCards({ cards: [
    { ...info, name: '별빛 주문', description: '긴 설명\n원본을 보존', tags, imageMode: 'illustration', imageAssetId: 'source-image', concentration: true, ritual: true, upcastEffect: true, ownedResources: [definition] },
    { ...info, name: '이미지 없는 주문', tags: [], imageMode: 'none', concentration: false },
  ] });
  const c = f.library.getLibrary().cards[0];
  change(f, id, { type: 'save_costs', scope: 'shared', cardId: c.id, castOptions: shared, bindings: [] });
  change(f, id, { type: 'create_resource', scope: 'character', template: {
    kind: 'slot_track', slotKind: 'standard', name: '이식 슬롯', matchKey: 'pool:standard', unit: '슬롯', recovery: [], slotCapacity: { '2': { type: 'fixed', value: 3 } },
  } });
  change(f, id, { type: 'create_resource', scope: 'character', template: {
    kind: 'counter', name: '로컬 전용', unit: '회', recovery: [], capacity: { type: 'fixed', value: 5 },
  } });
  const pools = f.resources.snapshot(id).resources;
  const manual = [pools.find(resource => resource.name === '이식 슬롯')!, pools.find(resource => resource.name === '로컬 전용')!];
  change(f, id, { type: 'save_costs', scope: 'character', cardId: c.id, castOptions: privateRules, bindings: [
    { costKey: 'fixed-portable', resourceInstanceId: manual[0].id }, { costKey: 'fixed-private', resourceInstanceId: manual[1].id },
  ] });
  const action = { type: 'use' as const, cardId: c.id, optionId: 'owned-only-local', choices: {} };
  change(f, id, { ...action, quote: f.resources.preview({ characterId: id, action }).quote });
  const order = [...f.library.getLibrary().decks[0].cardIds].reverse();
  f.library.setDeckCards({ deckId, cardIds: order });
  return { id, deckId: deckId!, tags, c, manual, image, imageHash };
}

describe('v1.4 P4 deck JSON', () => {
  it('appends in order, preserves existing cards and spent owned resources, and ignores a repeated file', async () => {
    const f = fixture();
    try {
      const source = seed(f);
      const path = join(f.path,'append.json');
      await f.exchange.export(source.deckId,path);
      const doc = await readDeckDocument(path);
      const target = f.library.createDeck({characterId:source.id,name:'기존 덱'}).decks.find(deck=>deck.name==='기존 덱')!;
      f.library.setDeckCards({deckId:target.id,cardIds:[source.c.id]});
      const before = f.resources.snapshot(source.id).resources.find(resource=>resource.ownedDefinitionId)!;
      const edited = {...doc.cards[0],ref:'extra',description:'다른 카드',imageMode:'illustration',image:doc.cards[1].image};
      writeFileSync(path,JSON.stringify({...doc,cards:[doc.cards[1],edited,doc.cards[0]]}));
      const preview = await f.exchange.inspect(source.id,path,target.id);
      expect(preview.append).toMatchObject({duplicates:[source.c.name],added:[edited.name,doc.cards[0].name],conflicts:[{card:edited.name}]});
      const result = await f.exchange.apply({characterId:source.id,deckId:target.id,token:preview.token});
      expect(result.added).toBe(2);
      const memberIds = result.library.decks.find(deck=>deck.id===target.id)!.cardIds;
      expect(memberIds[0]).toBe(source.c.id);
      expect(result.library.cards.find(card=>card.id===memberIds[1])?.description).toBe('다른 카드');
      expect(memberIds[2]).toBe(result.library.decks.find(deck=>deck.id===source.deckId)!.cardIds[0]);
      expect(f.resources.snapshot(source.id).resources.filter(resource=>resource.ownedDefinitionId)).toEqual([before]);
      const replay = await f.exchange.inspect(source.id,path,target.id);
      expect(replay.existing).toBe(true);
      expect((await f.exchange.apply({characterId:source.id,deckId:target.id,token:replay.token})).replayed).toBe(true);
      expect(f.library.getLibrary()).toEqual(result.library);
      const again = async () => {
        const plan=await f.exchange.inspect(source.id,path,target.id);
        return f.exchange.apply({characterId:source.id,deckId:target.id,token:plan.token});
      };
      const override: CastOption[] = [{id:'renewed',label:'현지 수정 비용 유지',costs:[]}];
      change(f,source.id,{type:'save_costs',scope:'character',cardId:source.c.id,castOptions:override,bindings:[]});
      f.library.setDeckCards({deckId:target.id,cardIds:[memberIds[1]]});
      const missing = await again();
      expect(missing.summary).toMatchObject({linked:[source.c.name,doc.cards[0].name],created:[],duplicates:[edited.name]});
      expect(missing.library.decks.find(deck=>deck.id===target.id)!.cardIds).toEqual([memberIds[1],memberIds[0],memberIds[2]]);
      expect(f.resources.snapshot(source.id).costOverrides?.find(rule=>rule.cardId===source.c.id)?.castOptions).toEqual(override);
      expect(f.resources.snapshot(source.id).resources.find(resource=>resource.id===before.id)?.remaining).toBe(before.remaining);
      const usedEvents = f.store.db.prepare("SELECT * FROM play_events WHERE event_type='card_used'").all();
      f.library.archiveCard(memberIds[1]);
      const archived = await f.exchange.inspect(source.id,path,target.id);
      expect(archived.restorable).toMatchObject([{ref:edited.ref,id:memberIds[1],decks:[expect.stringContaining('기존 덱')]}]);
      expect(f.library.trashedCards().map(card=>card.id)).toContain(memberIds[1]);
      const skipped = await f.exchange.apply({characterId:source.id,deckId:target.id,token:archived.token,decisions:{[edited.ref]:{mode:'skip'}}});
      expect(skipped.summary).toMatchObject({trashed:[edited.name],created:[],restored:[]});
      expect((await again()).summary).toMatchObject({restored:[edited.name],created:[]});
      const trash = new TrashStore(f.store);
      expect((await again()).summary?.duplicates).toContain(edited.name);
      f.library.archiveCard(memberIds[1]);
      const purge = { type:'purge' as const,cardIds:[memberIds[1]] };
      const purgeReview = trash.preview(purge);
      trash.change({requestId:randomUUID(),action:purge,quote:purgeReview.quote,confirmed:true,phrase:'영구 삭제'});
      const readded=await again();
      expect(readded.summary?.created).toEqual([edited.name]);
      expect(readded.library.decks.find(deck=>deck.id===target.id)!.cardIds).not.toContain(memberIds[1]);
      expect(f.store.db.prepare("SELECT * FROM play_events WHERE event_type='card_used'").all()).toEqual(usedEvents);
    } finally { f.store.close(); }
  });

  it('moves a shared card only out of the selected deck and restores both recorded memberships through the same JSON preview', async ()=>{
    const f=fixture();
    try {
      const s=seed(f);
      const other=newProfile(f,'다른 캐릭터');
      const file=join(f.path,'shared.json');
      await f.exchange.export(s.deckId,file);
      f.library.setDeckCards({deckId:other.activeDeckId,cardIds:[s.c.id],operation:'add'});
      f.library.setDeckCards({deckId:s.deckId,cardIds:[s.c.id],operation:'remove'});
      expect(f.library.getLibrary().decks.find(deck=>deck.id===other.activeDeckId)?.cardIds).toEqual([s.c.id]);
      expect(f.library.getLibrary().cards.find(card=>card.id===s.c.id)!.imageAssetId).toBe('source-image');
      f.library.setDeckCards({deckId:s.deckId,cardIds:[s.c.id],operation:'add'});
      const state=f.resources.snapshot(s.id);
      f.library.archiveCard(s.c.id);
      const preview=await f.exchange.inspect(s.id,file,s.deckId);
      expect(preview.restorable?.[0].decks).toEqual(expect.arrayContaining(['다른 캐릭터 · 기본 덱','보내는 캐릭터 · 교환 덱']));
      const result=await f.exchange.apply({characterId:s.id,deckId:s.deckId,token:preview.token});
      expect(result.summary?.restored).toEqual([s.c.name]);
      expect(result.library.decks.find(deck=>deck.id===other.activeDeckId)?.cardIds).toEqual([s.c.id]);
      expect(f.library.getLibrary().cards.find(card=>card.id===s.c.id)!.imageAssetId).toBe('source-image');
      expect(f.resources.snapshot(s.id).events).toEqual(state.events);
      expect(f.resources.snapshot(s.id).resources.find(item=>item.ownedDefinitionId)?.remaining).toBe(5);
    } finally { f.store.close(); }
  });

  it('preserves exact RGBA originals in ZIP, repairs the existing JSON card, and rolls back a failed ZIP import', async ()=>{
    const source=fixture();
    const other=fixture();
    try {
      const src=newProfile(source,'ZIP 보내기');
      const dst=newProfile(other,'ZIP 받기');
      const png=await sharp({create:{width:37,height:61,channels:4,background:{r:13,g:24,b:35,alpha:0.45}}}).png().toBuffer();
      const hash=createHash('sha256').update(png).digest('hex');
      const original=await source.assets.prepareOriginal(png,hash);
      const assetId=source.assets.storeOriginal(original);
      source.library.saveCards({cards:[{...info,name:'PNG 원본',tags:[],imageMode:'illustration',imageAssetId:assetId,ownedResources:[definition]}]});
      const json=join(source.path,'portable.json');
      const zip=join(source.path,'portable.zip');
      await source.exchange.export(src.activeDeckId!,json);
      expect((await source.exchange.export(src.activeDeckId!,zip,'zip')).notices.filter(notice=>notice.kind==='image')).toEqual([]);
      const inspect=(file:string)=>other.exchange.inspect(dst.id,file,dst.activeDeckId);
      const apply=(token:string)=>other.exchange.apply({token,characterId:dst.id,deckId:dst.activeDeckId});
      const card=(await apply((await inspect(json)).token)).library.cards[0];
      expect(card.imageReference?.sha256).toBe(hash);
      const preview=await inspect(zip);
      expect(preview.format).toBe('zip');
      expect(preview.notices.filter(notice=>notice.kind==='image')).toEqual([]);
      other.store.db.exec("CREATE TRIGGER fail_zip BEFORE UPDATE OF image_asset_id ON card_definitions BEGIN SELECT RAISE(ABORT,'rollback ZIP'); END");
      await expect(apply(preview.token)).rejects.toThrow('rollback ZIP');
      expect(readdirSync(join(other.path,'assets'))).toEqual([]);
      expect(other.library.getLibrary().cards.find(item=>item.id===card.id)!.imageReference?.sha256).toBe(hash);
      other.store.db.exec('DROP TRIGGER fail_zip');
      await apply((await inspect(zip)).token);
      const repaired=other.library.getLibrary().cards.find(item=>item.id===card.id)!;
      expect(repaired.imageReference).toBeUndefined();
      const restored=await other.assets.readAsset(`app://assets/${repaired.imageAssetId}`);
      expect(restored?.bytes).toEqual(png);
      expect(await sharp(restored!.bytes).metadata()).toMatchObject({width:37,height:61,hasAlpha:true});
      const newDeck=await other.exchange.inspect(dst.id,zip);
      expect(await other.exchange.apply({token:newDeck.token,characterId:dst.id})).toMatchObject({added:1});
      expect(readdirSync(join(other.path,'assets'))).toHaveLength(1);
      expect((await other.exchange.inspect(dst.id,zip)).existing).toBe(true);
      const backup=new BackupService(source.store,'1.4.3');
      await expect(backup.inspect(zip)).rejects.toThrow(/덱 교환 ZIP/);
      const backupFile=join(source.path,'backup.zip');
      await backup.exportTo(backupFile);
      await expect(inspect(backupFile)).rejects.toThrow(/전체 백업/);
      const hostile=join(source.path,'invalid.zip');
      const archive=new ZipFile();
      archive.addBuffer(Buffer.from('unrecognized entry'),'unexpected.txt');
      const written=pipeline(archive.outputStream,createWriteStream(hostile));
      archive.end();
      await written;
      await expect(inspect(hostile)).rejects.toThrow(/파일 경로/);
      const imagePath=other.library.getAsset(repaired.imageAssetId!)!.relative_path;
      const {unlinkSync}=await import('node:fs');
      unlinkSync(join(other.path,imagePath));
      const restore=new BackupService(other.store,'1.4.3');
      const backupPreview=await restore.inspect(backupFile);
      expect(await restore.recoverImages(backupPreview.token,other.assets)).toEqual({recovered:1,remaining:0});
      expect((await other.assets.readAsset(`app://assets/${other.library.getLibrary().cards.find(item=>item.id===card.id)!.imageAssetId}`))?.bytes).toEqual(png);
    } finally { source.store.close(); other.store.close(); }
  });

  it('asks how to resolve differing character rules and never overwrites the existing card', async () => {
    const f=fixture();
    try {
      const s=seed(f); const path=join(f.path,'conflicts.json'); await f.exchange.export(s.deckId,path);
      const document=await readDeckDocument(path); const card=document.cards[1];
      writeFileSync(path,JSON.stringify({...document,cards:[card]}));
      change(f,s.id,{type:'save_costs',scope:'character',cardId:s.c.id,castOptions:[{id:'local',label:'현지 비용',costs:[]}],bindings:[]});
      change(f,s.id,{type:'save_costs',scope:'shared',confirmShared:true,cardId:s.c.id,castOptions:[{id:'changed',label:'현지 공통 비용',costs:[]}],bindings:[]});
      const first=f.library.createDeck({characterId:s.id,name:'기존 비용 보존'}).decks.at(-1)!;
      const second=f.library.createDeck({characterId:s.id,name:'별도 복사'}).decks.at(-1)!;
      for (const [destination,mode] of [[first,'link'],[second,'copy']] as const) {
        const preview=await f.exchange.inspect(s.id,path,destination.id);
        expect(preview.append?.conflicts[0]).toMatchObject({ref:card.ref,candidates:[{id:s.c.id}]});
        const result=await f.exchange.apply({token:preview.token,characterId:s.id,deckId:destination.id,
          decisions:{[card.ref]:mode==='link'?{mode,cardId:s.c.id}:{mode}}});
        expect(result.added).toBe(1);
        expect(result.library.decks.find(d=>d.id===destination.id)!.cardIds.includes(s.c.id)).toBe(mode==='link');
      }
      expect(f.resources.snapshot(s.id).costOverrides?.find(rule=>rule.cardId===s.c.id)?.castOptions[0].label).toBe('현지 비용');
    } finally{f.store.close();}
  });

  it('rolls back appended cards and rejects changes after preview', async () => {
    const source=fixture(); const f=fixture();
    try {
      const seeded=seed(source); const dst=newProfile(f,'대상');
      const path=join(source.path,'rollback.json'); await source.exchange.export(seeded.deckId,path);
      const preview=await f.exchange.inspect(dst.id,path,dst.activeDeckId);
      expect(preview.notices.map(notice=>notice.kind)).toEqual(expect.arrayContaining(['image','reconnect']));
      const before=f.library.getLibrary();
      f.store.db.exec("CREATE TRIGGER fail_append BEFORE INSERT ON deck_exchange_appends BEGIN SELECT RAISE(ABORT,'forced receipt failure'); END");
      await expect(f.exchange.apply({characterId:dst.id,deckId:dst.activeDeckId,token:preview.token})).rejects.toThrow('forced receipt failure');
      expect(f.library.getLibrary()).toEqual(before);
      expect(f.resources.snapshot(dst.id).resources).toEqual([]);
      f.library.saveCards({cards:[{...info,name:'미리보기 이후 추가',tags:[]}]});
      await expect(f.exchange.apply({characterId:dst.id,deckId:dst.activeDeckId,token:preview.token})).rejects.toThrow(/변경/);
    } finally { source.store.close(); f.store.close(); }
  });
  it('round-trips advanced definitions, absent requirements and portable overrides in a fresh DB, strips state, and preserves spent state on repeat', async () => {
    const source = fixture(); let target = fixture();
    try {
      const s = seed(source);
      const json = join(source.path, 'deck.json');
      await source.exchange.export(s.deckId, json);
      const bytes = readFileSync(json, 'utf8');
      for (const privateValue of [s.id, s.deckId, s.c.id, 'source-image', ...s.tags, definition.id, ...s.manual.map(resource => resource.id),
        'owned-only-local', 'fixed-private', 'remaining', 'play_events', 'undoTargetId', 'resourceInstanceId', 'assets/managed.png']) {
        expect(bytes).not.toContain(privateValue);
      }
      const portable = await readDeckDocument(json);
      expect(portable.cards.map(card => card.name)).toEqual(['이미지 없는 주문', '별빛 주문']);
      expect(portable.cards[1]).toMatchObject({ concentration: true, ritual: true, upcastEffect: true, ownedResources: [expect.objectContaining({ maximum: 7, amount: 2, recovery: definition.recovery })], image: { sha256: s.imageHash } });
      const character = newProfile(target, '받는 캐릭터');
      const originalLibrary = target.library.getLibrary();
      const preview = await target.exchange.inspect(character.id, json);
      expect(preview.notices).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'image' }), expect.objectContaining({ kind: 'reconnect' })]));
      expect(target.library.getLibrary()).toEqual(originalLibrary);
      const added = await target.exchange.apply({ token: preview.token, characterId: character.id });
      expect(added.replayed).toBe(false);
      const deck = added.library.decks.find(item => item.id === added.deckId)!;
      const card = added.library.cards.find(item => item.id === deck.cardIds[1])!;
      expect(card).toMatchObject({ imageReference: { sha256: s.imageHash }, imageMode: 'illustration', concentration: true, description: s.c.description });
      expect(card.imageAssetId).toBeUndefined();
      const snapshot = target.resources.snapshot(character.id);
      expect(snapshot.events).toEqual([]);
      expect(snapshot.bindings).toEqual([]);
      expect(snapshot.resources[0]).toMatchObject({ remaining: 7, inactive: true });
      const effective = effectiveCard(card, snapshot);
      expect(effective.castOptions[0].costs).toMatchObject([
        { type: 'fixed', slotLevel: 2, amount: 2, requirement: { kind: 'track', slotKind: 'standard', key: 'pool:standard' } },
        { type: 'fixed', reconnect: 'counter', amount: 1 },
      ]);
      target.library.selectDeck({ characterId: character.id, deckId: deck.id });
      const action = { type: 'use' as const, cardId: card.id, optionId: effective.castOptions[1].id, choices: {} };
      change(target, character.id, { ...action, quote: target.resources.preview({ characterId: character.id, action }).quote });
      const spent = target.resources.snapshot(character.id);
      expect(spent.resources[0].remaining).toBe(5);
      expect(() => planUse(effective, effective.castOptions[0].id, spent.resources, [], {})).toThrow('필요한 자원을 보유하지 않았습니다.');
      const roundTrip = join(target.path, 'round-trip.json');
      await target.exchange.export(added.deckId, roundTrip);
      expect(await readDeckDocument(roundTrip)).toEqual(portable);
      target.library.saveCards({ cards: [{
        ...info, id: card.id, name: card.name, tags: card.tags, imageMode: 'illustration', description: '이미지 없이 정보를 수정',
      }] });
      expect(target.library.getLibrary().cards.find(item => item.id === card.id)).toMatchObject({
        imageReference: { sha256: s.imageHash }, imageMode: 'illustration', description: '이미지 없이 정보를 수정',
      });
      const path = target.path;
      target.store.close();
      target = fixture(path);
      const repeat = await target.exchange.inspect(character.id, json);
      expect(repeat.existing).toBe(true);
      expect(await target.exchange.apply({ token: repeat.token, characterId: character.id })).toMatchObject({ replayed: true, deckId: added.deckId });
      expect(target.resources.snapshot(character.id)).toEqual(spent);
      change(target, character.id, { type: 'create_resource', scope: 'character', template: {
        kind: 'slot_track', slotKind: 'standard', name: '받는 슬롯', matchKey: 'pool:standard', unit: '슬롯', recovery: [], slotCapacity: { '2': { type: 'fixed', value: 3 } },
      } });
      change(target, character.id, { type: 'create_resource', scope: 'character', template: {
        kind: 'counter', name: '로컬 전용', unit: '회', recovery: [], capacity: { type: 'fixed', value: 5 },
      } });
      const unlinked = target.resources.snapshot(character.id);
      expect(() => planUse(effective, effective.castOptions[0].id, unlinked.resources, [], {})).toThrow('직접 연결');
      const local = unlinked.resources.find(resource => resource.name === '로컬 전용')!;
      change(target, character.id, { type: 'save_costs', scope: 'character', cardId: card.id, castOptions: effective.castOptions, bindings: [
        { costKey: effective.castOptions[0].costs[1].costKey, resourceInstanceId: local.id },
      ] });
      const use = { type: 'use' as const, cardId: card.id, optionId: effective.castOptions[0].id, choices: {} };
      const quote = target.resources.preview({ characterId: character.id, action: use });
      expect(quote.changes.map(item => [item.before, item.after])).toEqual([[3, 1], [5, 4], [5, 3]]);
      change(target, character.id, { ...use, quote: quote.quote });
      expect(target.store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { source.store.close(); target.store.close(); }
  });

  it('reuses only a matching managed image and creates collision-safe cards and a new deck without modifying a same-name deck', async () => {
    const f = fixture();
    try {
      const s = seed(f);
      const json = join(f.path, 'deck.json');
      await f.exchange.export(s.deckId, json);
      f.store.db.prepare("INSERT INTO card_definitions (id,name,kind,attributes_json,created_at,updated_at) SELECT 'card1','기존 충돌 카드',kind,attributes_json,created_at,updated_at FROM card_definitions WHERE id=?").run(s.c.id);
      const previous = f.library.getLibrary().decks[0];
      const preview = await f.exchange.inspect(s.id, json);
      expect(preview).toMatchObject({ name: '교환 덱 (2)', renamed: true, duplicateCardNames: 2, existing: false });
      expect(preview.notices.map(notice => notice.kind)).not.toContain('image');
      const result = await f.exchange.apply({ token: preview.token, characterId: s.id });
      expect(result.library.decks[0]).toEqual(previous);
      expect(result.library.cards.find(card => card.id === 'card1')?.name).toBe('기존 충돌 카드');
      const linkedId = result.library.decks.find(deck => deck.id === result.deckId)!.cardIds[1];
      expect(linkedId).toBe(s.c.id);
      expect(result.library.cards.find(card => card.id === linkedId)).toMatchObject({ tags: s.tags, imageAssetId: 'source-image', imageMode: 'illustration' });
      expect(readFileSync(join(f.path, 'assets', 'managed.png'))).toEqual(s.image);
      expect(f.resources.snapshot(s.id).resources.find(resource => resource.overrides.ownerCardId === s.c.id)?.remaining).toBe(5);
      expect(f.resources.snapshot(s.id).resources.filter(resource=>resource.ownedDefinitionId)).toHaveLength(1);
    } finally { f.store.close(); }
  });

  it.each(['json','zip'] as const)('restores any matching %s deck, supports explicit creation, and removes only the purged receipt',async format=>{
    const f=fixture();
    try {
      const s=seed(f);
      const path=join(f.path,`reimport.${format}`);
      await f.exchange.export(s.deckId,path,format);
      const inspect=()=>f.exchange.inspect(s.id,path);
      const apply=(token:string,extra:Record<string,unknown>={})=>f.exchange.apply({token,characterId:s.id,...extra});
      const move=(id:string)=>f.library.changeProfileTrash({kind:'deck',id,restore:false});
      const first=await apply((await inspect()).token);
      const repeated=await inspect();
      expect(repeated.existing).toBe(true);
      expect((await apply(repeated.token)).deckId).toBe(first.deckId);
      const optional=await inspect();
      expect(optional.alternativeNew?.reusedCardCount).toBe(2);
      const second=await apply(optional.token,{createAnother:true});
      expect(second.deckId).not.toBe(first.deckId);
      move(first.deckId);move(second.deckId);
      move(s.deckId);
      expect(f.library.getLibrary().profiles[0].activeDeckId).toBeUndefined();
      const updated:CastOption[]=[{id:'local-review',label:'가져온 뒤 편집한 비용',costs:[]}];
      change(f,s.id,{type:'save_costs',scope:'character',cardId:s.c.id,castOptions:updated,bindings:[]});
      const archived=()=>f.store.db.prepare('SELECT * FROM deck_trash ORDER BY deck_id').all();
      const saved=archived();
      const preview=await inspect();
      expect(preview.archivedDecks?.map(deck=>deck.id)).toEqual(expect.arrayContaining([first.deckId,second.deckId]));
      expect(archived()).toEqual(saved);
      const third=await apply(preview.token);
      expect(third.summary?.created).toEqual([]);
      expect(third.library.profiles[0].activeDeckId).toBe(third.deckId);
      expect(f.resources.snapshot(s.id).costOverrides?.find(item=>item.cardId===s.c.id)?.castOptions).toEqual(updated);
      expect(archived()).toEqual(saved);
      const recover=await inspect();
      await expect(apply(recover.token,{restoreDeckId:s.deckId})).rejects.toThrow(/복원할 덱/);
      const restored=await apply(recover.token,{restoreDeckId:first.deckId});
      expect(restored).toMatchObject({restoredDeck:true,deckId:first.deckId});
      expect(restored.library.decks.find(deck=>deck.id===first.deckId)?.cardIds).toEqual(first.library.decks.find(deck=>deck.id===first.deckId)?.cardIds);
      expect(f.resources.snapshot(s.id).resources.find(resource=>resource.ownedDefinitionId)?.remaining).toBe(5);
      expect(f.resources.snapshot(s.id).events.some(event=>event.type==='card_used')).toBe(true);
      const purge=new ProfilePurge(f.store.db);
      const target={kind:'deck',id:second.deckId};
      const stale=await inspect();
      purge.apply({target,quote:purge.preview(target).quote,phrase:'영구 삭제'});
      await expect(apply(stale.token,{restoreDeckId:second.deckId})).rejects.toThrow(/변경/);
      expect((await inspect()).archivedDecks??[]).not.toContainEqual(expect.objectContaining({id:second.deckId}));
      expect(f.store.db.prepare('SELECT * FROM deck_exchange_imports WHERE deck_id=?').get(second.deckId)).toBeUndefined();
      expect(f.library.getLibrary().cards).toEqual(first.library.cards);
    } finally {f.store.close();}
  });

  it('purges only confirmed trash, rolls back on failure, and keeps shared cards, images, and the other character intact',()=>{
    const f=fixture();
    try {
      const s=seed(f);
      const other=newProfile(f,'유지할 캐릭터');
      const another=newProfile(f,'두 번째 휴지통 캐릭터');
      f.library.setDeckCards({deckId:other.activeDeckId,cardIds:[s.c.id],operation:'add'});
      const independent=f.resources.snapshot(other.id);
      const shared=f.library.getLibrary().cards;
      const purge=new ProfilePurge(f.store.db);
      const trash=(kind:'profile'|'deck',id:string)=>f.library.changeProfileTrash({kind,id,restore:false});
      const empty={kind:'empty'};
      expect(()=>purge.preview({kind:'deck',id:other.activeDeckId})).toThrow(/휴지통/);
      trash('deck',s.deckId);
      expect(()=>new EditStore(f.store).preview({type:'deck_cards',deckId:s.deckId,operation:'add',cardIds:[s.c.id]})).toThrow(/휴지통/);
      const stale=purge.preview(empty);
      trash('profile',s.id);
      trash('profile',another.id);
      expect(()=>purge.apply({target:empty,quote:stale.quote,phrase:'영구 삭제'})).toThrow(/변경/);
      const owner={kind:'profile',id:s.id};
      const preview=purge.preview(owner);
      expect(preview).toMatchObject({characters:['보내는 캐릭터'],decks:['보내는 캐릭터 · 교환 덱'],cards:2,resources:3});
      expect(preview.events).toBeGreaterThan(0);
      f.store.db.exec("CREATE TRIGGER representative_failure BEFORE DELETE ON character_profiles BEGIN SELECT RAISE(ABORT,'fixture rollback'); END");
      expect(()=>purge.apply({target:owner,quote:preview.quote,phrase:'영구 삭제'})).toThrow('fixture rollback');
      expect(purge.preview(owner)).toEqual(preview);
      f.store.db.exec('DROP TRIGGER representative_failure');
      purge.apply({target:owner,quote:preview.quote,phrase:'영구 삭제'});
      expect(f.library.getLibrary().profileTrash?.map(item=>item.id)).toEqual([another.id]);
      purge.apply({target:empty,quote:purge.preview(empty).quote,phrase:'영구 삭제'});
      expect(f.library.getLibrary().profiles.map(profile=>profile.id)).toEqual([other.id]);
      expect(f.library.getLibrary().cards).toEqual(shared);
      expect(f.resources.snapshot(other.id)).toEqual({...independent,sharedCostUsers:{}});
      expect(f.store.db.prepare('SELECT 1 FROM assets WHERE id=?').get('source-image')).toBeTruthy();
      expect(f.store.db.prepare('SELECT 1 FROM play_events WHERE character_id=?').get(s.id)).toBeUndefined();
      expect(f.store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {f.store.close();}
  });

  it('rejects unexpected paths, bad references, duplicate aliases and unsupported versions before writing; rolls back a late insert failure', async () => {
    const source = fixture(); const dest = fixture();
    try {
      const s = seed(source);
      const json = join(source.path, 'deck.json');
      await source.exchange.export(s.deckId, json);
      const portable = await readDeckDocument(json);
      const profile = newProfile(dest, '대상');
      const cases: [string, unknown][] = [
        ['version', { ...portable, schemaVersion: 90 }],
        ['path', { ...portable, cards: [{ ...portable.cards[1], image: { ...portable.cards[1].image, path: 'C:/outside.png' } }] }],
        ['reference', { ...portable, cards: [{ ...portable.cards[0], tags: ['unknown'] }] }],
        ['duplicate', { ...portable, cards: [portable.cards[1], portable.cards[1]] }],
        ['live state', { ...portable, cards: [{ ...portable.cards[1], remaining: 2 }] }],
      ];
      const previous = dest.library.getLibrary();
      for (const [name, value] of cases) {
        const file = join(dest.path, `${name}.json`);
        writeFileSync(file, JSON.stringify(value));
        await expect(dest.exchange.inspect(profile.id, file)).rejects.toThrow();
        expect(dest.library.getLibrary()).toEqual(previous);
      }
      const huge = join(dest.path, 'huge.json');
      writeFileSync(huge, Buffer.alloc(MAX_DECK_BYTES + 1));
      await expect(dest.exchange.inspect(profile.id, huge)).rejects.toThrow('16 MiB');
      expect(() => parseDeckDocument({ ...portable, cards: [{ ...portable.cards[1], ref: '../../path' }] })).toThrow();
      const preview = await dest.exchange.inspect(profile.id, json);
      dest.store.db.exec("CREATE TRIGGER unit_reject_late BEFORE INSERT ON deck_exchange_imports BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
      await expect(dest.exchange.apply({ token: preview.token, characterId: profile.id })).rejects.toThrow('fixture failure');
      expect(dest.library.getLibrary()).toEqual(previous);
      expect(dest.resources.snapshot(profile.id).resources).toEqual([]);
      expect(dest.store.db.prepare('SELECT count(*) AS n FROM card_owned_resources').get()).toMatchObject({ n: 0 });
      expect(dest.store.db.prepare('SELECT count(*) AS n FROM character_cost_overrides').get()).toMatchObject({ n: 0 });
      expect(dest.store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { source.store.close(); dest.store.close(); }
  });

  it('preserves the v8 database, and full ZIP restore keeps import receipts and live stored resources', async () => {
    const path = mkdtempSync(join(root, 'v8-'));
    mkdirSync(join(path, 'data'));
    const old = new DatabaseSync(join(path, 'data', 'app.sqlite3'));
    for (const migration of migrations.filter(m => m.version <= 8)) {
      old.exec(migration.sql);
      old.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(migration.version, 'before');
    }
    old.exec("PRAGMA user_version=8; INSERT INTO character_profiles(id,name,ruleset,level) VALUES ('old','기존 캐릭터','homebrew',5)");
    old.close();
    const f = fixture(path); const other = fixture();
    try {
      expect(f.library.getLibrary().profiles[0]).toMatchObject({ id: 'old', level: 5 });
      const migrationBackup = readdirSync(join(path, 'backups'));
      expect(migrationBackup).toEqual([expect.stringMatching(/^before-v8-to-v12-/)]);
      const backupDb = new DatabaseSync(join(path, 'backups', migrationBackup[0]), { readOnly: true });
      expect(backupDb.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 8 });
      backupDb.close();
      const s = seed(f);
      const json = join(path, 'deck.json');
      await f.exchange.export(s.deckId, json);
      const portrait = await f.exchange.inspect('old', json);
      await f.exchange.apply({ token: portrait.token, characterId: 'old' });
      const before = f.resources.snapshot('old');
      const zip = join(path, 'all.zip');
      await new BackupService(f.store, '1.3.0').exportTo(zip);
      const backup = new BackupService(other.store, '1.3.0');
      await backup.scheduleReplace((await backup.inspect(zip)).token);
      other.store.close();
      expect(applyPendingRestore(other.path).notice).toContain('복원했습니다');
      const restored = fixture(other.path);
      try {
        expect(restored.resources.snapshot('old')).toEqual(before);
        expect((await restored.exchange.inspect('old', json)).existing).toBe(true);
      } finally { restored.store.close(); }
    } finally { f.store.close(); if (other.store.db.isOpen) other.store.close(); }
  });
});
