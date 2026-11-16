import type { CardDefinition, CastOption } from './contracts';
import type { CardBinding, ResourceSnapshot, ResourceView } from './resources';

export function effectiveCard(card:CardDefinition,snapshot?:ResourceSnapshot):CardDefinition {
  const override=snapshot?.costOverrides?.find(value=>value.cardId===card.id);
  return override?{...card,castOptions:override.castOptions}:card;
}
export function castingLevels(card:CardDefinition,option:CastOption):number[] {
  if(card.kind!=='spell'||card.spellLevel===undefined)throw new Error('주문 카드에 기본 주문 레벨을 지정해 주세요.');
  const base=card.spellLevel;
  if(base===0)return [0];
  const config=option.casting;
  const below=config?.mode==='homebrew'&&config.allowBelowBase;
  const min=Math.max(1,config?.minSlotLevel??1,below?1:base);
  const max=Math.min(9,config?.maxSlotLevel??9,config?.allowUpcast===false?base:9);
  return Array.from({length:9},(_,i)=>i+1).filter(level=>level>=min&&level<=max);
}
export function boundResource(cardId:string,costKey:string,resources:ResourceView[],bindings:CardBinding[],autoSlot?:'standard'|'pact'):ResourceView {
  const matches=bindings.filter(binding=>binding.cardId===cardId&&binding.costKey===costKey);
  if(matches.length===0&&autoSlot){
    const candidates=resources.filter(resource=>resource.presetKey?.startsWith('2014:')&&resource.kind==='slot_track'&&resource.template.slotKind===autoSlot&&resource.overrides.scope==='character');
    if(candidates.length===1)return candidates[0];
    throw new Error(candidates.length?'클래스 슬롯이 여러 개입니다. 카드 사용 규칙에서 사용할 자원을 골라 주세요.':'자동으로 사용할 클래스 슬롯이 없습니다. 클래스 설정 또는 카드 사용 규칙에서 자원을 선택해 주세요.');
  }
  if(matches.length!==1)throw new Error('비용에 연결된 자원이 없습니다. 비용 설정에서 연결해 주세요.');
  const resource=resources.find(resource=>resource.id===matches[0].resourceInstanceId&&resource.characterId===matches[0].characterId);
  if(!resource)throw new Error('연결 자원이 삭제되었거나 현재 캐릭터의 자원이 아닙니다.');
  if(resource.overrides.scope==='card'&&resource.overrides.ownerCardId!==cardId)throw new Error('다른 카드 전용 자원입니다.');
  return resource;
}
export function slotLevels(card:CardDefinition,option:CastOption,costKey:string,resources:ResourceView[],bindings:CardBinding[]):number[] {
  const cost=option.costs.find(cost=>cost.costKey===costKey&&cost.type==='slot');
  if(!cost||cost.type!=='slot')throw new Error('슬롯 비용을 찾을 수 없습니다.');
  if(card.kind==='spell'&&card.spellLevel===0)return [];
  const resource=boundResource(card.id,costKey,resources,bindings,cost.autoBind?cost.slotSelection:undefined);
  if(resource.kind!=='slot_track'||resource.template.slotKind!==cost.slotSelection)throw new Error('일반 주문 슬롯과 계약 마법 슬롯의 연결 종류가 다릅니다. 자원 설정을 확인해 주세요.');
  if(option.casting&&option.casting.mode!=='homebrew'&&option.casting.mode!==cost.slotSelection)throw new Error('시전 방식과 슬롯 종류가 일치하지 않습니다.');
  const tiers=Object.entries(resource.capacityByLevel??{}).filter(([,max])=>max>0).map(([level])=>Number(level));
  if(cost.slotSelection==='pact'&&tiers.length!==1)throw new Error('계약 마법은 하나의 동일한 슬롯 레벨만 사용합니다.');
  return tiers.filter(level=>castingLevels(card,option).includes(level)).sort((a,b)=>a-b);
}
