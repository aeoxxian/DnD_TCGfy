import type { TrashBridge } from './trash';
import type { BackupBridge } from './backup';
import type { DeckExchangeBridge } from './deck-exchange';
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
export const effectsSchema = z.strictObject({ cardTilt: z.boolean().optional(), systemCursor: z.boolean().optional() });
export type Effects = z.infer<typeof effectsSchema>;
/**
 * v1.2: hand scrolling options in their own `hand_scroll` settings key. 1.1.0 validates `effects` strictly,
 * so a new field there would stop 1.1.0 from opening the same database.
 */
export const handScrollSchema = z.strictObject({ inertia: z.boolean().optional() });
export type HandScroll = z.infer<typeof handScrollSchema>;
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

export const roleSchema = z.enum(['damage', 'heal', 'protect', 'buff', 'debuff', 'utility', 'revive', 'other']);
export const actionSchema = z.enum(['action', 'bonus_action', 'reaction', 'no_action', 'passive', 'special']);
export const kindSchema = z.enum(['spell', 'attack', 'feature', 'feat', 'item', 'other']);
export const rangeSchema = z.enum(['self', 'touch', 'melee', 'ranged', 'special']);
export const resourceMatchKeySchema = z.string().trim().min(1).max(128).regex(/^[a-z0-9][a-z0-9:_-]*$/i, '자원 식별 키에는 영문, 숫자, 콜론, 밑줄, 하이픈을 사용하세요.');
const portableAmount = z.number().int().min(0).max(1000000);
export const recoveryRuleSchema = z.strictObject({
  triggers: z.array(z.enum(['short_rest','long_rest','dawn','manual'])).min(1).max(4),
  amount: z.discriminatedUnion('type', [z.strictObject({ type: z.literal('full') }), z.strictObject({ type: z.literal('fixed'), value: portableAmount })]),
});
export const ownedResourcesSchema = z.array(z.strictObject({
  id: z.uuid(), name: z.string().trim().min(1).max(100), unit: z.string().trim().min(1).max(30),
  maximum: portableAmount, amount: portableAmount.min(1), recovery: z.array(recoveryRuleSchema).max(4),
}).refine(definition => {
  const triggers = definition.recovery.flatMap(rule => rule.triggers);
  return new Set(triggers).size === triggers.length;
}, '같은 회복 조건을 두 번 정의할 수 없습니다.')).max(12)
  .refine(definitions => new Set(definitions.map(definition => definition.id)).size === definitions.length, '고유 자원 ID가 중복됩니다.');
export type OwnedResource = z.infer<typeof ownedResourcesSchema>[number];
const slotFamilySchema = z.enum(['standard', 'pact', 'generic']);
export const resourceRequirementSchema = z.strictObject({
  kind: z.enum(['counter', 'track']), key: resourceMatchKeySchema, slotKind: slotFamilySchema.optional(),
}).refine(requirement => requirement.kind === 'track' || requirement.slotKind === undefined);
export const deckImageReferenceSchema = z.strictObject({ sha256: z.string().regex(/^[0-9a-f]{64}$/) });
export const imageModeSchema = z.enum(['full_card', 'illustration', 'none']);
export type ImageMode = z.infer<typeof imageModeSchema>;
const cardMetadata = {
  imageMode: imageModeSchema.optional(),
  concentration: z.boolean().optional(),
  ritual: z.boolean().optional(),
  upcastEffect: z.boolean().optional(),
};
/**
 * v1.3 Phase 2: a saved registration template (settings key `registration_templates`). Resources are kept by name because
 * resource IDs differ per character; applying a template looks the name up in the current character's resources.
 */
export const registrationTemplateSchema = z.strictObject({
  id: idSchema, name: z.string().trim().min(1).max(40),
  card: z.strictObject({
    ...cardMetadata,
    ownedResources: ownedResourcesSchema.optional(),
    kind: kindSchema, spellLevel: z.number().int().min(0).max(9).optional(),
    roles: z.array(roleSchema).max(8), actions: z.array(actionSchema).max(6),
    range: z.strictObject({ kind: rangeSchema, feet: z.number().int().min(0).max(100000).optional() }),
    tags: z.array(idSchema).max(100),
  }),
  rule: z.strictObject({
    kind: z.enum(['unconfigured', 'none', 'slots', 'uses', 'points']), scope: z.enum(['shared', 'character']),
    family: z.enum(['standard', 'pact']), homebrew: z.boolean(), belowBase: z.boolean(),
    allowUpcast: z.boolean().optional(),
    minLevel: z.number().int().min(1).max(9).optional(), maxLevel: z.number().int().min(1).max(9).optional(),
    resourceName: z.string().trim().min(1).max(60).optional(),
    resourceKey: resourceMatchKeySchema.optional(),
    amount: z.number().int().min(0).max(1000000), variable: z.boolean(),
    min: z.number().int().min(0).max(1000000), max: z.number().int().min(0).max(1000000), step: z.number().int().min(1).max(1000000),
  }),
  addToDeck: z.boolean(),
});
export type RegistrationTemplate = z.infer<typeof registrationTemplateSchema>;
export const registrationTemplatesSchema = z.array(registrationTemplateSchema).max(20)
  .refine(list => new Set(list.map(item => item.id)).size === list.length, '템플릿 ID가 중복됩니다.')
  .refine(list => new Set(list.map(item => item.name.trim().normalize('NFKC').toLocaleLowerCase('ko'))).size === list.length, '같은 이름의 템플릿이 있습니다.');
export const settingsSchema = z.strictObject({
  viewMode: z.enum(['hand', 'grid']),
  reducedMotion: z.boolean(),
  resourcePanelCollapsed: z.boolean(),
  resourceViews: z.record(z.string().min(1).max(128), resourceDisplaySchema).refine(value => Object.keys(value).length <= 200).optional(),
  appearance: appearanceSchema.optional(),
  historyViews: z.record(z.string().min(1).max(128), historyViewSchema).refine(value => Object.keys(value).length <= 200).optional(),
  effects: effectsSchema.optional(),
  slotColors: z.record(z.string().min(1).max(128), slotColorSetSchema).refine(value => Object.keys(value).length <= 200).optional(),
  handScroll: handScrollSchema.optional(),
  registrationTemplates: registrationTemplatesSchema.optional(),
  // v1.3 (memo 3): per-character “USED pile cleared through” mark, display only (key `used_view`).
  usedViews: z.record(z.string().min(1).max(128), historyViewSchema).refine(value => Object.keys(value).length <= 200).optional(),
});
export type Settings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: Settings = { viewMode: 'hand', reducedMotion: false, resourcePanelCollapsed: false };

const costKeySchema = z.string().min(1);
const reconnectSchema = z.enum(['unknown', 'counter', 'generic', 'standard', 'pact']);
export const costSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('fixed'), costKey: costKeySchema, amount: z.number().int().nonnegative(), slotLevel: z.number().int().min(1).max(9).optional(), requirement: resourceRequirementSchema.optional(), reconnect: reconnectSchema.optional() }),
  z.strictObject({ type: z.literal('slot'), costKey: costKeySchema, slotSelection: z.enum(['standard', 'pact', 'generic']), autoBind: z.boolean().optional(), requirement: resourceRequirementSchema.optional(), reconnect: reconnectSchema.optional() }),
  z.strictObject({ type: z.literal('variable'), costKey: costKeySchema, min: z.number().int().nonnegative(), max: z.number().int().nonnegative(), step: z.number().int().positive(), slotLevel: z.number().int().min(1).max(9).optional(), requirement: resourceRequirementSchema.optional(), reconnect: reconnectSchema.optional() }).refine(v => v.min <= v.max),
]).superRefine((cost, ctx) => {
  if (!cost.requirement) return;
  const kind = cost.type === 'slot' || cost.slotLevel !== undefined ? 'track' : 'counter';
  if (cost.requirement.kind !== kind || cost.type === 'slot' && cost.requirement.slotKind && cost.requirement.slotKind !== cost.slotSelection) {
    ctx.addIssue({ code: 'custom', message: '요구 자원 종류와 슬롯 레벨을 확인해 주세요.' });
  }
});
const castingSchema = z.strictObject({
  mode: z.enum(['standard', 'pact', 'homebrew']), allowUpcast: z.boolean().default(true), allowBelowBase: z.boolean().default(false),
  minSlotLevel: z.number().int().min(1).max(9).optional(), maxSlotLevel: z.number().int().min(1).max(9).optional(),
}).refine(v => !v.allowBelowBase || v.mode === 'homebrew', '다운캐스팅은 홈브루 옵션에만 허용됩니다.')
  .refine(v => v.minSlotLevel === undefined || v.maxSlotLevel === undefined || v.minSlotLevel <= v.maxSlotLevel);
export const cardSchema = z.strictObject({
  ...cardMetadata,
  imageReference: deckImageReferenceSchema.optional(),
  ownedResources: ownedResourcesSchema.optional(),
  id: z.string().min(1), name: z.string().min(1), imageAssetId: z.string().min(1).optional(),
  kind: kindSchema,
  roles: z.array(roleSchema),
  actions: z.array(actionSchema),
  range: z.strictObject({ kind: z.enum(['self', 'touch', 'melee', 'ranged', 'special']), feet: z.number().nonnegative().optional() }),
  tags: z.array(z.string().min(1)), description: z.string().optional(), spellLevel: z.number().int().min(0).max(9).optional(),
  castOptions: z.array(z.strictObject({ id: z.string().min(1), label: z.string().min(1), costs: z.array(costSchema), casting: castingSchema.optional(), ritual: z.boolean().optional() })).min(1)
    .refine(options => options.some(option => !option.ritual), '일반 사용 방식이 한 가지 이상 필요합니다.'),
  costStatus: z.enum(['unconfigured', 'configured']).optional(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).refine(v => v.spellLevel === undefined || v.kind === 'spell');
export type CardDefinition = z.infer<typeof cardSchema>;
export type Role = CardDefinition['roles'][number];
export type CastOption = CardDefinition['castOptions'][number];

export const cardDraftSchema = z.strictObject({
  ...cardMetadata,
  ownedResources: ownedResourcesSchema.optional(),
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
  // v1.2: counters filled in during registration. Bindings name them by draftId; the registration
  // transaction creates them (create_resource) and rewires the bindings. The template is checked
  // with templateDraftSchema in the main process (it lives in resources.ts, which imports this file).
  newResources: z.array(z.strictObject({ draftId: idSchema, template: z.record(z.string(), z.unknown()) })).max(4).optional(),
});
export type InitialRules = z.infer<typeof initialRulesSchema>;
// v1.3: `addToDeck: false` registers into the library only while still checking `registrationTarget` (the deck the form showed).
export const saveCardsSchema = z.strictObject({ cards: z.array(cardDraftSchema).min(1).max(100), registrationTarget: registrationTargetSchema.nullable().optional(), addToDeck: z.boolean().optional(), initialRules: initialRulesSchema.optional() });
export const libraryStateSchema = z.strictObject({
  concentration: z.boolean().optional(), ritual: z.boolean().optional(),
  query: z.string().max(200), roles: z.array(roleSchema).max(8), actions: z.array(actionSchema).max(6),
  kinds: z.array(kindSchema).max(6), ranges: z.array(rangeSchema).max(5), tagIds: z.array(idSchema).max(100),
  viewScope: z.enum(['library', 'deck']), activeCharacterId: idSchema.optional(),
});
export type LibraryState = z.infer<typeof libraryStateSchema>;
export const DEFAULT_LIBRARY_STATE: LibraryState = { query: '', roles: [], actions: [], kinds: [], ranges: [], tagIds: [], viewScope: 'library' };
export const tagMutationSchema = z.strictObject({ id: idSchema.optional(), name: z.string().trim().min(1).max(60) });
export interface Tag { id: string; name: string; usageCount: number }
/** v1.3 Phase 2: `sha256` and `duplicates` (existing cards that already use the same image, trash included) warn about re-imports. */
export interface AssetPreview { id: string; name: string; url: string; thumbnailUrl: string; width: number; height: number; sha256?: string; duplicates?: { name: string; trashed: boolean }[] }
export interface ImportBatch { assets: AssetPreview[]; errors: { name: string; message: string }[] }
export interface ProfileSummary { id: string; name: string; activeDeckId?: string; classId?: string; level?: number; ruleset?: 'dnd5e_2014'|'homebrew' }
export interface Deck { id: string; characterId: string; name: string; cardIds: string[] }
export const createProfileSchema = z.strictObject({ name: z.string().trim().min(1).max(100) });
export const createDeckSchema = z.strictObject({ characterId: idSchema, name: z.string().trim().min(1).max(100) });
export const selectDeckSchema = z.strictObject({ characterId: idSchema, deckId: idSchema });
export const deckCardsSchema = z.strictObject({ deckId: idSchema, cardIds: z.array(idSchema).max(5000) });
export const importPathsSchema = z.array(z.string().min(1).max(32767)).min(1).max(100);
/** v1.3: images picked in a registration that was cancelled or removed from its list (see AssetService.takeSessionImports). */
export const discardImportsSchema = z.array(idSchema).max(200);
/** v1.3 (memo 1): which images have see-through pixels (main process, sharp stats on the thumbnail). */
export const assetAlphaSchema = z.array(idSchema).min(1).max(500);

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
export interface DesktopBridge extends ResourceBridge, EditBridge, TrashBridge, BackupBridge, DeckExchangeBridge {
  getBootstrap(): Promise<Result<Bootstrap>>;
  saveSettings(settings: Settings): Promise<Result<Settings>>;
  saveLibraryState(state: LibraryState): Promise<Result<LibraryState>>;
  importImages(files: File[]): Promise<Result<ImportBatch>>;
  discardImports(assetIds: string[]): Promise<Result<{ discarded: number }>>;
  assetAlpha(assetIds: string[]): Promise<Result<Record<string, boolean>>>;
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
  importImages: 'assets:import', discardImports: 'assets:discard', assetAlpha: 'assets:alpha', saveCards: 'cards:save', archiveCard: 'cards:archive', saveTag: 'tags:save', deleteTag: 'tags:delete',
  createProfile: 'profiles:create', createDeck: 'decks:create', selectDeck: 'decks:select', setDeckCards: 'decks:cards',
  previewClass: 'classes:preview', getResources: 'resources:get', previewResource: 'resources:preview', changeResource: 'resources:change',
  exportDeck: 'deck-exchange:export', inspectDeck: 'deck-exchange:inspect', importDeck: 'deck-exchange:import',
  exportBackup: 'backup:export', inspectBackup: 'backup:inspect', applyBackup: 'backup:apply', discardBackup: 'backup:discard', getBackupStatus: 'backup:status',
} as const;
