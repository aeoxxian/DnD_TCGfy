import type { TrashBridge } from './trash';
import type { BackupBridge } from './backup';
import type { EditBridge } from './bulk';
import { z } from 'zod';
import type { ResourceBridge } from './resources';

export const resourceDisplaySchema = z.strictObject({
  collapsedGroups: z.array(z.enum(['standard', 'pact', 'counter', 'generic'])).max(4),
  priorityIds: z.array(z.string().min(1).max(128)).max(1000),
});
export type ResourceDisplay = z.infer<typeof resourceDisplaySchema>;
/** v1.1: per-character "hidden through" mark for the recent-actions list. Play events themselves are never removed. */
export const historyViewSchema = z.strictObject({
  clearedEventId: z.string().min(1).max(128),
  clearedAt: z.iso.datetime(),
});
export type HistoryView = z.infer<typeof historyViewSchema>;
/** v1.1: visual effects preferences, kept apart from `preferences` so older versions still read the DB. */
export const effectsSchema = z.strictObject({ cardTilt: z.boolean() });
export type Effects = z.infer<typeof effectsSchema>;
/** v1.1: per-character spell slot gem colours (display only). Levels are "1"–"9". */
export const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/, '색상은 #rrggbb 형식이어야 합니다.');
export const slotColorSchema = z.strictObject({
  base: hexColorSchema.optional(),
  levels: z.partialRecord(z.enum(['1', '2', '3', '4', '5', '6', '7', '8', '9']), hexColorSchema).optional(),
});
export const slotColorSetSchema = z.strictObject({ standard: slotColorSchema.optional(), pact: slotColorSchema.optional() });
export type SlotColor = z.infer<typeof slotColorSchema>;
export type SlotColorSet = z.infer<typeof slotColorSetSchema>;

export const idSchema = z.string().min(1).max(128);

// Play-mat appearance: purely visual, stored under its own settings key.
export const THEME_IDS = ['oxblood', 'ebony', 'verdant', 'abyss'] as const;
export type ThemeId = typeof THEME_IDS[number];
export const BUILTIN_CARD_BACKS = ['dragon', 'crest', 'stars'] as const;
export type BuiltinCardBack = typeof BUILTIN_CARD_BACKS[number];
export const cardBackRefSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('builtin'), id: z.enum(BUILTIN_CARD_BACKS) }),
  z.strictObject({ type: z.literal('custom'), assetId: idSchema }),
]);
export type CardBackRef = z.infer<typeof cardBackRefSchema>;
export const appearanceSchema = z.strictObject({
  theme: z.enum(THEME_IDS),
  cardBack: z.strictObject({
    default: cardBackRefSchema,
    decks: z.record(idSchema, cardBackRefSchema).refine(value => Object.keys(value).length <= 500),
  }),
  customBacks: z.array(z.strictObject({ assetId: idSchema, name: z.string().trim().min(1).max(60) })).max(24)
    .refine(list => new Set(list.map(item => item.assetId)).size === list.length, '같은 카드 뒷면 이미지가 중복되었습니다.'),
}).refine(value => [value.cardBack.default, ...Object.values(value.cardBack.decks)]
  .every(ref => ref.type === 'builtin' || value.customBacks.some(item => item.assetId === ref.assetId)), '목록에 없는 카드 뒷면 이미지를 선택했습니다.');
export type Appearance = z.infer<typeof appearanceSchema>;
export const DEFAULT_APPEARANCE: Appearance = { theme: 'oxblood', cardBack: { default: { type: 'builtin', id: 'dragon' }, decks: {} }, customBacks: [] };

export const settingsSchema = z.strictObject({
  viewMode: z.enum(['hand', 'grid']),
  reducedMotion: z.boolean(),
  resourcePanelCollapsed: z.boolean(),
  resourceViews: z.record(z.string().min(1).max(128), resourceDisplaySchema).refine(value => Object.keys(value).length <= 200).optional(),
  appearance: appearanceSchema.optional(),
  historyViews: z.record(z.string().min(1).max(128), historyViewSchema).refine(value => Object.keys(value).length <= 200).optional(),
  effects: effectsSchema.optional(),
  slotColors: z.record(z.string().min(1).max(128), slotColorSetSchema).refine(value => Object.keys(value).length <= 200).optional(),
});
export type Settings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: Settings = { viewMode: 'hand', reducedMotion: false, resourcePanelCollapsed: false };
export const roleSchema = z.enum(['damage', 'heal', 'protect', 'buff', 'debuff', 'utility', 'revive', 'other']);
export const actionSchema = z.enum(['action', 'bonus_action', 'reaction', 'no_action', 'passive', 'special']);
export const kindSchema = z.enum(['spell', 'attack', 'feature', 'feat', 'item', 'other']);
export const rangeSchema = z.enum(['self', 'touch', 'melee', 'ranged', 'special']);

export const costSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('fixed'), costKey: z.string().min(1), amount: z.number().int().nonnegative(), slotLevel: z.number().int().min(1).max(9).optional() }),
  z.strictObject({ type: z.literal('slot'), costKey: z.string().min(1), slotSelection: z.enum(['standard', 'pact']), autoBind: z.boolean().optional() }),
  z.strictObject({ type: z.literal('variable'), costKey: z.string().min(1), min: z.number().int().nonnegative(), max: z.number().int().nonnegative(), step: z.number().int().positive(), slotLevel: z.number().int().min(1).max(9).optional() }).refine(v => v.min <= v.max),
]);
const castingSchema = z.strictObject({
  mode: z.enum(['standard', 'pact', 'homebrew']), allowUpcast: z.boolean().default(true), allowBelowBase: z.boolean().default(false),
  minSlotLevel: z.number().int().min(1).max(9).optional(), maxSlotLevel: z.number().int().min(1).max(9).optional(),
}).refine(v => !v.allowBelowBase || v.mode === 'homebrew', '다운캐스팅은 홈브루 옵션에만 허용됩니다.')
  .refine(v => v.minSlotLevel === undefined || v.maxSlotLevel === undefined || v.minSlotLevel <= v.maxSlotLevel);
export const cardSchema = z.strictObject({
  id: z.string().min(1), name: z.string().min(1), imageAssetId: z.string().min(1).optional(),
  kind: kindSchema,
  roles: z.array(roleSchema),
  actions: z.array(actionSchema),
  range: z.strictObject({ kind: z.enum(['self', 'touch', 'melee', 'ranged', 'special']), feet: z.number().nonnegative().optional() }),
  tags: z.array(z.string().min(1)), description: z.string().optional(), spellLevel: z.number().int().min(0).max(9).optional(),
  castOptions: z.array(z.strictObject({ id: z.string().min(1), label: z.string().min(1), costs: z.array(costSchema), casting: castingSchema.optional() })).min(1),
  costStatus: z.enum(['unconfigured', 'configured']).optional(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).refine(v => v.spellLevel === undefined || v.kind === 'spell');
export type CardDefinition = z.infer<typeof cardSchema>;
export type Role = CardDefinition['roles'][number];
export type CastOption = CardDefinition['castOptions'][number];

export const cardDraftSchema = z.strictObject({
  id: idSchema.optional(),
  name: z.string().trim().min(1, '카드 이름을 입력해 주세요.').max(200),
  imageAssetId: idSchema.optional(),
  kind: kindSchema,
  roles: z.array(roleSchema).max(8), actions: z.array(actionSchema).max(6),
  range: z.strictObject({ kind: rangeSchema, feet: z.number().int().min(0).max(100000).optional() }),
  tags: z.array(idSchema).max(100), description: z.string().max(10000).optional(),
  spellLevel: z.number().int().min(0).max(9).optional(),
}).refine(v => v.spellLevel === undefined || v.kind === 'spell', '주문에만 주문 레벨을 지정할 수 있습니다.');
export type CardDraft = z.infer<typeof cardDraftSchema>;
export const registrationTargetSchema = z.strictObject({ characterId: idSchema, deckId: idSchema });
export type RegistrationTarget = z.infer<typeof registrationTargetSchema>;
export const initialRulesSchema = z.strictObject({
  requestId: z.uuid(), configured: z.boolean(), scope: z.enum(['shared', 'character']),
  characterId: idSchema.optional(), expectedRevision: z.number().int().nonnegative().optional(),
  castOptions: cardSchema.shape.castOptions.max(12).refine(options => options.reduce((n, option) => n + option.costs.length, 0) <= 100),
  bindings: z.array(z.strictObject({ costKey: z.string().min(1).max(128), resourceInstanceId: idSchema })).max(100),
});
export type InitialRules = z.infer<typeof initialRulesSchema>;
export const saveCardsSchema = z.strictObject({ cards: z.array(cardDraftSchema).min(1).max(100), registrationTarget: registrationTargetSchema.nullable().optional(), initialRules: initialRulesSchema.optional() });
export const libraryStateSchema = z.strictObject({
  query: z.string().max(200), roles: z.array(roleSchema).max(8), actions: z.array(actionSchema).max(6),
  kinds: z.array(kindSchema).max(6), ranges: z.array(rangeSchema).max(5), tagIds: z.array(idSchema).max(100),
  viewScope: z.enum(['library', 'deck']), activeCharacterId: idSchema.optional(),
});
export type LibraryState = z.infer<typeof libraryStateSchema>;
export const DEFAULT_LIBRARY_STATE: LibraryState = { query: '', roles: [], actions: [], kinds: [], ranges: [], tagIds: [], viewScope: 'library' };
export const tagMutationSchema = z.strictObject({ id: idSchema.optional(), name: z.string().trim().min(1).max(60) });
export interface Tag { id: string; name: string; usageCount: number }
export interface AssetPreview { id: string; name: string; url: string; thumbnailUrl: string; width: number; height: number }
export interface ImportBatch { assets: AssetPreview[]; errors: { name: string; message: string }[] }
export interface ProfileSummary { id: string; name: string; activeDeckId?: string; classId?: string; level?: number; ruleset?: 'dnd5e_2014'|'homebrew' }
export interface Deck { id: string; characterId: string; name: string; cardIds: string[] }
export const createProfileSchema = z.strictObject({ name: z.string().trim().min(1).max(100) });
export const createDeckSchema = z.strictObject({ characterId: idSchema, name: z.string().trim().min(1).max(100) });
export const selectDeckSchema = z.strictObject({ characterId: idSchema, deckId: idSchema });
export const deckCardsSchema = z.strictObject({ deckId: idSchema, cardIds: z.array(idSchema).max(5000) });
export const importPathsSchema = z.array(z.string().min(1).max(32767)).min(1).max(100);

export interface Library {
  cards: CardDefinition[]; tags: Tag[]; profiles: ProfileSummary[]; decks: Deck[];
  libraryState: LibraryState; warnings: string[];
}

export interface Bootstrap extends Library {
  settings: Settings;
  cards: CardDefinition[];
  appVersion: string;
  schemaVersion: number;
  /** One-off start-up messages (restore finished, auto backup made). */
  notices?: string[];
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export interface DesktopBridge extends ResourceBridge, EditBridge, TrashBridge, BackupBridge {
  getBootstrap(): Promise<Result<Bootstrap>>;
  saveSettings(settings: Settings): Promise<Result<Settings>>;
  saveLibraryState(state: LibraryState): Promise<Result<LibraryState>>;
  importImages(files: File[]): Promise<Result<ImportBatch>>;
  saveCards(input: z.infer<typeof saveCardsSchema>): Promise<Result<Library>>;
  archiveCard(id: string): Promise<Result<Library>>;
  saveTag(input: z.infer<typeof tagMutationSchema>): Promise<Result<Library>>;
  deleteTag(id: string): Promise<Result<Library>>;
  createProfile(input: z.infer<typeof createProfileSchema>): Promise<Result<Library>>;
  createDeck(input: z.infer<typeof createDeckSchema>): Promise<Result<Library>>;
  selectDeck(input: z.infer<typeof selectDeckSchema>): Promise<Result<Library>>;
  setDeckCards(input: z.infer<typeof deckCardsSchema>): Promise<Result<Library>>;
}
export const IPC = {
  getTrash:'trash:get', previewTrash:'trash:preview', changeTrash:'trash:change', retryImageCleanup:'trash:cleanup', getUseHistory:'resources:history',
  previewEdit: 'edits:preview', applyEdit: 'edits:apply', getEditHistory: 'edits:history',
  getBootstrap: 'board:get-bootstrap', saveSettings: 'settings:save', saveLibraryState: 'library:state',
  importImages: 'assets:import', saveCards: 'cards:save', archiveCard: 'cards:archive', saveTag: 'tags:save', deleteTag: 'tags:delete',
  createProfile: 'profiles:create', createDeck: 'decks:create', selectDeck: 'decks:select', setDeckCards: 'decks:cards',
  previewClass: 'classes:preview', getResources: 'resources:get', previewResource: 'resources:preview', changeResource: 'resources:change',
  exportBackup: 'backup:export', inspectBackup: 'backup:inspect', applyBackup: 'backup:apply', discardBackup: 'backup:discard', getBackupStatus: 'backup:status',
} as const;
