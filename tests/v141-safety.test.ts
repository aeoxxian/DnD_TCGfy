import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { AppStore } from '../electron/store';
import { LibraryStore } from '../electron/library-store';
import { ResourceStore } from '../electron/resource-store';
import { RegistrationStore } from '../electron/registration-store';
import { EditStore } from '../electron/edit-store';
import { DEFAULT_LIBRARY_STATE, type CastOption } from '../src/shared/contracts';
import { castingLevels, resolveCostResource } from '../src/shared/casting';
import { inferredAutomaticCost } from '../src/shared/use-rules';
import type { ResourceAction } from '../src/shared/resources';

const root = resolve('artifacts/v141-unit');
mkdirSync(root,{recursive:true});
const cardDraft = { name: '불씨 카드', kind: 'spell', spellLevel: 3, roles: [], actions: ['action'], range: { kind: 'self' }, tags: [] } as const;
const liveRules: CastOption[] = [{ id:'use', label:'불씨 주문', costs:[{ type:'fixed', costKey:'spark', amount:2, requirement:{ kind:'counter',key:'home:spark' } }] }];
function fixture() {
  const store = new AppStore(mkdtempSync(join(root,'case-')));
  const library = new LibraryStore(store);
  const resources = new ResourceStore(store);
  const registration = new RegistrationStore(store,library,resources);
  const makeProfile = (name: string) => library.createProfile({name}).profiles.find(profile=>profile.name===name)!;
  const change = (characterId:string,action:ResourceAction) => resources.change({
    requestId:randomUUID(),characterId,expectedRevision:resources.snapshot(characterId).revision,action,
  });
  return {store,library,resources,registration,makeProfile,change};
}

it('creates and edits library requirements without a character or a resource, then safely resolves acquired keys',()=>{
  const f=fixture();
  try {
    const saved=f.registration.save({cards:[cardDraft],initialRules:{requestId:randomUUID(),configured:true,scope:'shared',bindings:[],castOptions:liveRules}});
    const card=saved.cards[0];
    expect(saved.profiles).toEqual([]);
    const latest: CastOption[]=[{...liveRules[0],costs:[{type:'fixed',costKey:'spark',amount:3,requirement:{kind:'counter',key:'home:spark'}}]}];
    const revised=f.registration.save({cards:[{...cardDraft,id:card.id}],libraryRules:{expectedCardVersion:card.updatedAt,castOptions:latest}}).cards[0];
    expect(revised.castOptions).toEqual(latest);
    const profile=f.makeProfile('검증 캐릭터');
    f.library.setDeckCards({deckId:profile.activeDeckId,cardIds:[card.id]});
    const cost=latest[0].costs[0];
    expect(()=>resolveCostResource(card.id,cost,f.resources.snapshot(profile.id).resources,[])).toThrow(/보유하지/);
    for(const name of ['불씨','겹치는 불씨']) {
      f.change(profile.id,{type:'create_resource',scope:'character',template:{name,kind:'counter',unit:'점',matchKey:'home:spark',capacity:{type:'fixed',value:5},recovery:[]}});
      const snapshot=f.resources.snapshot(profile.id);
      if(snapshot.resources.length===1)expect(resolveCostResource(card.id,cost,snapshot.resources,[]).remaining).toBe(5);
      else expect(()=>resolveCostResource(card.id,cost,snapshot.resources,[])).toThrow(/여러 개/);
      expect(snapshot.resources.map(resource=>resource.remaining)).toEqual(snapshot.resources.map(()=>5));
    }
  } finally {f.store.close();}
});

it('converts only a matching manual binding and restores disconnected resources and archived profiles/decks without losing data',()=>{
  const f=fixture();
  try {
    const profile=f.makeProfile('플레이어'); const other=f.makeProfile('다른 플레이어');
    f.library.saveState({...DEFAULT_LIBRARY_STATE,activeCharacterId:profile.id,viewScope:'deck'});
    const card=f.library.saveCards({cards:[cardDraft]}).cards[0];
    f.library.setDeckCards({deckId:other.activeDeckId,cardIds:[card.id]});
    f.change(profile.id,{type:'create_resource',scope:'character',template:{name:'불씨',kind:'counter',unit:'점',matchKey:'home:spark',capacity:{type:'fixed',value:5},recovery:[{triggers:['short_rest'],amount:{type:'full'}}]}});
    const original=f.resources.snapshot(profile.id).resources[0];
    const manual: CastOption={id:'use',label:'불씨 사용',costs:[{type:'fixed',costKey:'spark',amount:2}]};
    f.change(profile.id,{type:'save_costs',scope:'shared',confirmShared:true,cardId:card.id,castOptions:[manual],bindings:[{costKey:'spark',resourceInstanceId:original.id}]});
    const use={type:'use' as const,cardId:card.id,optionId:'use',choices:{}};
    f.change(profile.id,{...use,quote:f.resources.preview({characterId:profile.id,action:use}).quote});
    const spent=f.resources.snapshot(profile.id);
    const converted=inferredAutomaticCost(card.id,manual.costs[0],spent.resources[0],spent.resources)!;
    expect(converted).toMatchObject({type:'fixed',amount:2,requirement:{kind:'counter',key:'home:spark'}});
    f.change(profile.id,{type:'save_costs',scope:'character',cardId:card.id,castOptions:[{...manual,costs:[converted]}],bindings:[]});
    expect(f.resources.snapshot(profile.id).resources).toEqual(spent.resources);
    const edit=new EditStore(f.store);
    const apply=(action:Parameters<typeof edit.preview>[0])=>{
      const preview=edit.preview(action);
      return edit.apply({requestId:randomUUID(),action,quote:preview.quote,confirmImpact:true});
    };
    const disconnected=apply({type:'disconnect_resources',characterId:profile.id,resourceIds:[original.id]});
    expect(f.resources.snapshot(profile.id).resources).toEqual([]);
    apply({type:'restore',batchId:disconnected.batchId});
    expect(f.resources.snapshot(profile.id).resources).toEqual(spent.resources);

    const deckId=profile.activeDeckId!;
    expect(f.library.changeProfileTrash({kind:'deck',id:deckId,restore:false}).decks.map(d=>d.id)).toEqual([other.activeDeckId]);
    expect(f.library.getLibrary().cards[0].id).toBe(card.id);
    expect(f.library.changeProfileTrash({kind:'deck',id:deckId,restore:true}).decks.find(d=>d.id===deckId)?.cardIds).toEqual([card.id]);
    const after=f.resources.snapshot(profile.id);
    expect(f.library.changeProfileTrash({kind:'profile',id:profile.id,restore:false}).libraryState.activeCharacterId).toBeUndefined();
    expect(()=>f.resources.snapshot(profile.id)).toThrow(/캐릭터/);
    f.library.changeProfileTrash({kind:'profile',id:profile.id,restore:true});
    expect(f.resources.snapshot(profile.id)).toEqual(after);
    expect(f.store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {f.store.close();}
});

it('keeps legacy homebrew and pact ranges when their flags are independent',()=>{
  const card={kind:'spell',spellLevel:3} as const;
  const rule={id:'range',label:'범위',costs:[]};
  expect(castingLevels(card,{...rule,casting:{mode:'homebrew',allowBelowBase:true,allowUpcast:false,minSlotLevel:2,maxSlotLevel:6}})).toEqual([2,3]);
  expect(castingLevels(card,{...rule,casting:{mode:'pact',allowBelowBase:false,allowUpcast:true,maxSlotLevel:5}})).toEqual([3,4,5]);
});
