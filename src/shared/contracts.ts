import { z } from 'zod';

export const settingsSchema = z.strictObject({
  viewMode: z.enum(['hand', 'grid']),
  reducedMotion: z.boolean(),
  resourcePanelCollapsed: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: Settings = { viewMode: 'hand', reducedMotion: false, resourcePanelCollapsed: false };

const costSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('fixed'), costKey: z.string().min(1), amount: z.number().int().nonnegative() }),
  z.strictObject({ type: z.literal('slot'), costKey: z.string().min(1), slotSelection: z.enum(['standard', 'pact']) }),
  z.strictObject({ type: z.literal('variable'), costKey: z.string().min(1), min: z.number().int().nonnegative(), max: z.number().int().nonnegative(), step: z.number().int().positive() }).refine(v => v.min <= v.max),
]);
const castingSchema = z.strictObject({
  mode: z.enum(['standard', 'pact', 'homebrew']), allowUpcast: z.boolean(), allowBelowBase: z.boolean(),
  minSlotLevel: z.number().int().min(1).max(9).optional(), maxSlotLevel: z.number().int().min(1).max(9).optional(),
}).refine(v => !v.allowBelowBase || v.mode === 'homebrew', '다운캐스팅은 홈브루 옵션에만 허용됩니다.')
  .refine(v => v.minSlotLevel === undefined || v.maxSlotLevel === undefined || v.minSlotLevel <= v.maxSlotLevel);
export const cardSchema = z.strictObject({
  id: z.string().min(1), name: z.string().min(1), imageAssetId: z.string().min(1).optional(),
  kind: z.enum(['spell', 'feature', 'attack', 'item', 'feat', 'other']),
  roles: z.array(z.enum(['heal', 'damage', 'utility', 'other'])),
  actions: z.array(z.enum(['action', 'bonus_action', 'reaction', 'no_action', 'passive', 'special'])),
  range: z.strictObject({ kind: z.enum(['self', 'touch', 'melee', 'ranged', 'special']), feet: z.number().nonnegative().optional() }),
  tags: z.array(z.string().min(1)), description: z.string().optional(), spellLevel: z.number().int().min(0).max(9).optional(),
  castOptions: z.array(z.strictObject({ id: z.string().min(1), label: z.string().min(1), costs: z.array(costSchema), casting: castingSchema.optional() })).min(1),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).refine(v => v.spellLevel === undefined || v.kind === 'spell');
export type CardDefinition = z.infer<typeof cardSchema>;
export type Role = CardDefinition['roles'][number];

export interface Bootstrap {
  settings: Settings;
  cards: CardDefinition[];
  appVersion: string;
  schemaVersion: number;
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export interface DesktopBridge {
  getBootstrap(): Promise<Result<Bootstrap>>;
  saveSettings(settings: Settings): Promise<Result<Settings>>;
}
export const IPC = { getBootstrap: 'board:get-bootstrap', saveSettings: 'settings:save' } as const;
