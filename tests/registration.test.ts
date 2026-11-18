import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { AppStore } from '../electron/store';
import { LibraryStore } from '../electron/library-store';
import { ResourceStore } from '../electron/resource-store';
import { RegistrationStore } from '../electron/registration-store';
import type { CardDraft, InitialRules, CardDefinition } from '../src/shared/contracts';
import type { ResourceAction } from '../src/shared/resources';

const root=resolve('artifacts/registration-unit');mkdirSync(root,{recursive:true});
const draft=(name='새 카드'):CardDraft=>({name,kind:'other',roles:['utility'],actions:['action'],range:{kind:'self'},tags:[]});
function fixture(){const path=mkdtempSync(join(root,'case-')),store=new AppStore(path),library=new LibraryStore(store),resources=new ResourceStore(store);library.createProfile({name:'A'});const a=library.getLibrary().profiles[0];return{path,store,library,resources,a,registration:new RegistrationStore(store,library,resources)};}
type Fixture=ReturnType<typeof fixture>;
function change(f:Fixture,action:ResourceAction,id=f.a.id){return f.resources.change({requestId:randomUUID(),characterId:id,expectedRevision:f.resources.snapshot(id).revision,action});}
function counter(f:Fixture){change(f,{type:'create_resource',scope:'character',template:{name:'영력',unit:'점',kind:'counter',capacity:{type:'fixed',value:7},recovery:[]}});return f.resources.snapshot(f.a.id).resources[0];}
function rules(f:Fixture,patch:Partial<InitialRules>={}):InitialRules{return{requestId:randomUUID(),configured:true,scope:'shared',characterId:f.a.id,expectedRevision:f.resources.snapshot(f.a.id).revision,castOptions:[{id:'use',label:'일반 사용',costs:[]}],bindings:[],...patch};}
function register(f:Fixture,initialRules=rules(f),cards=[draft()]){return f.registration.save({cards,registrationTarget:{characterId:f.a.id,deckId:f.a.activeDeckId},initialRules});}
function use(f:Fixture,card:CardDefinition,choices:Record<string,number>={},id=f.a.id){const action={type:'use' as const,cardId:card.id,optionId:'use',choices},preview=f.resources.preview({characterId:id,action});return change(f,{...action,quote:preview.quote},id);}

describe('P4-C atomic registration',()=>{
  it('allows an unbound cantrip slot option without a character and never spends a slot',()=>{
    const store=new AppStore(mkdtempSync(join(root,'cantrip-'))),library=new LibraryStore(store),resources=new ResourceStore(store),registration=new RegistrationStore(store,library,resources);
    const result=registration.save({cards:[{...draft('소마법'),kind:'spell',spellLevel:0}],registrationTarget:null,initialRules:{requestId:randomUUID(),configured:true,scope:'shared',castOptions:[{id:'use',label:'소마법',costs:[{type:'slot',costKey:'s',slotSelection:'standard',autoBind:false}]}],bindings:[]}});library.createProfile({name:'A'});const id=library.getLibrary().profiles[0].id,preview=resources.preview({characterId:id,action:{type:'use',cardId:result.cards[0].id,optionId:'use',choices:{}}});expect(preview.canUse).toBe(true);expect(preview.changes).toEqual([]);store.close();
  });
  it('requires shared-impact confirmation when an unconfigured common card becomes explicitly free',()=>{
    const f=fixture(),card=register(f,rules(f,{configured:false})).cards[0];f.library.createProfile({name:'B'});const b=f.library.getLibrary().profiles[1];f.library.setDeckCards({deckId:b.activeDeckId,cardIds:[card.id]});
    const action={type:'save_costs' as const,scope:'shared' as const,cardId:card.id,castOptions:card.castOptions,bindings:[]};expect(()=>change(f,action)).toThrow('동의');expect(f.library.getLibrary().cards[0].costStatus).toBe('unconfigured');change(f,{...action,confirmShared:true});expect(f.library.getLibrary().cards[0].costStatus).toBe('configured');f.store.close();
  });
  it('saves one automatic slot rule with image metadata and active deck, then spends only 4/5/6 selected tiers',()=>{
    const f=fixture(),configuration={classId:'wizard' as const,level:11};const preview=f.resources.previewClass({characterId:f.a.id,configuration});change(f,{type:'configure_class',configuration,quote:preview.quote});
    const before=f.resources.snapshot(f.a.id);const initial=rules(f,{castOptions:[{id:'use',label:'주문',costs:[{type:'slot',costKey:'s',slotSelection:'standard',autoBind:true}]}]});
    const lib=register(f,initial,[{...draft(),kind:'spell',spellLevel:4}]),card=lib.cards[0];expect(card.costStatus).toBe('configured');expect(card.castOptions[0].costs).toHaveLength(1);expect(lib.decks[0].cardIds).toContain(card.id);expect(f.resources.snapshot(f.a.id).resources).toEqual(before.resources);
    for(const level of [4,5,6]){use(f,card,{s:level});const actual=f.resources.snapshot(f.a.id).resources[0];expect(actual.remainingByLevel).toEqual({...before.resources[0].remainingByLevel,[level]:before.resources[0].remainingByLevel![level]-1});change(f,{type:'undo'});}
    expect(()=>use(f,card,{s:3})).toThrow();expect(f.store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);f.store.close();
  });
  it('distinguishes unconfigured from explicit free and blocks normal/exception use on unconfigured cards',()=>{
    const f=fixture();const unconfigured=register(f,rules(f,{configured:false})).cards[0];expect(unconfigured.costStatus).toBe('unconfigured');const p=f.resources.preview({characterId:f.a.id,action:{type:'use',cardId:unconfigured.id,optionId:unconfigured.castOptions[0].id,choices:{}}});expect(p.canUse).toBe(false);expect(p.canOverride).toBe(false);expect(p.reason).toContain('비용 미설정');
    const free=register(f,rules(f),[draft('무소모')]).cards.at(-1)!;const before=f.resources.snapshot(f.a.id).resources;use(f,free);expect(f.resources.snapshot(f.a.id).resources).toEqual(before);f.store.close();
  });
  it('supports fixed, variable, multiple costs, multiple ways and explicit homebrew downcasting',()=>{
    const f=fixture(),r=counter(f);const c=register(f,rules(f,{castOptions:[{id:'use',label:'복합',costs:[{type:'fixed',costKey:'fixed',amount:1},{type:'variable',costKey:'variable',min:2,max:4,step:2}]},{id:'free',label:'무소모 방식',costs:[]}],bindings:[{costKey:'fixed',resourceInstanceId:r.id},{costKey:'variable',resourceInstanceId:r.id}]})).cards[0];use(f,c,{variable:4});expect(f.resources.snapshot(f.a.id).resources[0].remaining).toBe(2);change(f,{type:'undo'});
    const configuration={classId:'wizard' as const,level:11};change(f,{type:'configure_class',configuration,quote:f.resources.previewClass({characterId:f.a.id,configuration}).quote});const spell=register(f,rules(f,{castOptions:[{id:'use',label:'홈브루',costs:[{type:'slot',costKey:'s',slotSelection:'standard',autoBind:true}],casting:{mode:'homebrew',allowUpcast:true,allowBelowBase:true,minSlotLevel:3,maxSlotLevel:6}}]}),[{...draft('홈브루'),kind:'spell',spellLevel:4}]).cards.at(-1)!;use(f,spell,{s:3});expect(f.resources.snapshot(f.a.id).resources.find(r=>r.kind==='slot_track')!.remainingByLevel![3]).toBe(2);f.store.close();
  });
  it('keeps character-only rules separate and leaves every existing shared definition unchanged',()=>{
    const f=fixture();const old=f.library.saveCards({cards:[draft('기존')]}).cards[0];const r=counter(f);const lib=register(f,rules(f,{scope:'character',castOptions:[{id:'use',label:'전용',costs:[{type:'fixed',costKey:'p',amount:1}]}],bindings:[{costKey:'p',resourceInstanceId:r.id}]}));const card=lib.cards.at(-1)!;expect(card.costStatus).toBe('unconfigured');expect(lib.cards[0]).toEqual(old);use(f,card);expect(f.resources.snapshot(f.a.id).resources[0].remaining).toBe(6);
    f.library.createProfile({name:'B'});const b=f.library.getLibrary().profiles[1].id;const p=f.resources.preview({characterId:b,action:{type:'use',cardId:card.id,optionId:'use',choices:{}}});expect(p.canUse).toBe(false);expect(p.reason).toContain('비용 미설정');f.store.close();
  });
  it('rolls back both cards, deck membership, rules, bindings, events, revisions and receipts when the second binding write fails',()=>{
    const f=fixture(),r=counter(f),before=f.resources.snapshot(f.a.id),deck=f.library.getLibrary().decks;
    f.store.db.exec("CREATE TRIGGER fail_second BEFORE INSERT ON card_bindings WHEN (SELECT name FROM card_definitions WHERE id=NEW.card_id)='둘' BEGIN SELECT RAISE(ABORT,'injected write failure'); END;");
    const input=rules(f,{castOptions:[{id:'use',label:'사용',costs:[{type:'fixed',costKey:'p',amount:1}]}],bindings:[{costKey:'p',resourceInstanceId:r.id}]});expect(()=>register(f,input,[draft('하나'),draft('둘')])).toThrow();expect(f.library.getLibrary().cards).toEqual([]);expect(f.library.getLibrary().decks).toEqual(deck);expect(f.resources.snapshot(f.a.id)).toEqual(before);expect(f.store.db.prepare("SELECT * FROM settings WHERE key LIKE 'registration:%'").all()).toEqual([]);
    f.store.db.exec('DROP TRIGGER fail_second');register(f,input,[draft('하나'),draft('둘')]);expect(f.library.getLibrary().cards).toHaveLength(2);f.store.close();
  });
  it('replays a lost-response retry without duplicates after restart and rejects a reused request with changed content',()=>{
    const f=fixture();const initial=rules(f),first=register(f,initial);const snapshot=f.resources.snapshot(f.a.id);register(f,{...initial,expectedRevision:f.resources.snapshot(f.a.id).revision});expect(f.library.getLibrary()).toEqual(first);expect(f.resources.snapshot(f.a.id)).toEqual(snapshot);f.store.close();
    const store=new AppStore(f.path),library=new LibraryStore(store),resources=new ResourceStore(store),registration=new RegistrationStore(store,library,resources);registration.save({cards:[draft()],registrationTarget:{characterId:f.a.id,deckId:f.a.activeDeckId},initialRules:initial});expect(library.getLibrary().cards).toHaveLength(1);expect(()=>registration.save({cards:[draft('다른 내용')],registrationTarget:{characterId:f.a.id,deckId:f.a.activeDeckId},initialRules:initial})).toThrow('다른 카드');store.close();
  });
  it('rejects stale/foreign bindings and any attempt to overwrite existing cards through initial rules',()=>{
    const f=fixture(),r=counter(f);const initial=rules(f,{castOptions:[{id:'use',label:'사용',costs:[{type:'fixed',costKey:'p',amount:1}]}],bindings:[{costKey:'p',resourceInstanceId:'foreign'}]});expect(()=>register(f,initial)).toThrow('현재 캐릭터');expect(f.library.getLibrary().cards).toEqual([]);
    const stale=rules(f);change(f,{type:'adjust',resourceId:r.id,delta:-1});expect(()=>register(f,stale)).toThrow('바뀌');const old=f.library.saveCards({cards:[draft()]}).cards[0];expect(()=>register(f,rules(f),[{...draft(),id:old.id}])).toThrow('새 카드');expect(f.library.getLibrary().cards[0]).toEqual(old);f.store.close();
  });
  it('preserves the prior resource Undo through new registration and keeps independent cost editing as a boundary',()=>{
    const f=fixture(),r=counter(f);change(f,{type:'adjust',resourceId:r.id,delta:-1});const before=f.resources.snapshot(f.a.id),card=register(f).cards[0];expect(f.resources.snapshot(f.a.id).undoTargetId).toBe(before.undoTargetId);change(f,{type:'undo'});expect(f.resources.snapshot(f.a.id).resources[0].remaining).toBe(7);change(f,{type:'save_costs',cardId:card.id,castOptions:card.castOptions,bindings:[],scope:'shared'});expect(f.resources.snapshot(f.a.id).undoTargetId).toBeUndefined();f.store.close();
  });
  it('allows future automatic slots without a character but never resource bindings without an owner',()=>{
    const store=new AppStore(mkdtempSync(join(root,'no-profile-'))),library=new LibraryStore(store),resources=new ResourceStore(store),registration=new RegistrationStore(store,library,resources);
    const initial:InitialRules={requestId:randomUUID(),configured:true,scope:'shared',castOptions:[{id:'use',label:'슬롯',costs:[{type:'slot',costKey:'s',slotSelection:'standard',autoBind:true}]}],bindings:[]};const lib=registration.save({cards:[{...draft(),kind:'spell',spellLevel:1}],registrationTarget:null,initialRules:initial});expect(lib.cards[0].costStatus).toBe('configured');store.close();
  });
});

describe('v1.2 Phase 1 · new resource created inside the registration transaction',()=>{
  const DRAFT='draft-charges';
  const charges=(patch:Record<string,unknown>={})=>({name:'지팡이 충전',unit:'회',kind:'counter',capacity:{type:'fixed',value:7},recovery:[{triggers:['dawn'],amount:{type:'fixed',value:3}}],...patch});
  const withNew=(f:Fixture,patch:Partial<InitialRules>={},template:Record<string,unknown>=charges())=>rules(f,{castOptions:[{id:'use',label:'충전 사용',costs:[{type:'fixed',costKey:'c',amount:1}]}],bindings:[{costKey:'c',resourceInstanceId:DRAFT}],newResources:[{draftId:DRAFT,template}],...patch});
  const templates=(f:Fixture)=>f.store.db.prepare("SELECT name FROM resource_templates WHERE source='user'").all().map(row=>(row as {name:string}).name);

  it('creates the counter with the card, binds the cost to it, links the deck, and the card spends from it',()=>{
    const f=fixture(),before=f.resources.snapshot(f.a.id);
    const lib=register(f,withNew(f)),card=lib.cards[0],after=f.resources.snapshot(f.a.id),created=after.resources.find(r=>r.name==='지팡이 충전')!;
    expect(lib.decks[0].cardIds).toEqual([card.id]);expect(card.costStatus).toBe('configured');
    expect(created).toMatchObject({kind:'counter',unit:'회',capacity:7,remaining:7,overrides:{scope:'character'}});expect(created.id).not.toBe(DRAFT);
    expect(after.bindings).toEqual([expect.objectContaining({cardId:card.id,costKey:'c',resourceInstanceId:created.id})]);
    expect(templates(f)).toEqual(['지팡이 충전']);expect(after.events[0].label).toBe('지팡이 충전 자원 생성');expect(after.revision).toBe(before.revision+1);
    use(f,card);expect(f.resources.snapshot(f.a.id).resources.find(r=>r.id===created.id)!.remaining).toBe(6);
    change(f,{type:'recover',trigger:'dawn'});expect(f.resources.snapshot(f.a.id).resources.find(r=>r.id===created.id)!.remaining).toBe(7);
    expect(f.store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);f.store.close();
  });
  it('binds every card of a multi-image registration to one new resource and supports variable point costs',()=>{
    const f=fixture();const lib=register(f,withNew(f,{castOptions:[{id:'use',label:'포인트',costs:[{type:'variable',costKey:'c',min:1,max:3,step:1}]}]},charges({name:'영혼 점수',unit:'점'})),[draft('하나'),draft('둘')]);
    const resources=f.resources.snapshot(f.a.id).resources;expect(resources.map(r=>r.name)).toEqual(['영혼 점수']);
    // Bindings come back in no particular order (no ORDER BY, random card ids), so compare them as a set.
    expect(f.resources.snapshot(f.a.id).bindings.map(b=>[b.cardId,b.resourceInstanceId]).sort()).toEqual(lib.cards.map(card=>[card.id,resources[0].id]).sort());
    use(f,lib.cards[1],{c:3});expect(f.resources.snapshot(f.a.id).resources[0].remaining).toBe(4);f.store.close();
  });
  it('rolls back the resource, template, card, deck link, bindings, events and receipt when a later write fails',()=>{
    const f=fixture(),before=f.resources.snapshot(f.a.id),decks=f.library.getLibrary().decks;
    f.store.db.exec("CREATE TRIGGER fail_binding BEFORE INSERT ON card_bindings BEGIN SELECT RAISE(ABORT,'injected write failure'); END;");
    const input=withNew(f);expect(()=>register(f,input)).toThrow();
    expect(f.library.getLibrary().cards).toEqual([]);expect(f.library.getLibrary().decks).toEqual(decks);expect(f.resources.snapshot(f.a.id)).toEqual(before);expect(templates(f)).toEqual([]);
    expect(f.store.db.prepare('SELECT COUNT(*) AS n FROM resource_instances').get()).toEqual({n:0});expect(f.store.db.prepare("SELECT * FROM settings WHERE key LIKE 'registration:%'").all()).toEqual([]);
    f.store.db.exec('DROP TRIGGER fail_binding');register(f,input);expect(f.resources.snapshot(f.a.id).resources.map(r=>r.name)).toEqual(['지팡이 충전']);f.store.close();
  });
  it('replays a retried request once: no second card, resource or template',()=>{
    const f=fixture(),input=withNew(f);register(f,input);const once=f.resources.snapshot(f.a.id);
    register(f,{...input,expectedRevision:once.revision});expect(f.library.getLibrary().cards).toHaveLength(1);expect(f.resources.snapshot(f.a.id)).toEqual(once);expect(templates(f)).toEqual(['지팡이 충전']);f.store.close();
  });
  it('refuses duplicates and leaves existing resources untouched',()=>{
    const f=fixture(),existing=counter(f),before=f.resources.snapshot(f.a.id);
    expect(()=>register(f,withNew(f,{},charges({name:'  영력 '})))).toThrow('같은 이름의 자원 “영력”');
    expect(()=>register(f,withNew(f,{bindings:[{costKey:'c',resourceInstanceId:DRAFT}],newResources:[{draftId:DRAFT,template:charges()},{draftId:'other',template:charges({name:'지팡이 충전'})}]}))).toThrow();
    expect(()=>register(f,withNew(f,{newResources:[{draftId:existing.id,template:charges()}],bindings:[{costKey:'c',resourceInstanceId:existing.id}]}))).toThrow('겹칩니다');
    expect(f.resources.snapshot(f.a.id)).toEqual(before);expect(f.library.getLibrary().cards).toEqual([]);f.store.close();
  });
  it('rejects unbound drafts, slot tracks, unconfigured rules and registrations without a character',()=>{
    const f=fixture(),before=f.resources.snapshot(f.a.id);
    expect(()=>register(f,withNew(f,{bindings:[]}))).toThrow();
    expect(()=>register(f,withNew(f,{castOptions:[{id:'use',label:'무소모',costs:[]}],bindings:[]}))).toThrow('연결하지 않은 새 자원');
    expect(()=>register(f,withNew(f,{},{name:'트랙',unit:'슬롯',kind:'slot_track',slotKind:'generic',slotCapacity:{'1':{type:'fixed',value:2}},recovery:[]}))).toThrow('횟수·포인트');
    expect(()=>register(f,withNew(f,{},charges({name:''})))).toThrow('새 자원 설정');
    expect(()=>register(f,{...withNew(f),configured:false,castOptions:[{id:'use',label:'비용 미설정',costs:[]}],bindings:[]})).toThrow();
    expect(f.resources.snapshot(f.a.id)).toEqual(before);expect(templates(f)).toEqual([]);
    const store=new AppStore(mkdtempSync(join(root,'no-character-'))),library=new LibraryStore(store),resources=new ResourceStore(store),registration=new RegistrationStore(store,library,resources);
    expect(()=>registration.save({cards:[draft()],registrationTarget:null,initialRules:{requestId:randomUUID(),configured:true,scope:'shared',castOptions:[{id:'use',label:'충전',costs:[{type:'fixed',costKey:'c',amount:1}]}],bindings:[{costKey:'c',resourceInstanceId:DRAFT}],newResources:[{draftId:DRAFT,template:charges()}]}})).toThrow('캐릭터를 선택한 등록');
    expect(library.getLibrary().cards).toEqual([]);store.close();f.store.close();
  });
});
