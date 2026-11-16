import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppStore } from '../electron/store';
import { LibraryStore } from '../electron/library-store';
import { ResourceStore } from '../electron/resource-store';
import { migrations } from '../electron/migrations';
import { DEFAULT_LIBRARY_STATE, DEFAULT_SETTINGS, type CardDefinition } from '../src/shared/contracts';
import { templateDraftSchema, type ResourceAction, type ResourceRequest, type TemplateDraft } from '../src/shared/resources';
import { capacityFor, applyChanges } from '../src/shared/resource-engine';

const root=resolve('artifacts/resource-unit');mkdirSync(root,{recursive:true});
const template=(name='영력',max=5):TemplateDraft=>({name,kind:'counter',unit:'점',capacity:{type:'fixed',value:max},recovery:[{triggers:['short_rest'],amount:{type:'fixed',value:2}},{triggers:['long_rest'],amount:{type:'full'}}]});
function fixture(){const path=mkdtempSync(join(root,'case-'));const store=new AppStore(path);const library=new LibraryStore(store);library.createProfile({name:'A'});const a=library.getLibrary().profiles[0].id;const resources=new ResourceStore(store);return{path,store,library,resources,a};}
function change(f:ReturnType<typeof fixture>,action:ResourceAction,char=f.a){const snapshot=f.resources.snapshot(char);return f.resources.change({requestId:randomUUID(),characterId:char,expectedRevision:snapshot.revision,action});}
function addResource(f:ReturnType<typeof fixture>,name='영력',max=5,char=f.a){change(f,{type:'create_resource',template:template(name,max),scope:'character'},char);return f.resources.snapshot(char).resources.at(-1)!;}
function addCard(f:ReturnType<typeof fixture>,name='카드',kind:CardDefinition['kind']='feature'){return f.library.saveCards({cards:[{name,kind,roles:['utility'],actions:['action'],range:{kind:'self'},tags:[]}]}).cards.at(-1)!;}
function bind(f:ReturnType<typeof fixture>,card:CardDefinition,costs:CardDefinition['castOptions'][number]['costs'],bindings:{costKey:string;resourceInstanceId:string}[],char=f.a){change(f,{type:'save_costs',cardId:card.id,castOptions:[{id:card.castOptions[0].id,label:'일반',costs}],bindings},char);}
function useRequest(f:ReturnType<typeof fixture>,card:CardDefinition,char=f.a,choices:Record<string,number>={}):ResourceRequest{const action={type:'use' as const,cardId:card.id,optionId:card.castOptions[0].id,choices};const preview=f.resources.preview({characterId:char,action});return{requestId:randomUUID(),characterId:char,expectedRevision:preview.revision,action:{...action,quote:preview.quote}};}

describe('P2 atomic resource use and idempotency',()=>{
  it('selection and preview do not write, then confirmed use spends a shared counter across cards',()=>{
    const f=fixture();const resource=addResource(f);const a=addCard(f,'가');const b=addCard(f,'나');
    for(const card of[a,b])bind(f,card,[{type:'fixed',costKey:'spirit',amount:2}],[{costKey:'spirit',resourceInstanceId:resource.id}]);
    const before=f.resources.snapshot(f.a);const req=useRequest(f,a);expect(f.resources.snapshot(f.a)).toEqual(before);
    f.resources.change(req);expect(f.resources.snapshot(f.a).resources[0].remaining).toBe(3);
    f.resources.change(useRequest(f,b));expect(f.resources.snapshot(f.a).resources[0].remaining).toBe(1);expect(f.resources.snapshot(f.a).events.filter(event=>event.type==='card_used')).toHaveLength(2);f.store.close();
  });
  it('aggregates duplicate bindings and refuses all costs if one resource is short',()=>{
    const f=fixture();const a=addResource(f,'A');const b=addResource(f,'B',0);const card=addCard(f);
    bind(f,card,[{type:'fixed',costKey:'a',amount:2},{type:'fixed',costKey:'b',amount:1}],[{costKey:'a',resourceInstanceId:a.id},{costKey:'b',resourceInstanceId:b.id}]);
    const before=f.resources.snapshot(f.a);expect(()=>f.resources.change(useRequest(f,card))).toThrow('부족');expect(f.resources.snapshot(f.a)).toEqual(before);
    bind(f,card,[{type:'fixed',costKey:'a',amount:3},{type:'fixed',costKey:'again',amount:3}],[{costKey:'a',resourceInstanceId:a.id},{costKey:'again',resourceInstanceId:a.id}]);expect(()=>f.resources.change(useRequest(f,card))).toThrow('부족');expect(f.resources.snapshot(f.a).resources[0].remaining).toBe(5);f.store.close();
  });
  it('replays identical request IDs once, refuses changed content and stale new IDs',()=>{
    const f=fixture();const r=addResource(f);const card=addCard(f);bind(f,card,[{type:'fixed',costKey:'x',amount:2}],[{costKey:'x',resourceInstanceId:r.id}]);
    const request=useRequest(f,card);const first=f.resources.change(request);const repeat=f.resources.change(request);
    expect(repeat.replayed).toBe(true);expect(repeat.eventId).toBe(first.eventId);expect(repeat.snapshot.resources[0].remaining).toBe(3);
    expect(()=>f.resources.change({...request,requestId:randomUUID()})).toThrow('바뀌');
    expect(()=>f.resources.change({...request,action:{type:'adjust',resourceId:r.id,delta:-1}})).toThrow('다른 내용');expect(f.resources.snapshot(f.a).events.filter(event=>event.type==='card_used')).toHaveLength(1);f.store.close();
  });
  it('keeps receipts, resource state and undo valid after complete restart',()=>{
    const f=fixture();const r=addResource(f);const card=addCard(f);bind(f,card,[{type:'fixed',costKey:'x',amount:2}],[{costKey:'x',resourceInstanceId:r.id}]);const request=useRequest(f,card);f.resources.change(request);f.store.close();
    const next=new AppStore(f.path);const repo=new ResourceStore(next);expect(repo.change(request).replayed).toBe(true);expect(repo.snapshot(f.a).resources[0].remaining).toBe(3);
    repo.change({requestId:randomUUID(),characterId:f.a,expectedRevision:repo.snapshot(f.a).revision,action:{type:'undo'}});expect(repo.snapshot(f.a).resources[0].remaining).toBe(5);next.close();
  });
  it('rolls back both state writes and receipts if event persistence fails',()=>{
    const f=fixture();const r=addResource(f);const card=addCard(f);bind(f,card,[{type:'fixed',costKey:'x',amount:2}],[{costKey:'x',resourceInstanceId:r.id}]);
    const before=f.resources.snapshot(f.a);const request=useRequest(f,card);
    f.store.db.exec("CREATE TRIGGER fail_use BEFORE INSERT ON play_events WHEN NEW.event_type='card_used' BEGIN SELECT RAISE(ABORT,'test failure'); END");
    expect(()=>f.resources.change(request)).toThrow();expect(f.resources.snapshot(f.a)).toEqual(before);expect(f.store.db.prepare('SELECT * FROM resource_requests WHERE request_id=?').get(request.requestId)).toBeUndefined();f.store.close();
  });
  it('supports chosen variable amounts and rejects wrong steps, extra choices and stale quotes',()=>{
    const f=fixture();const r=addResource(f);const card=addCard(f);bind(f,card,[{type:'variable',costKey:'x',min:1,max:5,step:2}],[{costKey:'x',resourceInstanceId:r.id}]);
    const invalid=f.resources.preview({characterId:f.a,action:{type:'use',cardId:card.id,optionId:card.castOptions[0].id,choices:{x:2}}});expect(invalid.canUse).toBe(false);
    expect(()=>f.resources.change(useRequest(f,card,f.a,{x:2}))).toThrow();expect(()=>f.resources.change(useRequest(f,card,f.a,{x:1,extra:1}))).toThrow();
    const stale=useRequest(f,card,f.a,{x:3});f.library.saveCards({cards:[{id:card.id,name:'바뀐 이름',kind:card.kind,roles:card.roles,actions:card.actions,range:card.range,tags:[]}]});expect(()=>f.resources.change(stale)).toThrow('다시 확인');
    f.resources.change(useRequest(f,card,f.a,{x:3}));expect(f.resources.snapshot(f.a).resources[0].remaining).toBe(2);f.store.close();
  });
  it('records free and confirmed insufficient exceptions without negative state',()=>{
    const f=fixture();const free=addCard(f,'무소모');f.resources.change(useRequest(f,free));expect(f.resources.snapshot(f.a).events[0].changes).toEqual([]);
    const r=addResource(f,'비어 있음',0);const card=addCard(f,'예외');bind(f,card,[{type:'fixed',costKey:'x',amount:1}],[{costKey:'x',resourceInstanceId:r.id}]);
    const request=useRequest(f,card);if(request.action.type!=='use')throw new Error();
    f.resources.change({...request,action:{...request.action,override:true}});expect(f.resources.snapshot(f.a).resources[0].remaining).toBe(0);expect(f.resources.snapshot(f.a).events[0].override).toBe(true);f.store.close();
  });
});

describe('recovery, bounds and undo',()=>{
  it('applies short/long/dawn/manual independently and gives explicit long-rest priority once',()=>{
    const f=fixture();const definition=template();definition.recovery=[{triggers:['short_rest'],amount:{type:'fixed',value:2}},{triggers:['long_rest'],amount:{type:'fixed',value:1}},{triggers:['dawn','manual'],amount:{type:'full'}}];
    change(f,{type:'create_resource',template:definition,scope:'character'});const r=f.resources.snapshot(f.a).resources[0];change(f,{type:'adjust',resourceId:r.id,delta:-5});
    change(f,{type:'recover',trigger:'long_rest'});expect(f.resources.snapshot(f.a).resources[0].remaining).toBe(1);
    change(f,{type:'recover',trigger:'short_rest'});expect(f.resources.snapshot(f.a).resources[0].remaining).toBe(3);
    change(f,{type:'recover',trigger:'dawn'});expect(f.resources.snapshot(f.a).resources[0].remaining).toBe(5);
    change(f,{type:'adjust',resourceId:r.id,delta:-4});change(f,{type:'recover',trigger:'manual'});expect(f.resources.snapshot(f.a).resources[0].remaining).toBe(5);f.store.close();
  });
  it('inherits short rest once on long rest, caps fixed recovery and skips no-op history',()=>{
    const f=fixture();const definition=template();definition.recovery=[{triggers:['short_rest'],amount:{type:'fixed',value:2}}];change(f,{type:'create_resource',template:definition,scope:'character'});
    const r=f.resources.snapshot(f.a).resources[0];change(f,{type:'adjust',resourceId:r.id,delta:-1});change(f,{type:'recover',trigger:'long_rest'});expect(f.resources.snapshot(f.a).resources[0].remaining).toBe(5);
    const before=f.resources.snapshot(f.a);change(f,{type:'recover',trigger:'long_rest'});expect(f.resources.snapshot(f.a)).toEqual(before);f.store.close();
  });
  it('rejects duplicate recovery triggers, fractional state and slot partial recovery',()=>{
    expect(()=>templateDraftSchema.parse({...template(),recovery:[{triggers:['short_rest'],amount:{type:'full'}},{triggers:['short_rest'],amount:{type:'full'}}]})).toThrow();
    expect(()=>templateDraftSchema.parse({...template(),capacity:{type:'fixed',value:1.5}})).toThrow();
    expect(()=>templateDraftSchema.parse({name:'슬롯',unit:'개',kind:'slot_track',slotCapacity:{1:{type:'fixed',value:2}},recovery:[{triggers:['manual'],amount:{type:'fixed',value:1}}]})).toThrow();
  });
  it('enforces min/max and restores multi-resource use, manual changes and successive undos',()=>{
    const f=fixture();const a=addResource(f,'A');const b=addResource(f,'B',2);const card=addCard(f);
    bind(f,card,[{type:'fixed',costKey:'a',amount:2},{type:'fixed',costKey:'b',amount:1}],[{costKey:'a',resourceInstanceId:a.id},{costKey:'b',resourceInstanceId:b.id}]);
    f.resources.change(useRequest(f,card));change(f,{type:'adjust',resourceId:a.id,delta:1});change(f,{type:'undo'});expect(f.resources.snapshot(f.a).resources.map(r=>r.remaining)).toEqual([3,1]);
    change(f,{type:'undo'});expect(f.resources.snapshot(f.a).resources.map(r=>r.remaining)).toEqual([5,2]);expect(()=>change(f,{type:'adjust',resourceId:a.id,delta:1})).toThrow('범위');expect(()=>change(f,{type:'adjust',resourceId:a.id,delta:-6})).toThrow('범위');expect(()=>change(f,{type:'undo'})).toThrow('되돌릴');f.store.close();
  });
  it('refuses undo after an external state mismatch or a configuration boundary',()=>{
    const f=fixture();const r=addResource(f);change(f,{type:'adjust',resourceId:r.id,delta:-2});
    f.store.db.prepare('UPDATE resource_instances SET current_state_json=? WHERE id=?').run('{"remaining":1}',r.id);expect(()=>change(f,{type:'undo'})).toThrow('바뀌');expect(f.resources.snapshot(f.a).resources[0].remaining).toBe(1);
    change(f,{type:'edit_resource',resourceId:r.id,overrides:{scope:'character',capacityOverride:8}});expect(f.resources.snapshot(f.a).resources[0].remaining).toBe(4);expect(f.resources.snapshot(f.a).events[0]).toMatchObject({barrier:true,reversible:false,changes:[{before:1,after:4}]});expect(()=>change(f,{type:'undo'})).toThrow('되돌릴');f.store.close();
  });
  it('spends explicit slot tiers and fully recovers them without applying casting rules',()=>{
    const f=fixture();change(f,{type:'create_resource',scope:'character',template:{name:'트랙',unit:'슬롯',kind:'slot_track',slotCapacity:{1:{type:'fixed',value:4},3:{type:'fixed',value:2}},recovery:[{triggers:['short_rest','long_rest'],amount:{type:'full'}}]}});
    const r=f.resources.snapshot(f.a).resources[0];const card=addCard(f);bind(f,card,[{type:'fixed',costKey:'x',amount:1,slotLevel:3}],[{costKey:'x',resourceInstanceId:r.id}]);f.resources.change(useRequest(f,card));expect(f.resources.snapshot(f.a).resources[0].remainingByLevel).toEqual({1:4,3:1});change(f,{type:'recover',trigger:'short_rest'});expect(f.resources.snapshot(f.a).resources[0].remainingByLevel).toEqual({1:4,3:2});f.store.close();
  });
  it('preserves casting metadata and refuses non-spell cards without a base level',()=>{
    const f=fixture();const card=addCard(f);for(const mode of ['standard','homebrew']as const){change(f,{type:'save_costs',cardId:card.id,castOptions:[{id:card.castOptions[0].id,label:'예약',costs:[{type:'slot',costKey:'slots',slotSelection:'standard'}],casting:{mode,allowUpcast:true,allowBelowBase:mode==='homebrew'}}],bindings:[]});const preview=f.resources.preview({characterId:f.a,action:{type:'use',cardId:card.id,optionId:card.castOptions[0].id,choices:{}}});expect(preview.canUse).toBe(false);expect(preview.reason).toContain('주문');expect(()=>f.resources.change(useRequest(f,card))).toThrow('주문');}f.store.close();
  });
});

describe('character isolation, scopes and module lifecycle',()=>{
  it('isolates resources, bindings, history and undo for two characters sharing a card',()=>{
    const f=fixture();const a=addResource(f);const card=addCard(f);bind(f,card,[{type:'fixed',costKey:'x',amount:2}],[{costKey:'x',resourceInstanceId:a.id}]);
    f.library.createProfile({name:'B'});const bId=f.library.getLibrary().profiles[1].id;const b=addResource(f,'B',5,bId);bind(f,card,[{type:'fixed',costKey:'x',amount:2}],[{costKey:'x',resourceInstanceId:b.id}],bId);
    const bBefore=f.resources.snapshot(bId);f.resources.change(useRequest(f,card));expect(f.resources.snapshot(f.a).resources[0].remaining).toBe(3);expect(f.resources.snapshot(bId)).toEqual(bBefore);change(f,{type:'undo'});expect(f.resources.snapshot(bId)).toEqual(bBefore);
    expect(()=>bind(f,card,[{type:'fixed',costKey:'x',amount:1}],[{costKey:'x',resourceInstanceId:a.id}],bId)).toThrow('캐릭터');f.store.close();
  });
  it('supports templates and instance overrides without mutating other owners; deletion leaves an explicit invalid binding',()=>{
    const f=fixture();const r=addResource(f);const templateId=r.templateId;const card=addCard(f);bind(f,card,[{type:'fixed',costKey:'x',amount:2}],[{costKey:'x',resourceInstanceId:r.id}]);f.resources.change(useRequest(f,card));
    expect(()=>change(f,{type:'save_template',template:{...template(),id:templateId}})).toThrow('복제');change(f,{type:'edit_resource',resourceId:r.id,overrides:{scope:'character',capacityOverride:8}});expect(f.resources.snapshot(f.a).resources[0].remaining).toBe(6);
    change(f,{type:'archive_template',templateId});expect(f.resources.snapshot(f.a).resources[0].remaining).toBe(6);expect(()=>change(f,{type:'attach',templateId,scope:'character'})).toThrow('보관');
    change(f,{type:'delete_resource',resourceId:r.id});const preview=f.resources.preview({characterId:f.a,action:{type:'use',cardId:card.id,optionId:card.castOptions[0].id,choices:{}}});expect(preview.canUse).toBe(false);expect(preview.canOverride).toBe(false);expect(f.resources.snapshot(f.a).bindings[0].resourceInstanceId).toBe(r.id);f.store.close();
  });
  it('restricts card-specific resources and verifies item provenance without class branches',()=>{
    const f=fixture();const a=addCard(f,'A');const b=addCard(f,'B');change(f,{type:'create_resource',template:template(),scope:'card',ownerCardId:a.id});const r=f.resources.snapshot(f.a).resources[0];
    expect(()=>bind(f,b,[{type:'fixed',costKey:'x',amount:1}],[{costKey:'x',resourceInstanceId:r.id}])).toThrow('다른 카드');
    expect(()=>change(f,{type:'create_resource',template:template(),scope:'item',ownerCardId:a.id})).toThrow('아이템');
    const item=addCard(f,'완드','item');change(f,{type:'create_resource',template:template('충전'),scope:'item',ownerCardId:item.id});const charges=f.resources.snapshot(f.a).resources.at(-1)!;bind(f,b,[{type:'fixed',costKey:'charge',amount:1}],[{costKey:'charge',resourceInstanceId:charges.id}]);f.resources.change(useRequest(f,b));f.library.archiveCard(item.id);expect(()=>f.resources.change(useRequest(f,b))).toThrow();f.store.close();
  });
  it('evaluates only declarative maxima and preserves source objects during state calculation',()=>{
    expect(capacityFor({type:'level_table',values:{1:3,2:5}},{level:2})).toBe(5);
    expect(()=>capacityFor({type:'level_table',values:{1:3}},{level:2})).toThrow();
    expect(capacityFor({type:'ability_modifier',ability:'WIS',offset:1,minimum:1,maximum:5},{level:1,abilityScores:{WIS:16}})).toBe(4);
    const f=fixture();const r=addResource(f);const source=structuredClone(r);expect(applyChanges([r],[{resourceInstanceId:r.id,before:5,after:3}])[0].remaining).toBe(3);expect(r).toEqual(source);f.store.close();
  });
});

describe('v2 to v3 data preservation',()=>{
  it('backs up v2 and preserves images, P0 settings, filters and live resource state without startup recovery',()=>{
    const path=mkdtempSync(join(root,'v2-'));mkdirSync(join(path,'data'));mkdirSync(join(path,'assets'));const db=new DatabaseSync(join(path,'data','app.sqlite3'));
    for(const m of migrations.filter(m=>m.version<=2)){db.exec(m.sql);db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(m.version,'original');}db.exec('PRAGMA user_version=2');
    db.prepare("INSERT INTO settings VALUES ('preferences',?)").run(JSON.stringify(DEFAULT_SETTINGS));db.prepare("INSERT INTO settings VALUES ('library_state',?)").run(JSON.stringify({...DEFAULT_LIBRARY_STATE,query:'보존'}));
    db.exec("INSERT INTO character_profiles(id,name,ruleset,level) VALUES ('legacy','기존','homebrew',1)");const t=template();db.prepare('INSERT INTO resource_templates VALUES (?,?,?,?,?,?,?)').run('t','spirit','영력','counter',JSON.stringify(t),'user',1);db.exec("INSERT INTO resource_instances VALUES ('r','legacy','t','{}','{\"remaining\":3}')");db.close();writeFileSync(join(path,'assets','keep.png'),'untouched');
    const store=new AppStore(path);const resources=new ResourceStore(store);expect(resources.snapshot('legacy').resources[0].remaining).toBe(3);expect(resources.snapshot('legacy').revision).toBe(0);expect(resources.snapshot('legacy').events).toEqual([]);expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);expect(new LibraryStore(store).getState().query).toBe('보존');expect(readFileSync(join(path,'assets','keep.png'),'utf8')).toBe('untouched');
    const backupFiles=readdirSync(join(path,'backups'));expect(backupFiles).toHaveLength(1);const backup=new DatabaseSync(join(path,'backups',backupFiles[0]),{readOnly:true});expect(backup.prepare('PRAGMA user_version').get()).toMatchObject({user_version:2});backup.close();store.close();
  });
});
