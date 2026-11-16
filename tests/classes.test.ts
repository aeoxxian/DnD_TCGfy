import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { AppStore } from '../electron/store';
import { ResourceStore } from '../electron/resource-store';
import { LibraryStore } from '../electron/library-store';
import { migrations } from '../electron/migrations';
import { CLASS_NAMES, type ClassId, type ClassInput } from '../src/shared/class-contracts';
import { classResources } from '../src/shared/presets';
import { maximums } from '../src/shared/resource-engine';
import { cardSchema, type CardDefinition, type CastOption } from '../src/shared/contracts';
import type { ResourceAction, ResourceView } from '../src/shared/resources';
import reference from './fixtures/srd51-slots.json';

const root=resolve('artifacts/p3-unit');mkdirSync(root,{recursive:true});
function fixture(){const path=mkdtempSync(join(root,'case-'));const store=new AppStore(path);const library=new LibraryStore(store);library.createProfile({name:'A'});const a=library.getLibrary().profiles[0].id;return {path,store,library,a,resources:new ResourceStore(store)};}
type Fixture=ReturnType<typeof fixture>;
function change(f:Fixture,action:ResourceAction,id=f.a){return f.resources.change({requestId:randomUUID(),characterId:id,expectedRevision:f.resources.snapshot(id).revision,action});}
function configure(f:Fixture,classId:ClassInput['classId'],level:number,retire:'keep'|'archive'='keep',confirmRetire=false){const configuration={classId,level,charisma:16,retire};const preview=f.resources.previewClass({characterId:f.a,configuration});change(f,{type:'configure_class',configuration,quote:preview.quote,confirmRetire});return preview;}
function resource(f:Fixture,key:string){return f.resources.snapshot(f.a).resources.find(resource=>resource.presetKey?.endsWith(`:${key}`))!;}
function card(f:Fixture,base=1){return f.library.saveCards({cards:[{name:'검증 주문',kind:'spell',spellLevel:base,roles:['utility'],actions:['action'],range:{kind:'self'},tags:[]}]}).cards.at(-1)!;}
function costs(f:Fixture,card:CardDefinition,items:CastOption['costs'],bindings:{costKey:string;resourceInstanceId:string}[],casting:CastOption['casting']={mode:'standard',allowUpcast:true,allowBelowBase:false},scope:'shared'|'character'='shared'){change(f,{type:'save_costs',scope,confirmShared:true,cardId:card.id,castOptions:[{id:'cast',label:'시전',costs:items,casting}],bindings});}
function use(f:Fixture,c:CardDefinition,choices:Record<string,number>={},castingLevel?:number){const action={type:'use' as const,cardId:c.id,optionId:'cast',choices,castingLevel};const preview=f.resources.preview({characterId:f.a,action});return change(f,{...action,quote:preview.quote});}
function remaining(r:ResourceView){return r.kind==='counter'?r.remaining:r.remainingByLevel;}

describe('2014 PHB base class data, every level',()=>{
  it.each((Object.keys(CLASS_NAMES)as ClassId[]).flatMap(id=>Array.from({length:20},(_,i)=>[id,i+1]as const)))('%s level %i matches independent rule fixtures',(classId,level)=>{
    const resources=classResources({classId,level,charisma:16});
    const at=(key:string)=>resources.find(resource=>resource.key.endsWith(`:${key}`));
    const max=(key:string)=>at(key)?maximums({...at(key)!.template,id:'t',key,source:'class_2014',version:1},{level,abilityScores:{CHA:16}},{scope:'character'}):undefined;
    const sourceSlots=reference.classes[classId as keyof typeof reference.classes] as Record<string,Record<string,number>>|undefined;
    if(sourceSlots){const expected=sourceSlots[String(level)];expect(max('spell_slots')?.capacityByLevel??{}).toEqual(expected);}
    else expect(at('spell_slots')).toBeUndefined();
    const counts:Partial<Record<ClassId,Record<string,number|undefined>>>={
      barbarian:{rage:[2,2,3,3,3,4,4,4,4,4,4,5,5,5,5,5,6,6,6,6][level-1]},
      bard:{bardic_inspiration:3},cleric:{channel_divinity:level<2?undefined:level<6?1:level<18?2:3},
      druid:{wild_shape:level<2?undefined:2},fighter:{second_wind:1,action_surge:level<2?undefined:level<17?1:2,indomitable:level<9?undefined:level<13?1:level<17?2:3},
      monk:{ki:level<2?undefined:level},paladin:{lay_on_hands:5*level,divine_sense:4,channel_divinity:level<3?undefined:1,cleansing_touch:level<14?undefined:3},
      rogue:{stroke_of_luck:level<20?undefined:1},sorcerer:{sorcery_points:level<2?undefined:level},wizard:{arcane_recovery:1},
    };
    for(const [key,value]of Object.entries(counts[classId]??{}))expect(max(key)?.capacity).toBe(value);
    if(classId==='warlock'){
      const tiers=[1,1,2,2,3,3,4,4,5,5,5,5,5,5,5,5,5,5,5,5];const amounts=[1,2,2,2,2,2,2,2,2,2,3,3,3,3,3,3,4,4,4,4];
      expect(max('pact_slots')?.capacityByLevel).toEqual({[tiers[level-1]]:amounts[level-1]});
      for(const [tier,start]of [[6,11],[7,13],[8,15],[9,17]])expect(max(`arcanum_${tier}`)?.capacity).toBe(level<start?undefined:1);
    }
    if(classId==='barbarian')expect(at('rage')!.template.unlimited).toBe(level===20);
    if(classId==='druid'&&level>=2)expect(at('wild_shape')!.template.unlimited).toBe(level===20);
    for(const item of resources){expect(item.template.recovery.length).toBeGreaterThan(0);expect(item.template.name.length).toBeGreaterThan(0);}
    if(at('spell_slots'))expect(at('spell_slots')!.template.recovery).toEqual([{triggers:['long_rest'],amount:{type:'full'}}]);
    for(const key of ['second_wind','action_surge','ki','wild_shape','channel_divinity','stroke_of_luck'])if(at(key))expect(at(key)!.template.recovery).toEqual([{triggers:['short_rest','long_rest'],amount:{type:'full'}}]);
    for(const key of ['rage','lay_on_hands','divine_sense','cleansing_touch','indomitable','eldritch_master','arcanum_6','arcanum_7','arcanum_8','arcanum_9'])if(at(key))expect(at(key)!.template.recovery).toEqual([{triggers:['long_rest'],amount:{type:'full'}}]);
    if(classId==='sorcerer'&&level>=2&&level<20)expect(at('sorcery_points')!.template.recovery).toEqual([{triggers:['long_rest'],amount:{type:'full'}}]);
    if(classId==='wizard')expect(at('arcane_recovery')!.template.recovery).toEqual([{triggers:['manual'],amount:{type:'full'}}]);
    if(classId==='bard')expect(at('bardic_inspiration')!.template.recovery[0].triggers).toEqual(level<5?['long_rest']:['short_rest','long_rest']);
    if(classId==='warlock')expect(at('pact_slots')!.template.recovery[0].triggers).toEqual(['short_rest','long_rest']);
    if(classId==='sorcerer'&&level===20)expect(at('sorcery_points')!.template.recovery).toEqual([{triggers:['short_rest'],amount:{type:'fixed',value:4}},{triggers:['long_rest'],amount:{type:'full'}}]);
  });
});

describe('casting through generic resource transactions',()=>{
  it('spends only the selected standard tier and records the immutable cost and selection',()=>{
    const f=fixture();configure(f,'cleric',8);const c=card(f,1);const r=resource(f,'spell_slots');costs(f,c,[{type:'slot',costKey:'slot',slotSelection:'standard'}],[{costKey:'slot',resourceInstanceId:r.id}]);
    use(f,c,{slot:3});expect(remaining(resource(f,'spell_slots'))).toEqual({1:4,2:3,3:2,4:2});const event=f.resources.snapshot(f.a).events[0];expect(event.selectedSlotLevels).toEqual({slot:3});expect(event.costSnapshot?.option.costs).toEqual([{type:'slot',costKey:'slot',slotSelection:'standard'}]);change(f,{type:'undo'});expect(remaining(resource(f,'spell_slots'))).toEqual({1:4,2:3,3:3,4:2});f.store.close();
  });
  it('refuses standard below-base, disabled upcast, invalid kind, missing level and mismatched tracks without writes',()=>{
    const f=fixture();configure(f,'wizard',9);const c=card(f,3);const r=resource(f,'spell_slots');costs(f,c,[{type:'slot',costKey:'s',slotSelection:'standard'}],[{costKey:'s',resourceInstanceId:r.id}]);
    const before=f.resources.snapshot(f.a);expect(()=>use(f,c,{s:2})).toThrow('주문 레벨');expect(f.resources.snapshot(f.a)).toEqual(before);
    costs(f,c,[{type:'slot',costKey:'s',slotSelection:'standard'}],[{costKey:'s',resourceInstanceId:r.id}],{mode:'standard',allowUpcast:false,allowBelowBase:false});expect(()=>use(f,c,{s:4})).toThrow();
    costs(f,c,[{type:'slot',costKey:'s',slotSelection:'pact'}],[{costKey:'s',resourceInstanceId:r.id}],{mode:'pact',allowUpcast:true,allowBelowBase:false});expect(()=>use(f,c,{})).toThrow('종류');f.store.close();
  });
  it('permits homebrew downcast only when explicitly enabled and enforces custom min/max',()=>{
    const f=fixture();configure(f,'wizard',9);const c=card(f,3);const r=resource(f,'spell_slots');
    for(const allowBelowBase of [false,true]){costs(f,c,[{type:'slot',costKey:'s',slotSelection:'standard'}],[{costKey:'s',resourceInstanceId:r.id}],{mode:'homebrew',allowUpcast:true,allowBelowBase,minSlotLevel:2,maxSlotLevel:4});if(!allowBelowBase)expect(()=>use(f,c,{s:2})).toThrow();else{use(f,c,{s:2});expect(resource(f,'spell_slots').remainingByLevel!['2']).toBe(2);}}
    expect(()=>use(f,c,{s:1})).toThrow();expect(()=>use(f,c,{s:5})).toThrow();expect(()=>cardSchema.parse({...c,castOptions:[{id:'bad',label:'bad',costs:[],casting:{mode:'standard',allowUpcast:true,allowBelowBase:true}}]})).toThrow();f.store.close();
  });
  it('uses pact fixed tier, short/long rests and independent arcanum counts',()=>{
    const f=fixture();configure(f,'warlock',17);const c=card(f,1);const p=resource(f,'pact_slots');costs(f,c,[{type:'slot',costKey:'s',slotSelection:'pact'}],[{costKey:'s',resourceInstanceId:p.id}],{mode:'pact',allowUpcast:true,allowBelowBase:false});use(f,c);expect(resource(f,'pact_slots').remainingByLevel).toEqual({5:3});expect(()=>use(f,c,{s:4})).toThrow();
    const a=resource(f,'arcanum_6');const arcanum=card(f,6);costs(f,arcanum,[{type:'fixed',costKey:'a',amount:1}],[{costKey:'a',resourceInstanceId:a.id}],{mode:'homebrew',allowUpcast:false,allowBelowBase:false,minSlotLevel:6,maxSlotLevel:6});use(f,arcanum);change(f,{type:'recover',trigger:'short_rest'});expect(resource(f,'arcanum_6').remaining).toBe(0);expect(resource(f,'pact_slots').remainingByLevel).toEqual({5:4});change(f,{type:'recover',trigger:'long_rest'});expect(resource(f,'arcanum_6').remaining).toBe(1);for(const tier of [7,8,9])expect(resource(f,`arcanum_${tier}`).remaining).toBe(1);f.store.close();
  });
  it('cantrips skip slot bindings while custom point costs still apply; free and non-slot homebrew casting work',()=>{
    const f=fixture();const c=card(f,0);costs(f,c,[{type:'slot',costKey:'s',slotSelection:'standard'}],[]);use(f,c);expect(f.resources.snapshot(f.a).events[0].changes).toEqual([]);
    change(f,{type:'create_resource',scope:'character',template:{name:'영력',unit:'점',kind:'counter',capacity:{type:'fixed',value:5},recovery:[]}});const r=f.resources.snapshot(f.a).resources[0];costs(f,c,[{type:'slot',costKey:'s',slotSelection:'standard'},{type:'fixed',costKey:'p',amount:2}],[{costKey:'p',resourceInstanceId:r.id}]);use(f,c);expect(f.resources.snapshot(f.a).resources[0].remaining).toBe(3);
    const spell=card(f,3);costs(f,spell,[{type:'variable',costKey:'p',min:1,max:3,step:1}],[{costKey:'p',resourceInstanceId:r.id}],{mode:'homebrew',allowUpcast:true,allowBelowBase:true,minSlotLevel:1,maxSlotLevel:5});use(f,spell,{p:2},1);expect(f.resources.snapshot(f.a).resources[0].remaining).toBe(1);expect(f.resources.snapshot(f.a).events[0].castingLevel).toBe(1);f.store.close();
  });
  it('aggregates slots and custom costs atomically, protects quotes/replays and supports use Undo after restart',()=>{
    const f=fixture();configure(f,'cleric',8);const c=card(f,1);const r=resource(f,'spell_slots');const d=resource(f,'channel_divinity');change(f,{type:'adjust',resourceId:d.id,delta:-2});costs(f,c,[{type:'slot',costKey:'s',slotSelection:'standard'},{type:'fixed',costKey:'d',amount:1}],[{costKey:'s',resourceInstanceId:r.id},{costKey:'d',resourceInstanceId:d.id}]);const before=f.resources.snapshot(f.a);expect(()=>use(f,c,{s:3})).toThrow('부족');expect(f.resources.snapshot(f.a)).toEqual(before);
    change(f,{type:'recover',trigger:'short_rest'});const action={type:'use' as const,cardId:c.id,optionId:'cast',choices:{s:3}};const preview=f.resources.preview({characterId:f.a,action});const request={requestId:randomUUID(),characterId:f.a,expectedRevision:preview.revision,action:{...action,quote:preview.quote}};f.resources.change(request);expect(f.resources.change(request).replayed).toBe(true);f.store.close();const reopened=new AppStore(f.path);const repo=new ResourceStore(reopened);expect(repo.snapshot(f.a).resources.find(value=>value.id===r.id)!.remainingByLevel!['3']).toBe(2);repo.change({requestId:randomUUID(),characterId:f.a,expectedRevision:repo.snapshot(f.a).revision,action:{type:'undo'}});expect(repo.snapshot(f.a).resources.find(value=>value.id===r.id)!.remainingByLevel!['3']).toBe(3);reopened.close();
  });
});

describe('profile changes, preservation and undo',()=>{
  it('previews without writes, preserves per-tier spent amounts and new tiers, homebrew data and manual overrides',()=>{
    const f=fixture();change(f,{type:'create_resource',scope:'character',template:{name:'홈브루',unit:'점',kind:'counter',capacity:{type:'fixed',value:7},recovery:[]}});const custom=f.resources.snapshot(f.a).resources[0];change(f,{type:'adjust',resourceId:custom.id,delta:-3});configure(f,'cleric',8);const slots=resource(f,'spell_slots');change(f,{type:'adjust',resourceId:slots.id,slotLevel:4,delta:-1});const original=f.resources.snapshot(f.a);
    const preview=f.resources.previewClass({characterId:f.a,configuration:{classId:'cleric',level:9}});expect(f.resources.snapshot(f.a)).toEqual(original);expect(preview.resources.find(value=>value.id===slots.id)!.after!.remainingByLevel).toEqual({1:4,2:3,3:3,4:2,5:1});configure(f,'cleric',9);expect(resource(f,'spell_slots').id).toBe(slots.id);expect(f.resources.snapshot(f.a).resources.find(value=>value.id===custom.id)!.remaining).toBe(4);
    const d=resource(f,'channel_divinity');change(f,{type:'edit_resource',resourceId:d.id,overrides:{scope:'character',capacityOverride:8}});configure(f,'cleric',18);expect(resource(f,'channel_divinity').capacity).toBe(8);f.store.close();
  });
  it('carries consumed pact counts across level changes and restores class configuration after later uses are undone',()=>{
    const f=fixture();configure(f,'warlock',2);const old=resource(f,'pact_slots');change(f,{type:'adjust',resourceId:old.id,slotLevel:1,delta:-1});configure(f,'warlock',3);expect(resource(f,'pact_slots').remainingByLevel).toEqual({2:1});const c=card(f,1);costs(f,c,[{type:'slot',costKey:'s',slotSelection:'pact'}],[{costKey:'s',resourceInstanceId:old.id}],{mode:'pact',allowUpcast:true,allowBelowBase:false});
    // Cost configuration is a documented boundary; create a new class event after it.
    configure(f,'warlock',4);use(f,c);change(f,{type:'undo'});change(f,{type:'undo'});expect(f.resources.snapshot(f.a).profile?.level).toBe(3);expect(resource(f,'pact_slots').remainingByLevel).toEqual({2:1});f.store.close();
  });
  it('supports successive configuration undos, retains created rows and protects unrelated character/deck state',()=>{
    const f=fixture();configure(f,'wizard',1);const before=f.resources.snapshot(f.a);configure(f,'wizard',3);configure(f,'wizard',5);change(f,{type:'undo'});change(f,{type:'undo'});expect(f.resources.snapshot(f.a).profile).toEqual(before.profile);expect(f.resources.snapshot(f.a).resources).toEqual(before.resources);expect(f.store.db.prepare('SELECT count(*) n FROM resource_templates').get()!.n).toBeGreaterThan(2);f.store.close();
  });
  it('requires explicit retirement confirmation and rejects stale preview and external state changes',()=>{
    const f=fixture();configure(f,'warlock',11);const configuration={classId:'rogue' as const,level:1,retire:'archive' as const};const preview=f.resources.previewClass({characterId:f.a,configuration});expect(preview.requiresRetireConfirmation).toBe(true);expect(()=>change(f,{type:'configure_class',configuration,quote:preview.quote})).toThrow('동의');
    change(f,{type:'adjust',resourceId:resource(f,'arcanum_6').id,delta:-1});expect(()=>change(f,{type:'configure_class',configuration,quote:preview.quote,confirmRetire:true})).toThrow('미리보기');configure(f,'rogue',1,'archive',true);expect(f.resources.snapshot(f.a).resources).toHaveLength(0);change(f,{type:'undo'});expect(resource(f,'arcanum_6').remaining).toBe(0);f.store.close();
  });
  it('keeps retired resources as manual modules by default and models unlimited resources without sentinel quantities',()=>{
    const f=fixture();configure(f,'barbarian',19);const r=resource(f,'rage');change(f,{type:'adjust',resourceId:r.id,delta:-2});configure(f,'barbarian',20);expect(resource(f,'rage').unlimited).toBe(true);expect(()=>change(f,{type:'adjust',resourceId:r.id,delta:1})).toThrow('무제한');configure(f,'barbarian',19);expect(resource(f,'rage').remaining).toBe(0);change(f,{type:'undo'});expect(resource(f,'rage').unlimited).toBe(true);configure(f,'rogue',1);expect(f.resources.snapshot(f.a).resources[0].presetKey).toBeUndefined();expect(f.resources.snapshot(f.a).resources[0].unlimited).toBe(true);f.store.close();
  });
  it('rejects class Undo after out-of-band profile modification and keeps the changed state',()=>{
    const f=fixture();configure(f,'wizard',3);f.store.db.prepare('UPDATE character_profiles SET level=4 WHERE id=?').run(f.a);const before=f.resources.snapshot(f.a);expect(()=>change(f,{type:'undo'})).toThrow('일치');expect(f.resources.snapshot(f.a)).toEqual(before);f.store.close();
  });
  it('preserves legacy custom homebrew class IDs when changing level without a preset',()=>{
    const f=fixture();f.store.db.prepare("UPDATE character_profiles SET class_id='homebrew-spirit',ruleset='homebrew' WHERE id=?").run(f.a);configure(f,'homebrew',7);expect(f.resources.snapshot(f.a).profile).toMatchObject({classId:'homebrew-spirit',ruleset:'homebrew',level:7});change(f,{type:'undo'});expect(f.resources.snapshot(f.a).profile?.classId).toBe('homebrew-spirit');f.store.close();
  });
  it('requires explicit ability inputs and clamps Bard/Paladin minima without inventing a default score',()=>{
    const f=fixture();expect(()=>f.resources.previewClass({characterId:f.a,configuration:{classId:'bard',level:1}})).toThrow('능력치');
    for(const classId of ['bard','paladin']as const){const configuration={classId,level:14,charisma:1,retire:'keep' as const};const preview=f.resources.previewClass({characterId:f.a,configuration});change(f,{type:'configure_class',configuration,quote:preview.quote});}
    expect(resource(f,'divine_sense').capacity).toBe(0);expect(resource(f,'cleansing_touch').capacity).toBe(1);f.store.close();
  });
  it('rolls back profile, templates, resources, events and receipts on persistence failure',()=>{
    const f=fixture();configure(f,'wizard',1);const before=f.resources.snapshot(f.a);const templates=f.store.db.prepare('SELECT * FROM resource_templates').all();f.store.db.exec("CREATE TRIGGER fail_class BEFORE INSERT ON play_events BEGIN SELECT RAISE(ABORT,'fault'); END");expect(()=>configure(f,'wizard',5)).toThrow('fault');expect(f.resources.snapshot(f.a)).toEqual(before);expect(f.store.db.prepare('SELECT * FROM resource_templates').all()).toEqual(templates);f.store.close();
  });
  it('keeps class Undo valid after restart and rejects mismatched persisted state without resetting',()=>{
    const f=fixture();configure(f,'wizard',1);configure(f,'wizard',3);f.store.close();const store=new AppStore(f.path);const resources=new ResourceStore(store);resources.change({requestId:randomUUID(),characterId:f.a,expectedRevision:resources.snapshot(f.a).revision,action:{type:'undo'}});expect(resources.snapshot(f.a).profile?.level).toBe(1);store.close();
  });
});

describe('shared cards and v3 migration protection',()=>{
  it('requires review for shared edits, keeps immutable use history and allows character-only cost overrides',()=>{
    const f=fixture();configure(f,'cleric',5);const c=card(f,1);const r=resource(f,'spell_slots');costs(f,c,[{type:'slot',costKey:'s',slotSelection:'standard'}],[{costKey:'s',resourceInstanceId:r.id}]);use(f,c,{s:1});const event=f.resources.snapshot(f.a).events[0];
    f.library.createProfile({name:'B'});const b=f.library.getLibrary().profiles[1].id;const deck=f.library.getLibrary().profiles[1].activeDeckId!;f.library.setDeckCards({deckId:deck,cardIds:[c.id]});
    const shared={type:'save_costs' as const,cardId:c.id,castOptions:[{id:'free',label:'무료',costs:[]}],bindings:[]};expect(()=>change(f,shared)).toThrow('동의');change(f,{...shared,confirmShared:true});expect(f.resources.snapshot(f.a).events.find(value=>value.id===event.id)!.costSnapshot).toEqual(event.costSnapshot);
    const bBefore=f.resources.snapshot(b);costs(f,c,[{type:'fixed',costKey:'custom',amount:1}],[{costKey:'custom',resourceInstanceId:resource(f,'channel_divinity').id}],undefined,'character');expect(f.library.getLibrary().cards.find(value=>value.id===c.id)!.castOptions[0].id).toBe('free');expect(f.resources.snapshot(b)).toEqual(bBefore);expect(f.resources.snapshot(f.a).costOverrides).toHaveLength(1);change(f,{type:'clear_cost_override',cardId:c.id});expect(f.resources.snapshot(f.a).costOverrides).toEqual([]);f.store.close();
  });
  it('backs up v3, adds ownership and overrides without reclassifying or resetting old live resources',()=>{
    const path=mkdtempSync(join(root,'legacy-'));mkdirSync(join(path,'data'));const db=new DatabaseSync(join(path,'data/app.sqlite3'));
    for(const m of migrations.filter(m=>m.version<=3)){db.exec(m.sql);db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(m.version,'original');}db.exec('PRAGMA user_version=3');db.exec("INSERT INTO character_profiles(id,name,ruleset,level) VALUES ('a','old','homebrew',1); INSERT INTO resource_templates(id,key,name,kind,definition_json,source,version) VALUES ('t','ki','legacy','counter','{\"capacity\":{\"type\":\"fixed\",\"value\":5}}','user',1); INSERT INTO resource_instances(id,character_id,template_id,overrides_json,current_state_json) VALUES ('r','a','t','{}','{\"remaining\":2}')");db.close();
    const store=new AppStore(path);const r=new ResourceStore(store).snapshot('a');expect(r.resources[0].remaining).toBe(2);expect(r.resources[0].presetKey).toBeUndefined();expect(r.costOverrides).toEqual([]);const backup=new DatabaseSync(join(path,'backups',readdirSync(join(path,'backups'))[0]),{readOnly:true});expect(backup.prepare('PRAGMA user_version').get()!.user_version).toBe(3);backup.close();expect(store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);store.close();
  });
});
