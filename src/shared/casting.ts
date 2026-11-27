import type { CardDefinition, CastOption } from './contracts';
import type { CardBinding, ResourceSnapshot, ResourceView } from './resources';

type Cost = CastOption['costs'][number] & { ownedDefinitionId?: string };
type ResolvedOption = Omit<CastOption, 'costs'> & { costs: Cost[] };
export class ResourceRequirementError extends Error {
  constructor(message: string, readonly reason: 'missing' | 'level') { super(message); }
}

export function resolveCostResource(cardId: string, cost: Cost, resources: ResourceView[], bindings: CardBinding[]): ResourceView {
  if (cost.ownedDefinitionId) {
    const resource = resources.find(item => item.overrides.ownerCardId === cardId && item.ownedDefinitionId === cost.ownedDefinitionId);
    if (!resource || resource.inactive) throw new ResourceRequirementError('카드 고유 자원은 이 캐릭터의 활성 덱에 카드가 있을 때 사용합니다.', 'missing');
    return resource;
  }
  const slot = cost.type === 'slot' ? cost.slotSelection : undefined;
  const requirement = cost.requirement;
  let resource: ResourceView;
  if (requirement && !bindings.some(binding => binding.cardId === cardId && binding.costKey === cost.costKey)) {
    const keyed = resources.filter(item => !item.ownedDefinitionId && item.overrides.scope === 'character'
      && (item.template.matchKey === requirement.key || item.template.key === requirement.key));
    const matches = keyed.filter(item => requirement.kind === 'counter' ? item.kind === 'counter'
      : item.kind === 'slot_track' && (item.template.slotKind ?? 'generic') === (slot ?? 'generic'));
    if (!keyed.length) throw new ResourceRequirementError(`필요한 자원 ‘${requirement.key}’을(를) 보유하지 않았습니다.`, 'missing');
    if (!matches.length) throw new Error('식별 키에 맞는 자원의 종류가 다릅니다.');
    if (matches.length > 1) throw new Error('같은 자원 후보가 여러 개입니다. 카드 사용 규칙에서 직접 연결해 주세요.');
    resource = matches[0];
  } else {
    resource = boundResource(cardId, cost.costKey, resources, bindings, cost.type === 'slot' && cost.autoBind && slot !== 'generic' ? slot : undefined);
  }
  if (resource.inactive) throw new ResourceRequirementError('연결된 카드 고유 자원이 비활성 상태입니다.', 'missing');
  if (slot && (resource.kind !== 'slot_track' || (resource.template.slotKind ?? 'generic') !== slot)) throw new Error('슬롯의 연결 종류가 다릅니다. 일반, 계약, 사용자 정의 슬롯 설정을 확인해 주세요.');
  if (requirement && (requirement.kind === 'counter' ? resource.kind !== 'counter'
    : resource.kind !== 'slot_track' || (resource.template.slotKind ?? 'generic') !== (slot ?? 'generic'))) throw new Error('요구 자원과 수동 연결의 종류가 다릅니다.');
  return resource;
}

export function hasConfiguredCost(card: CardDefinition): boolean {
  return card.costStatus !== 'unconfigured' || !!card.ownedResources?.length;
}

export function effectiveCard(card:CardDefinition,snapshot?:ResourceSnapshot):CardDefinition {
  const override=snapshot?.costOverrides?.find(value=>value.cardId===card.id);
  return override?{...card,costStatus:'configured',castOptions:override.castOptions}:card;
}

// Keep persisted option IDs and bindings. A ritual is a way to use a rule, not a second stored copy of that rule.
export function castingOptions(card: CardDefinition, ritual: boolean): CastOption[] {
  if (!ritual) return card.castOptions.filter(option => !option.ritual);
  if (!card.ritual) return [];
  const explicit = card.castOptions.filter(option => option.ritual);
  return explicit.length ? explicit : card.castOptions;
}

export function resolveCastOption(card: CardDefinition, optionId: string, ritual: boolean, resources: ResourceView[], bindings: CardBinding[]): ResolvedOption {
  const source = castingOptions(card, ritual).find(option => option.id === optionId);
  const option = source && card.costStatus === 'unconfigured' && card.ownedResources?.length
    ? { ...source, label: '고유 자원 사용' } : source;
  if (!option) throw new Error('사용 방식을 찾을 수 없습니다.');
  const ownedCosts: Cost[] = (card.ownedResources ?? []).map(definition => ({ type: 'fixed', costKey: `owned:${definition.id}`, ownedDefinitionId: definition.id, amount: definition.amount }));
  if (!ritual) return ownedCosts.length ? { ...option, costs: [...option.costs, ...ownedCosts] } : option;
  const costs = option.costs.filter(cost => {
    if (cost.type === 'slot') return false;
    if (cost.slotLevel === undefined) return true;
    // Legacy fixed/variable costs also address a specific tier. Keep non-spell tracks and surface stale bindings.
    const resource = resolveCostResource(card.id, cost, resources, bindings);
    return resource.kind !== 'slot_track' || !['standard', 'pact'].includes(resource.template.slotKind ?? '');
  });
  return { ...option, label: option.ritual ? option.label : `의식 시전 · ${option.label}`, costs: [...costs, ...ownedCosts], casting: undefined, ritual: true };
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
    if (!candidates.length) throw new ResourceRequirementError('자동으로 사용할 클래스 슬롯이 없습니다. 클래스 설정 또는 카드 사용 규칙에서 자원을 선택해 주세요.', 'missing');
    throw new Error('클래스 슬롯이 여러 개입니다. 카드 사용 규칙에서 사용할 자원을 골라 주세요.');
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
  const resource=resolveCostResource(card.id,cost,resources,bindings);
  if(option.casting&&option.casting.mode!=='homebrew'&&option.casting.mode!==cost.slotSelection)throw new Error('시전 방식과 슬롯 종류가 일치하지 않습니다.');
  const tiers=Object.entries(resource.capacityByLevel??{}).filter(([,max])=>max>0).map(([level])=>Number(level));
  if(cost.slotSelection==='pact'&&tiers.length!==1)throw new Error('계약 마법은 하나의 동일한 슬롯 레벨만 사용합니다.');
  return tiers.filter(level=>castingLevels(card,option).includes(level)).sort((a,b)=>a-b);
}
