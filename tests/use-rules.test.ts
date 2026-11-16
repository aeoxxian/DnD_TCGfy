import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AppStore } from '../electron/store';
import { LibraryStore } from '../electron/library-store';
import { ResourceStore } from '../electron/resource-store';
import { buildBasicRule, emptyBasicRule, inferBasicRule, describeUseRules } from '../src/shared/use-rules';
import type { ResourceAction } from '../src/shared/resources';
import type { CardDefinition } from '../src/shared/contracts';

const root=resolve('artifacts/p31-unit');mkdirSync(root,{recursive:true});
function fixture(){const path=mkdtempSync(join(root,'case-'));const store=new AppStore(path);const library=new LibraryStore(store);library.createProfile({name:'A'});const a=library.getLibrary().profiles[0].id;const resources=new ResourceStore(store);return{path,store,library,resources,a};}
type Fixture=ReturnType<typeof fixture>;
function change(f:Fixture,action:ResourceAction,id=f.a){return f.resources.change({requestId:randomUUID(),characterId:id,expectedRevision:f.resources.snapshot(id).revision,action});}
function preset(f:Fixture,id=f.a,classId:'wizard'|'warlock'='wizard',level=11){const configuration={classId,level};const p=f.resources.previewClass({characterId:id,configuration});change(f,{type:'configure_class',configuration,quote:p.quote},id);return f.resources.snapshot(id).resources.find(resource=>resource.template.slotKind===(classId==='warlock'?'pact':'standard'))!;}
function card(f:Fixture,base?:number){return f.library.saveCards({cards:[{name:'한 장의 주문',kind:'spell',spellLevel:base,roles:['utility'],actions:['action'],range:{kind:'self'},tags:[]}]}).cards.at(-1)!;}
function automatic(f:Fixture,c:CardDefinition,base=4,id=f.a,family:'standard'|'pact'='standard'){change(f,{type:'save_costs',scope:'character',cardId:c.id,spellLevel:base,castOptions:[{id:'auto',label:'주문 시전',costs:[{type:'slot',costKey:'slot',slotSelection:family,autoBind:true}],casting:{mode:family,allowUpcast:true,allowBelowBase:false}}],bindings:[]},id);}
function use(f:Fixture,c:CardDefinition,level?:number,id=f.a){const action={type:'use' as const,cardId:c.id,optionId:'auto',choices:(level?{slot:level}:{}) as Record<string,number>};const p=f.resources.preview({characterId:id,action});return change(f,{...action,quote:p.quote},id);}

describe('P3.1 automatic slot rule and engine compatibility',()=>{
  it('registers one level-4 rule once and independently spends levels 4, 5 and 6',()=>{
    const f=fixture();const r=preset(f);const c=card(f);automatic(f,c);const stored=f.resources.snapshot(f.a).costOverrides![0].castOptions;expect(stored).toHaveLength(1);expect(stored[0].costs).toHaveLength(1);expect(f.resources.snapshot(f.a).bindings).toEqual([]);
    const start=f.resources.snapshot(f.a).resources.find(value=>value.id===r.id)!.remainingByLevel!;
    for(const level of [4,5,6]){use(f,c,level);expect(f.resources.snapshot(f.a).resources.find(value=>value.id===r.id)!.remainingByLevel).toEqual({...start,[level]:start[level]-1});change(f,{type:'undo'});}
    const before=f.resources.snapshot(f.a);expect(()=>use(f,c,3)).toThrow();expect(f.resources.snapshot(f.a)).toEqual(before);f.store.close();
  });
  it('refuses spending an exhausted tier without changing other tiers and keeps Undo/restart valid',()=>{
    const f=fixture();const r=preset(f);const c=card(f,4);automatic(f,c);change(f,{type:'adjust',resourceId:r.id,slotLevel:4,delta:-3});const before=f.resources.snapshot(f.a);expect(()=>use(f,c,4)).toThrow('부족');expect(f.resources.snapshot(f.a)).toEqual(before);use(f,c,5);f.store.close();
    const store=new AppStore(f.path);const resources=new ResourceStore(store);resources.change({requestId:randomUUID(),characterId:f.a,expectedRevision:resources.snapshot(f.a).revision,action:{type:'undo'}});expect(resources.snapshot(f.a).resources.find(value=>value.id===r.id)!.remainingByLevel!['4']).toBe(0);expect(resources.snapshot(f.a).resources.find(value=>value.id===r.id)!.remainingByLevel!['5']).toBe(2);store.close();
  });
  it('resolves the same shared automatic rule to each character own preset, never another character',()=>{
    const f=fixture();const a=preset(f);const c=card(f,4);change(f,{type:'save_costs',cardId:c.id,castOptions:[{id:'auto',label:'자동',costs:[{type:'slot',costKey:'slot',slotSelection:'standard',autoBind:true}]}],bindings:[]});f.library.createProfile({name:'B'});const b=f.library.getLibrary().profiles[1].id;
    expect(()=>use(f,c,4,b)).toThrow('클래스 슬롯');const br=preset(f,b);use(f,c,4,b);expect(f.resources.snapshot(f.a).resources.find(value=>value.id===a.id)!.remainingByLevel!['4']).toBe(3);expect(f.resources.snapshot(b).resources.find(value=>value.id===br.id)!.remainingByLevel!['4']).toBe(2);f.store.close();
  });
  it('does not auto-connect legacy costs, ambiguous presets or deleted explicit bindings',()=>{
    const f=fixture();const r=preset(f);const c=card(f,4);change(f,{type:'save_costs',cardId:c.id,castOptions:[{id:'auto',label:'기존',costs:[{type:'slot',costKey:'slot',slotSelection:'standard'}]}],bindings:[]});expect(()=>use(f,c,4)).toThrow('연결');automatic(f,c);
    f.store.db.prepare('INSERT INTO resource_instances(id,character_id,template_id,overrides_json,current_state_json,preset_key) VALUES (?,?,?,?,?,?)').run('second',f.a,r.templateId,'{}',JSON.stringify({remainingByLevel:r.remainingByLevel}),'2014:other:spell_slots');expect(()=>use(f,c,4)).toThrow('여러 개');
    change(f,{type:'save_costs',scope:'character',cardId:c.id,castOptions:[{id:'auto',label:'명시',costs:[{type:'slot',costKey:'slot',slotSelection:'standard',autoBind:true}]}],bindings:[{costKey:'slot',resourceInstanceId:r.id}]});change(f,{type:'delete_resource',resourceId:r.id});expect(()=>use(f,c,4)).toThrow('삭제');f.store.close();
  });
  it('keeps pact fixed tier, independent arcanum, cantrips and explicit downcast',()=>{
    const f=fixture();const r=preset(f,f.a,'warlock');const c=card(f,4);automatic(f,c,4,f.a,'pact');use(f,c);expect(f.resources.snapshot(f.a).resources.find(value=>value.id===r.id)!.remainingByLevel).toEqual({5:2});expect(f.resources.snapshot(f.a).resources.find(value=>value.presetKey?.endsWith(':arcanum_6'))!.remaining).toBe(1);
    const cantrip=card(f,0);automatic(f,cantrip,0,f.a,'pact');const before=f.resources.snapshot(f.a).resources;use(f,cantrip);expect(f.resources.snapshot(f.a).resources).toEqual(before);
    const wizard=fixture();preset(wizard);const spell=card(wizard,6);automatic(wizard,spell,6);expect(()=>use(wizard,spell,4)).toThrow();change(wizard,{type:'save_costs',scope:'character',cardId:spell.id,castOptions:[{id:'auto',label:'다운캐스팅',costs:[{type:'slot',costKey:'slot',slotSelection:'standard',autoBind:true}],casting:{mode:'homebrew',allowUpcast:true,allowBelowBase:true,minSlotLevel:4,maxSlotLevel:6}}],bindings:[]});use(wizard,spell,4);f.store.close();wizard.store.close();
  });
  it('saves base level, definition and binding atomically; shared base changes require confirmation',()=>{
    const f=fixture();preset(f);const c=card(f,1);f.library.createProfile({name:'B'});const b=f.library.getLibrary().profiles[1];f.library.setDeckCards({deckId:b.activeDeckId!,cardIds:[c.id]});
    expect(()=>automatic(f,c,4)).toThrow('동의');expect(f.library.getLibrary().cards.find(value=>value.id===c.id)!.spellLevel).toBe(1);
    const request={type:'save_costs' as const,scope:'character' as const,cardId:c.id,spellLevel:4,confirmShared:true,castOptions:[{id:'auto',label:'새 설정',costs:[{type:'slot' as const,costKey:'slot',slotSelection:'standard' as const,autoBind:true}]}],bindings:[]};
    f.store.db.exec("CREATE TRIGGER fail_rule BEFORE INSERT ON play_events BEGIN SELECT RAISE(ABORT,'fault'); END");expect(()=>change(f,request)).toThrow('fault');expect(f.library.getLibrary().cards.find(value=>value.id===c.id)!.spellLevel).toBe(1);expect(f.resources.snapshot(f.a).costOverrides).toEqual([]);f.store.db.exec('DROP TRIGGER fail_rule');change(f,request);expect(f.library.getLibrary().cards.find(value=>value.id===c.id)!.spellLevel).toBe(4);f.store.close();
  });
  it('preserves v4 legacy multiple tier costs and use history, with no startup migration or automatic rewrite',()=>{
    const f=fixture();const r=preset(f);const c=card(f,4);const options=[{id:'manual',label:'수동',costs:[4,5,6].map(slotLevel=>({type:'fixed' as const,costKey:`tier-${slotLevel}`,slotLevel,amount:1}))}];change(f,{type:'save_costs',cardId:c.id,castOptions:options,bindings:[4,5,6].map(slotLevel=>({costKey:`tier-${slotLevel}`,resourceInstanceId:r.id}))});
    const legacy=f.library.getLibrary().cards.find(value=>value.id===c.id)!;const snap=f.resources.snapshot(f.a);expect(inferBasicRule(legacy,snap)).toBeUndefined();expect(describeUseRules(legacy.castOptions,snap.bindings,snap.resources)[0]).toContain('4레벨');const backupCount=readdirSync(join(f.path,'backups')).length;f.store.close();
    const store=new AppStore(f.path);expect(new LibraryStore(store).getLibrary().cards.find(value=>value.id===c.id)!.castOptions).toEqual(options);expect(new ResourceStore(store).snapshot(f.a)).toEqual(snap);expect(readdirSync(join(f.path,'backups'))).toHaveLength(backupCount);expect(store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(6);store.close();
  });
  it('builds simple fixed or variable costs without tier duplication and validates homebrew ranges',()=>{
    const f=fixture();const c=card(f);const draft={...emptyBasicRule(c),kind:'points' as const,resourceId:'points',amount:2};const fixed=buildBasicRule(c,draft,{optionId:'one',costKey:'p'});expect(fixed.castOptions[0].costs).toEqual([{type:'fixed',costKey:'p',amount:2}]);expect(buildBasicRule(c,{...draft,variable:true,min:1,max:5,step:2},{optionId:'one',costKey:'p'}).castOptions[0].costs[0]).toMatchObject({type:'variable',min:1,max:5,step:2});expect(()=>buildBasicRule(c,{...draft,kind:'slots',spellLevel:4,homebrew:true,minLevel:6,maxLevel:2},{optionId:'one',costKey:'s'})).toThrow('범위');f.store.close();
  });
});
