import type { CardDefinition } from './contracts';
import type { CardBinding, ResourceChange, ResourceOverrides, ResourcePlan, ResourceTemplate, ResourceView, RecoveryTrigger } from './resources';

export class ResourceError extends Error {}
export interface CapacityProfile { level: number; abilityScores?: Record<string,number> }
function integer(value: number, label: string) { if (!Number.isSafeInteger(value) || value < 0 || value > 1000000) throw new ResourceError(`${label}은 0~1,000,000 사이의 정수여야 합니다.`); return value; }
export function capacityFor(rule: NonNullable<ResourceTemplate['capacity']>, profile: CapacityProfile): number {
  if (rule.type === 'fixed') return integer(rule.value, '최대치');
  if (rule.type === 'level_table') { const value = rule.values[String(profile.level)]; if (value === undefined) throw new ResourceError('현재 레벨의 최대치가 정의되지 않았습니다.'); return integer(value, '최대치'); }
  const score = profile.abilityScores?.[rule.ability];
  if (score === undefined) throw new ResourceError('최대치에 필요한 능력치가 없습니다.');
  return integer(Math.max(rule.minimum, Math.min(rule.maximum ?? 1000000, Math.floor((score - 10) / 2) + rule.offset)), '최대치');
}
export function maximums(template: ResourceTemplate, profile: CapacityProfile, overrides: ResourceOverrides): { capacity?: number; capacityByLevel?: Record<string,number> } {
  if (template.kind === 'counter') return { capacity: overrides.capacityOverride ?? capacityFor(template.capacity!, profile) };
  const values = overrides.slotCapacityOverride ?? (template.slotCapacityByClassLevel ? template.slotCapacityByClassLevel[String(profile.level)] : Object.fromEntries(Object.entries(template.slotCapacity ?? {}).map(([key, rule]) => [key, capacityFor(rule, profile)])));
  if (!values || Object.keys(values).length === 0) throw new ResourceError('현재 레벨의 슬롯 최대치가 없습니다.');
  for (const value of Object.values(values)) integer(value, '슬롯 최대치');
  return { capacityByLevel: values };
}
export function assertResource(view: ResourceView): void {
  if (view.kind === 'counter') { integer(view.capacity!, '최대치'); integer(view.remaining!, '현재량'); if (view.remaining! > view.capacity!) throw new ResourceError('현재량이 최대치를 초과했습니다.'); }
  else {
    if (!view.remainingByLevel || Object.keys(view.remainingByLevel).some(key => !(key in (view.capacityByLevel ?? {})))) throw new ResourceError('정의되지 않은 슬롯 레벨의 상태입니다.');
    for (const [level, max] of Object.entries(view.capacityByLevel ?? {})) { integer(max, '최대치'); const current = view.remainingByLevel[level]; integer(current, '현재량'); if (current > max) throw new ResourceError('슬롯 현재량이 최대치를 초과했습니다.'); }
  }
}
export function stateAt(resource: ResourceView, slotLevel?: number): { current: number; maximum: number } {
  assertResource(resource);
  if (resource.kind === 'counter') { if (slotLevel !== undefined) throw new ResourceError('카운터에는 슬롯 레벨을 지정할 수 없습니다.'); return { current: resource.remaining!, maximum: resource.capacity! }; }
  if (slotLevel === undefined || resource.capacityByLevel?.[String(slotLevel)] === undefined) throw new ResourceError('슬롯 트랙의 레벨을 지정해 주세요.');
  return { current: resource.remainingByLevel![String(slotLevel)], maximum: resource.capacityByLevel![String(slotLevel)] };
}
export function planUse(card: CardDefinition, optionId: string, resources: ResourceView[], bindings: CardBinding[], choices: Record<string,number>): ResourcePlan {
  const option = card.castOptions.find(option => option.id === optionId);
  if (!option) throw new ResourceError('사용 방식을 찾을 수 없습니다.');
  if (option.casting || option.costs.some(cost => cost.type === 'slot')) throw new ResourceError('이 시전 옵션은 P3에서 지원합니다. 일반 자원 비용 옵션을 사용해 주세요.');
  const allowedChoices = new Set(option.costs.filter(cost => cost.type === 'variable').map(cost => cost.costKey));
  if (Object.keys(choices).some(key => !allowedChoices.has(key))) throw new ResourceError('선택할 수 없는 가변 비용입니다.');
  const totals = new Map<string,{ resource: ResourceView; slotLevel?: number; amount: number }>();
  for (const cost of option.costs) {
    if (cost.type === 'slot') throw new ResourceError('시전 슬롯은 P3에서 지원합니다.');
    const binding = bindings.filter(binding => binding.cardId === card.id && binding.costKey === cost.costKey);
    if (binding.length !== 1) throw new ResourceError('비용에 연결된 자원이 없습니다. 비용 설정에서 연결해 주세요.');
    const resource = resources.find(resource => resource.id === binding[0].resourceInstanceId && resource.characterId === binding[0].characterId);
    if (!resource) throw new ResourceError('연결 자원이 삭제되었거나 현재 캐릭터의 자원이 아닙니다.');
    if (resource.overrides.scope === 'card' && resource.overrides.ownerCardId !== card.id) throw new ResourceError('다른 카드 전용 자원입니다.');
    let amount: number;
    if (cost.type === 'fixed') amount = cost.amount;
    else {
      amount = choices[cost.costKey];
      if (!Number.isSafeInteger(amount) || amount < cost.min || amount > cost.max || (amount - cost.min) % cost.step !== 0) throw new ResourceError('가변 소모량의 범위 또는 간격이 올바르지 않습니다.');
    }
    integer(amount, '소모량'); stateAt(resource, cost.slotLevel);
    const key = `${resource.id}:${cost.slotLevel ?? 'counter'}`;
    const total = totals.get(key); const sum = (total?.amount ?? 0) + amount; integer(sum, '총 소모량');
    totals.set(key, { resource, slotLevel: cost.slotLevel, amount: sum });
  }
  const changes: ResourceChange[] = []; let insufficient = false;
  for (const { resource, slotLevel, amount } of totals.values()) {
    const { current } = stateAt(resource, slotLevel);
    if (amount > current) insufficient = true;
    if (amount) changes.push({ resourceInstanceId: resource.id, slotLevel, before: current, after: current - amount });
  }
  return { changes, label: `${card.name} · ${option.label}`, canUse: !insufficient, canOverride: insufficient, reason: insufficient ? '자원이 부족합니다. 전체 비용을 차감하지 않았습니다.' : undefined };
}
export function planRecovery(resources: ResourceView[], trigger: RecoveryTrigger): ResourcePlan {
  const changes: ResourceChange[] = [];
  for (const resource of resources) {
    const rules = resource.template.recovery;
    const rule = rules.find(rule => rule.triggers.includes(trigger)) ?? (trigger === 'long_rest' ? rules.find(rule => rule.triggers.includes('short_rest')) : undefined);
    if (!rule) continue;
    const levels = resource.kind === 'counter' ? [undefined] : Object.keys(resource.capacityByLevel!).map(Number);
    for (const slotLevel of levels) {
      const { current, maximum } = stateAt(resource, slotLevel);
      const after = rule.amount.type === 'full' ? maximum : Math.min(maximum, current + rule.amount.value);
      if (after !== current) changes.push({ resourceInstanceId: resource.id, slotLevel, before: current, after });
    }
  }
  return { changes, label: ({ short_rest: '짧은 휴식', long_rest: '긴 휴식', dawn: '새벽 경과', manual: '수동 회복' })[trigger], canUse: true, canOverride: false };
}
export function planAdjustment(resource: ResourceView, delta: number, slotLevel?: number): ResourcePlan {
  const { current, maximum } = stateAt(resource, slotLevel); const after = current + delta;
  if (!Number.isSafeInteger(delta) || after < 0 || after > maximum) throw new ResourceError('변경 후 현재량이 0~최대치 범위를 벗어납니다.');
  return { changes: delta ? [{ resourceInstanceId: resource.id, slotLevel, before: current, after }] : [], label: `${resource.name} 수동 변경`, canUse: true, canOverride: false };
}
export function applyChanges(resources: ResourceView[], changes: ResourceChange[]): ResourceView[] {
  const next = structuredClone(resources); const seen = new Set<string>();
  for (const change of changes) {
    const resource = next.find(resource => resource.id === change.resourceInstanceId);
    if (!resource) throw new ResourceError('변경 대상 자원이 없습니다.');
    const key = `${resource.id}:${change.slotLevel ?? 'counter'}`;
    if (seen.has(key)) throw new ResourceError('중복 상태 변경입니다.'); seen.add(key);
    const { current, maximum } = stateAt(resource, change.slotLevel);
    if (current !== change.before || change.after < 0 || change.after > maximum || !Number.isSafeInteger(change.after)) throw new ResourceError('자원 상태가 바뀌었거나 범위가 올바르지 않습니다. 다시 확인해 주세요.');
    if (resource.kind === 'counter') resource.remaining = change.after; else resource.remainingByLevel![String(change.slotLevel)] = change.after;
  }
  return next;
}
