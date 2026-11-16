import { z } from 'zod';
import { cardSchema, idSchema } from './contracts';
import { classInputSchema, type ClassPreview, type ClassInput, type CharacterConfiguration } from './class-contracts';

export const resourceInteger = z.number().int().min(0).max(1000000);
const levelKey = z.string().regex(/^[1-9]$/);
const classLevelKey = z.string().regex(/^([1-9]|1[0-9]|20)$/);
export const capacityRuleSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('fixed'), value: resourceInteger }),
  z.strictObject({ type: z.literal('level_table'), values: z.record(classLevelKey, resourceInteger) }),
  z.strictObject({ type: z.literal('ability_modifier'), ability: z.enum(['STR','DEX','CON','INT','WIS','CHA']), offset: z.number().int().min(-1000).max(1000), minimum: resourceInteger, maximum: resourceInteger.optional() }).refine(v => v.maximum === undefined || v.maximum >= v.minimum),
]);
export const recoveryTriggerSchema = z.enum(['short_rest','long_rest','dawn','manual']);
export type RecoveryTrigger = z.infer<typeof recoveryTriggerSchema>;
export const recoveryRuleSchema = z.strictObject({ triggers: z.array(recoveryTriggerSchema).min(1).max(4), amount: z.discriminatedUnion('type', [z.strictObject({ type: z.literal('full') }),z.strictObject({ type: z.literal('fixed'), value: resourceInteger })]) });
export const templateDraftSchema = z.strictObject({
  id: idSchema.optional(), name: z.string().trim().min(1).max(100), unit: z.string().trim().min(1).max(30), kind: z.enum(['counter','slot_track']),
  unlimited: z.boolean().optional(), slotKind: z.enum(['standard','pact','generic']).optional(), capacity: capacityRuleSchema.optional(), slotCapacity: z.record(levelKey, capacityRuleSchema).optional(),
  slotCapacityByClassLevel: z.record(classLevelKey, z.record(levelKey, resourceInteger)).optional(), recovery: z.array(recoveryRuleSchema).max(4),
}).superRefine((v, ctx) => {
  if (v.kind === 'counter' && (!v.capacity || v.slotCapacity || v.slotCapacityByClassLevel)) ctx.addIssue({ code: 'custom', message: '카운터는 최대치 규칙 하나를 지정하세요.' });
  if (v.kind === 'slot_track' && (v.capacity || Number(!!v.slotCapacity) + Number(!!v.slotCapacityByClassLevel) !== 1)) ctx.addIssue({ code: 'custom', message: '슬롯 트랙의 레벨별 최대치를 지정하세요.' });
  if (v.kind === 'slot_track' && v.unlimited) ctx.addIssue({code:'custom',message:'슬롯 트랙은 무제한으로 설정하지 않습니다.'});
  if (v.kind === 'counter' && v.slotKind) ctx.addIssue({code:'custom',message:'카운터에는 슬롯 종류를 지정하지 않습니다.'});
  const seen = new Set<string>();
  for (const rule of v.recovery) {
    if (v.kind === 'slot_track' && rule.amount.type !== 'full') ctx.addIssue({ code: 'custom', message: '슬롯 자동 회복은 전량만 지원합니다. 부분 회복은 레벨별로 조정하세요.' });
    for (const trigger of rule.triggers) { if (seen.has(trigger)) ctx.addIssue({ code: 'custom', message: '같은 회복 조건을 두 번 정의할 수 없습니다.' }); seen.add(trigger); }
  }
});
export type TemplateDraft = z.infer<typeof templateDraftSchema>;
export interface ResourceTemplate extends Omit<TemplateDraft, 'id'> { id: string; key: string; source: 'class_2014' | 'user'; version: number }
export const scopeSchema = z.enum(['character','card','item']);
export const overrideSchema = z.strictObject({ unlimitedOverride: z.boolean().optional(), nameOverride: z.string().trim().min(1).max(100).optional(), capacityOverride: resourceInteger.optional(), slotCapacityOverride: z.record(levelKey, resourceInteger).optional(), scope: scopeSchema.default('character'), ownerCardId: idSchema.optional() });
export type ResourceOverrides = z.infer<typeof overrideSchema>;
export interface ResourceView {
  id: string; characterId: string; presetKey?: string; unlimited?: boolean; templateId: string; name: string; unit: string; kind: 'counter'|'slot_track';
  capacity?: number; remaining?: number; capacityByLevel?: Record<string,number>; remainingByLevel?: Record<string,number>;
  overrides: ResourceOverrides; template: ResourceTemplate;
}
export interface ResourceChange { resourceInstanceId: string; slotLevel?: number; before: number; after: number }
export interface CardBinding { id: string; characterId: string; cardId: string; costKey: string; resourceInstanceId: string }
export interface ResourceEvent {
  id: string; characterId: string; type: string; label: string; changes: ResourceChange[]; timestamp: string;
  cardId?: string; castOptionId?: string; selectedSlotLevels?: Record<string,number>; castingLevel?: number; costSnapshot?: { name: string; spellLevel?: number; option: import('./contracts').CastOption }; classUndo?: { before: unknown; after: unknown }; undoesEventId?: string; reversible: boolean; barrier: boolean; engineVersion?: number; override?: boolean;
}
export interface ResourceSnapshot { profile?: CharacterConfiguration; costOverrides?: {cardId:string;castOptions:import('./contracts').CastOption[]}[]; sharedCostUsers?: Record<string,number>; characterId: string; revision: number; resources: ResourceView[]; templates: ResourceTemplate[]; bindings: CardBinding[]; events: ResourceEvent[]; warnings: string[]; undoTargetId?: string }
export const choicesSchema = z.record(z.string().min(1).max(128), resourceInteger).default({});
export const usePreviewActionSchema = z.strictObject({ type: z.literal('use'), cardId: idSchema, optionId: idSchema, choices: choicesSchema, castingLevel: z.number().int().min(0).max(9).optional() });
const recoverActionSchema = z.strictObject({ type: z.literal('recover'), trigger: recoveryTriggerSchema });
const adjustActionSchema = z.strictObject({ type: z.literal('adjust'), resourceId: idSchema, slotLevel: z.number().int().min(1).max(9).optional(), delta: z.number().int().min(-1000000).max(1000000) });
export const previewRequestSchema = z.strictObject({ characterId: idSchema, action: z.discriminatedUnion('type', [usePreviewActionSchema,recoverActionSchema,adjustActionSchema]) });
export type PreviewRequest = z.input<typeof previewRequestSchema>;
const scopeFields = { scope: scopeSchema, ownerCardId: idSchema.optional() };
export const saveCostsActionSchema = z.strictObject({ type: z.literal('save_costs'), spellLevel: z.number().int().min(0).max(9).optional(), scope: z.enum(['shared','character']).default('shared'), confirmShared: z.boolean().default(false), expectedCardVersion: z.string().optional(), cardId: idSchema, castOptions: cardSchema.shape.castOptions.max(12).refine(options => options.reduce((total, option) => total + option.costs.length, 0) <= 100, '카드 한 장에 비용은 100개까지 지정할 수 있습니다.'), bindings: z.array(z.strictObject({ costKey: z.string().min(1).max(128), resourceInstanceId: idSchema })).max(100) });
export const resourceActionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('create_resource'), template: templateDraftSchema, ...scopeFields }),
  z.strictObject({ type: z.literal('save_template'), template: templateDraftSchema }),
  z.strictObject({ type: z.literal('archive_template'), templateId: idSchema }),
  z.strictObject({ type: z.literal('attach'), templateId: idSchema, ...scopeFields }),
  z.strictObject({ type: z.literal('edit_resource'), resourceId: idSchema, overrides: overrideSchema }),
  z.strictObject({ type: z.literal('delete_resource'), resourceId: idSchema }),
  z.strictObject({ type: z.literal('configure_class'), configuration: classInputSchema, quote: z.string().length(64), confirmRetire: z.boolean().default(false) }),
  z.strictObject({ type: z.literal('clear_cost_override'), cardId: idSchema }),
  saveCostsActionSchema,
  usePreviewActionSchema.extend({ quote: z.string().length(64), override: z.boolean().default(false) }),
  recoverActionSchema, adjustActionSchema, z.strictObject({ type: z.literal('undo') }),
]);
export const resourceRequestSchema = z.strictObject({ requestId: z.uuid(), characterId: idSchema, expectedRevision: z.number().int().nonnegative(), action: resourceActionSchema });
export type ResourceAction = z.input<typeof resourceActionSchema>;
export type ResourceRequest = z.input<typeof resourceRequestSchema>;
export interface ResourcePlan { changes: ResourceChange[]; label: string; canUse: boolean; canOverride: boolean; reason?: string; selectedSlotLevels?: Record<string,number>; castingLevel?: number }
export interface ResourcePreview extends ResourcePlan { revision: number; quote: string }
export interface ResourceResult { snapshot: ResourceSnapshot; replayed: boolean; eventId?: string }
export interface ResourceBridge {
  previewClass(input: {characterId:string; configuration:ClassInput}): Promise<import('./contracts').Result<ClassPreview>>;
  getResources(characterId: string): Promise<import('./contracts').Result<ResourceSnapshot>>;
  previewResource(input: PreviewRequest): Promise<import('./contracts').Result<ResourcePreview>>;
  changeResource(input: ResourceRequest): Promise<import('./contracts').Result<ResourceResult>>;
}
