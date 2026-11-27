import { resourceMatchKeySchema, type CardDefinition, type CastOption } from './contracts';
import type { ResourceSnapshot, ResourceView } from './resources';

// Only independent one-slot alternatives have an unambiguous automatic conversion.
export function proposeSlotConversion(card:CardDefinition,snapshot:ResourceSnapshot):{castOptions:CastOption[];bindings:{costKey:string;resourceInstanceId:string}[]}|undefined {
  if(card.kind!=='spell'||!card.spellLevel||card.castOptions.length<2||card.castOptions.some(option=>option.ritual))return;
  const costs=card.castOptions.map(option=>option.costs.length===1&&!option.casting?option.costs[0]:undefined);
  if(costs.some(cost=>cost?.type!=='fixed'||cost.amount!==1||cost.slotLevel===undefined||cost.slotLevel<card.spellLevel!))return;
  const levels=costs.map(cost=>cost?.type==='fixed'?cost.slotLevel:undefined);
  if(new Set(levels).size!==levels.length)return;
  const resourceIds=costs.map(cost=>snapshot.bindings.find(binding=>binding.cardId===card.id&&binding.costKey===cost!.costKey)?.resourceInstanceId);
  if(resourceIds.some(id=>!id)||new Set(resourceIds).size!==1)return;
  const resource=snapshot.resources.find(r=>r.id===resourceIds[0]);const family=resource?.template.slotKind;
  if(!resource||resource.kind!=='slot_track'||family!=='standard'&&family!=='pact')return;
  if(levels.some(level=>!resource.capacityByLevel?.[String(level)]))return;
  const first=card.castOptions[0];const costKey=first.costs[0].costKey;
  return {castOptions:[{id:first.id,label:'주문 시전',costs:[{type:'slot',costKey,slotSelection:family,autoBind:false}],casting:{mode:family,allowUpcast:true,allowBelowBase:false}}],bindings:[{costKey,resourceInstanceId:resource.id}]};
}

export type BasicRuleKind='none'|'slots'|'uses'|'points';
export interface BasicRuleDraft {
  kind:BasicRuleKind; resourceId:string; resourceKey?:string; amount:number; variable:boolean; min:number; max:number; step:number;
  family:'standard'|'pact'; automatic:boolean; spellLevel?:number; homebrew:boolean; belowBase:boolean; allowUpcast?:boolean; minLevel?:number; maxLevel?:number;
}
export const emptyBasicRule=(card:CardDefinition):BasicRuleDraft=>({kind:'none',resourceId:'',amount:1,variable:false,min:1,max:5,step:1,family:'standard',automatic:true,spellLevel:card.spellLevel,homebrew:false,belowBase:false});
export function inferBasicRule(card:CardDefinition,snapshot:ResourceSnapshot):BasicRuleDraft|undefined {
  if(card.castOptions.length!==1||card.castOptions[0].ritual)return;
  const option=card.castOptions[0];const draft=emptyBasicRule(card);
  if(option.costs.length===0&&!option.casting)return draft;
  if(option.costs.length!==1)return;
  const cost=option.costs[0];const binding=snapshot.bindings.find(binding=>binding.cardId===card.id&&binding.costKey===cost.costKey);
  draft.resourceId=binding?.resourceInstanceId??'';
  if(cost.type==='slot'){
    if(cost.slotSelection==='generic'||cost.requirement||card.kind!=='spell'||option.casting&&option.casting.mode!=='homebrew'&&option.casting.mode!==cost.slotSelection)return;
    return {...draft,kind:'slots',family:cost.slotSelection,automatic:cost.autoBind===true,homebrew:option.casting?.mode==='homebrew',belowBase:option.casting?.allowBelowBase??false,allowUpcast:option.casting?.allowUpcast,minLevel:option.casting?.minSlotLevel,maxLevel:option.casting?.maxSlotLevel};
  }
  // Fixed slot tiers and non-slot casting can carry meaning the basic form cannot infer.
  if(option.casting||cost.slotLevel!==undefined||cost.requirement?.kind==='track')return;
  draft.resourceKey=cost.requirement?.key;
  const resource=snapshot.resources.find(resource=>resource.id===draft.resourceId);
  if(resource&&resource.kind!=='counter')return;
  return cost.type==='fixed'?{...draft,kind:resource?.unit==='점'?'points':'uses',amount:cost.amount}:{...draft,kind:'points',variable:true,min:cost.min,max:cost.max,step:cost.step};
}
export function classSlotResources(snapshot:ResourceSnapshot,family:'standard'|'pact'):ResourceView[]{
  return snapshot.resources.filter(resource=>resource.kind==='slot_track'&&resource.template.slotKind===family&&resource.presetKey?.startsWith('2014:')&&resource.overrides.scope==='character');
}
export function buildBasicRule(card:CardDefinition,draft:BasicRuleDraft,ids:{optionId:string;costKey:string}):{castOptions:CastOption[];bindings:{costKey:string;resourceInstanceId:string}[];spellLevel?:number} {
  const option:CastOption={id:ids.optionId,label:card.castOptions[0]?.label??'일반 사용',costs:[]};
  const bindings:{costKey:string;resourceInstanceId:string}[]=[];
  if(draft.kind==='slots'){
    if(card.kind!=='spell'||draft.spellLevel===undefined)throw new Error('기본 주문 레벨을 지정해 주세요.');
    if(!Number.isInteger(draft.spellLevel)||draft.spellLevel<0||draft.spellLevel>9)throw new Error('기본 주문 레벨은 0~9입니다.');
    if(!draft.automatic&&draft.spellLevel!==0&&!draft.resourceId)throw new Error('사용할 슬롯 자원을 선택해 주세요.');
    if(([draft.minLevel,draft.maxLevel].some(level=>level!==undefined&&(!Number.isInteger(level)||level<1||level>9))||draft.minLevel!==undefined&&draft.maxLevel!==undefined&&draft.minLevel>draft.maxLevel))throw new Error('시전 레벨의 최소·최대 범위를 확인해 주세요.');
    const oldCost=card.castOptions.find(option=>option.id===ids.optionId)?.costs.find(cost=>cost.costKey===ids.costKey);
    option.costs=[{type:'slot',costKey:ids.costKey,slotSelection:draft.family,autoBind:draft.automatic?true:oldCost?.type==='slot'&&oldCost.autoBind===false?false:undefined}];
    option.casting={mode:draft.homebrew?'homebrew':draft.family,allowUpcast:draft.allowUpcast??true,allowBelowBase:draft.homebrew&&draft.belowBase,minSlotLevel:draft.minLevel,maxSlotLevel:draft.maxLevel};
    if(draft.spellLevel>0 && Math.max(draft.minLevel??1,option.casting.allowBelowBase?1:draft.spellLevel)>Math.min(draft.maxLevel??9,draft.allowUpcast===false?draft.spellLevel:9))throw new Error('사용 가능한 시전 레벨이 범위에 포함되어야 합니다.');
    if(!draft.automatic&&draft.resourceId&&draft.spellLevel!==0)bindings.push({costKey:ids.costKey,resourceInstanceId:draft.resourceId});
  }else if(draft.kind==='uses'||draft.kind==='points'){
    const key=draft.resourceKey?.trim();
    if(!draft.resourceId&&!key)throw new Error('사용할 자원을 선택하거나 자원 식별 키를 입력해 주세요.');
    const parsed=key?resourceMatchKeySchema.safeParse(key):undefined;
    if(parsed&&!parsed.success)throw new Error(parsed.error.issues[0].message);
    const requirement=parsed?.success?{kind:'counter' as const,key:parsed.data}:undefined;
    if(draft.kind==='points'&&draft.variable){
      if(![draft.min,draft.max,draft.step].every(Number.isSafeInteger)||draft.min<0||draft.max<draft.min||draft.max>1000000||draft.step<1||draft.step>1000000)throw new Error('사용량 범위와 간격을 확인해 주세요.');
      option.costs=[{type:'variable',costKey:ids.costKey,min:draft.min,max:draft.max,step:draft.step,...(requirement?{requirement}:{})}];
    }else{
      if(!Number.isSafeInteger(draft.amount)||draft.amount<0||draft.amount>1000000)throw new Error('사용량은 0~1,000,000 사이의 정수로 지정해 주세요.');
      option.costs=[{type:'fixed',costKey:ids.costKey,amount:draft.amount,...(requirement?{requirement}:{})}];
    }
    if(draft.resourceId)bindings.push({costKey:ids.costKey,resourceInstanceId:draft.resourceId});
  }
  return {castOptions:[option],bindings,spellLevel:draft.kind==='slots'?draft.spellLevel:undefined};
}
export function describeUseRules(options:CastOption[],bindings:{costKey:string;resourceInstanceId:string}[],resources:ResourceView[]):string[]{
  return options.map(option=>`${option.label}: ${option.costs.length?option.costs.map(cost=>{
    const id=bindings.find(binding=>binding.costKey===cost.costKey)?.resourceInstanceId;const resource=resources.find(resource=>resource.id===id);const name=resource?.name??(cost.requirement?`자원 키 ${cost.requirement.key}`:'기존 연결 확인 필요');
    if(cost.type==='slot')return `${cost.slotSelection==='standard'?'일반 주문':cost.slotSelection==='pact'?'계약 마법':'사용자 정의'} 슬롯 1개 · 사용할 때 레벨 선택${cost.autoBind?' · 클래스에서 자동 연결':` · ${name}`}`;
    const amount=cost.type==='fixed'?String(cost.amount):`${cost.min}~${cost.max} (간격 ${cost.step})`;
    return `${name}${cost.slotLevel!==undefined?` ${cost.slotLevel}레벨`:''} ${amount}${resource?.unit??''}`;
  }).join(' + '):'무소모'}`);
}
