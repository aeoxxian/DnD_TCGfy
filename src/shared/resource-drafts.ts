import { normalizeText } from './library';
import type { RecoveryTrigger, ResourceView, TemplateDraft } from './resources';

/** Display names of the recovery triggers, shared by 자원 관리 and the registration resource form. */
export const RECOVERY_TRIGGER_NAMES: Record<RecoveryTrigger, string> = { short_rest: '짧은 휴식', long_rest: '긴 휴식', dawn: '새벽 경과', manual: '수동 회복' };
export const RECOVERY_TRIGGERS = Object.keys(RECOVERY_TRIGGER_NAMES) as RecoveryTrigger[];
export const PRESET_UNITS = ['점', '회', '개', '슬롯'];

export interface RecoveryChoice { type: 'none' | 'full' | 'fixed'; value: number }
export type RecoveryChoices = Record<RecoveryTrigger, RecoveryChoice>;

/** Form state for every trigger, read from a template's rules (or "회복 안 함"). */
export function recoveryChoices(recovery: TemplateDraft['recovery'] = []): RecoveryChoices {
  return Object.fromEntries(RECOVERY_TRIGGERS.map(trigger => {
    const rule = recovery.find(rule => rule.triggers.includes(trigger));
    return [trigger, { type: rule?.amount.type ?? 'none', value: rule?.amount.type === 'fixed' ? rule.amount.value : 1 }];
  })) as RecoveryChoices;
}
/** Template recovery rules from the form state. Slot tracks only recover in full. */
export function recoveryRules(choices: RecoveryChoices, kind: TemplateDraft['kind']): TemplateDraft['recovery'] {
  return RECOVERY_TRIGGERS.flatMap(trigger => {
    const choice = choices[trigger];
    if (choice.type === 'none' || kind === 'slot_track' && choice.type === 'fixed') return [];
    return [{ triggers: [trigger], amount: choice.type === 'fixed' ? { type: 'fixed' as const, value: choice.value } : { type: 'full' as const } }];
  });
}

export function sameResourceName(a: string, b: string): boolean { return normalizeText(a) === normalizeText(b); }
/** An active resource of the character with the same (normalised) name, if any. */
export function findSameNameResource(resources: ResourceView[], name: string): ResourceView | undefined {
  return name.trim() ? resources.find(resource => !resource.ownedDefinitionId && sameResourceName(resource.name, name)) : undefined;
}
/** Counters that a basic use rule can bind (card-owned resources belong to another card). */
export function bindableCounters(resources: ResourceView[]): ResourceView[] {
  return resources.filter(resource => resource.kind === 'counter' && resource.overrides.scope !== 'card');
}

/**
 * A resource the user filled in while registering a card. It only exists in the registration form
 * until the card is saved; the save creates it in the same transaction as the card (never before).
 */
export interface NewResourceDraft { draftId: string; template: TemplateDraft }

/** A stand-in view so the draft can be listed, selected and summarised like an existing counter. */
export function draftResourceView(draft: NewResourceDraft, characterId: string): ResourceView {
  const capacity = draft.template.capacity?.type === 'fixed' ? draft.template.capacity.value : 0;
  return {
    id: draft.draftId, characterId, templateId: draft.draftId, name: draft.template.name, unit: draft.template.unit, kind: 'counter',
    unlimited: draft.template.unlimited, capacity, remaining: capacity, overrides: { scope: 'character' },
    template: { ...draft.template, id: draft.draftId, key: `draft_${draft.draftId}`, source: 'user', version: 0 },
  };
}
export function describeDraft(draft: NewResourceDraft): string {
  const capacity = draft.template.capacity?.type === 'fixed' ? draft.template.capacity.value : 0;
  return draft.template.unlimited ? `무제한 ${draft.template.unit}` : `최대 ${capacity}${draft.template.unit}`;
}
