import type { CardDefinition, CastOption } from './contracts';
import type { ResourceSnapshot, ResourceView } from './resources';

export type BasicRuleKind='none'|'slots'|'uses'|'points';
export interface BasicRuleDraft {
  kind:BasicRuleKind; resourceId:string; amount:number; variable:boolean; min:number; max:number; step:number;
  family:'standard'|'pact'; automatic:boolean; spellLevel?:number; homebrew:boolean; belowBase:boolean; minLevel?:number; maxLevel?:number;
}
export const emptyBasicRule=(card:CardDefinition):BasicRuleDraft=>({kind:'none',resourceId:'',amount:1,variable:false,min:1,max:5,step:1,family:'standard',automatic:true,spellLevel:card.spellLevel,homebrew:false,belowBase:false});
export function inferBasicRule(card:CardDefinition,snapshot:ResourceSnapshot):BasicRuleDraft|undefined {
  if(card.castOptions.length!==1)return;
  const option=card.castOptions[0];const draft=emptyBasicRule(card);
  if(option.costs.length===0&&!option.casting)return draft;
  if(option.costs.length!==1)return;
  const cost=option.costs[0];const binding=snapshot.bindings.find(binding=>binding.cardId===card.id&&binding.costKey===cost.costKey);
  draft.resourceId=binding?.resourceInstanceId??'';
  if(cost.type==='slot'){
    if(card.kind!=='spell'||option.casting?.allowUpcast===false||option.casting&&option.casting.mode!=='homebrew'&&(option.casting.mode!==cost.slotSelection||option.casting.minSlotLevel!==undefined||option.casting.maxSlotLevel!==undefined))return;
    return {...draft,kind:'slots',family:cost.slotSelection,automatic:cost.autoBind===true,homebrew:option.casting?.mode==='homebrew',belowBase:option.casting?.allowBelowBase??false,minLevel:option.casting?.minSlotLevel,maxLevel:option.casting?.maxSlotLevel};
  }
  // Fixed slot tiers and non-slot casting can carry meaning the basic form cannot infer.
  if(option.casting||cost.slotLevel!==undefined)return;
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
    if(draft.homebrew&&([draft.minLevel,draft.maxLevel].some(level=>level!==undefined&&(!Number.isInteger(level)||level<1||level>9))||draft.minLevel!==undefined&&draft.maxLevel!==undefined&&draft.minLevel>draft.maxLevel))throw new Error('홈브루 시전 레벨의 최소·최대 범위를 확인해 주세요.');
    const oldCost=card.castOptions.find(option=>option.id===ids.optionId)?.costs.find(cost=>cost.costKey===ids.costKey);
    option.costs=[{type:'slot',costKey:ids.costKey,slotSelection:draft.family,autoBind:draft.automatic?true:oldCost?.type==='slot'&&oldCost.autoBind===false?false:undefined}];
    option.casting={mode:draft.homebrew?'homebrew':draft.family,allowUpcast:true,allowBelowBase:draft.homebrew&&draft.belowBase,minSlotLevel:draft.homebrew?draft.minLevel:undefined,maxSlotLevel:draft.homebrew?draft.maxLevel:undefined};
    if(!draft.automatic&&draft.resourceId&&draft.spellLevel!==0)bindings.push({costKey:ids.costKey,resourceInstanceId:draft.resourceId});
  }else if(draft.kind==='uses'||draft.kind==='points'){
    if(!draft.resourceId)throw new Error('사용할 자원을 이름으로 선택해 주세요.');
    if(draft.kind==='points'&&draft.variable){
      if(![draft.min,draft.max,draft.step].every(Number.isSafeInteger)||draft.min<0||draft.max<draft.min||draft.max>1000000||draft.step<1||draft.step>1000000)throw new Error('사용량 범위와 간격을 확인해 주세요.');
      option.costs=[{type:'variable',costKey:ids.costKey,min:draft.min,max:draft.max,step:draft.step}];
    }else{
      if(!Number.isSafeInteger(draft.amount)||draft.amount<0||draft.amount>1000000)throw new Error('사용량은 0~1,000,000 사이의 정수로 지정해 주세요.');
      option.costs=[{type:'fixed',costKey:ids.costKey,amount:draft.amount}];
    }
    bindings.push({costKey:ids.costKey,resourceInstanceId:draft.resourceId});
  }
  return {castOptions:[option],bindings,spellLevel:draft.kind==='slots'?draft.spellLevel:undefined};
}
export function describeUseRules(options:CastOption[],bindings:{costKey:string;resourceInstanceId:string}[],resources:ResourceView[]):string[]{
  return options.map(option=>`${option.label}: ${option.costs.length?option.costs.map(cost=>{
    const id=bindings.find(binding=>binding.costKey===cost.costKey)?.resourceInstanceId;const resource=resources.find(resource=>resource.id===id);const name=resource?.name??'기존 연결 확인 필요';
    if(cost.type==='slot')return `${cost.slotSelection==='standard'?'일반 주문':'계약 마법'} 슬롯 1개 · 사용할 때 레벨 선택${cost.autoBind?' · 클래스에서 자동 연결':` · ${name}`}`;
    const amount=cost.type==='fixed'?String(cost.amount):`${cost.min}~${cost.max} (간격 ${cost.step})`;
    return `${name}${cost.slotLevel!==undefined?` ${cost.slotLevel}레벨`:''} ${amount}${resource?.unit??''}`;
  }).join(' + '):'무소모'}`);
}
