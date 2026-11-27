import { cardDraftSchema, type AssetPreview, type CardDefinition, type CardDraft, type CastOption, type InitialRules, type RegistrationTarget, type RegistrationTemplate, type Tag } from './contracts';
import { buildBasicRule, type BasicRuleDraft } from './use-rules';
import { bindableCounters, sameResourceName, type NewResourceDraft } from './resource-drafts';
import type { ResourceView } from './resources';

/**
 * v1.3 Phase 2: registering several images at once. Every card is saved through the existing registration transaction
 * on its own, so one failure never undoes another card. Pure helpers here; the dialog drives the run.
 */
export type BatchRuleKind = 'unconfigured' | 'none' | 'slots' | 'uses' | 'points';
export const BATCH_RULE_NAMES: Record<BatchRuleKind, string> = { unconfigured: '나중에 설정', none: '무소모', slots: '주문 슬롯', uses: '사용 횟수', points: '포인트 자원' };
export interface BatchRule { kind: BatchRuleKind; draft: BasicRuleDraft; scope: 'shared' | 'character' }
export type CardFields = Pick<CardDraft, 'kind' | 'spellLevel' | 'roles' | 'actions' | 'range' | 'tags' | 'imageMode' | 'concentration' | 'ritual' | 'upcastEffect' | 'ownedResources'>;
export type BatchAsset = AssetPreview | { id: string; name: string; thumbnailUrl?: undefined; sha256?: undefined; duplicates?: undefined };
/** The defaults every card follows unless it is set on its own. */
export interface BatchCommon { card: CardFields; rule: BatchRule; addToDeck: boolean }
/** ready → saving → saved | failed; `pending` = 미처리 (left after a stop). */
export type BatchStatus = 'ready' | 'saving' | 'saved' | 'failed' | 'pending';
export interface BatchItem {
  assetId: string; include: boolean; imageless?: boolean;
  /** Per-card values; undefined = follow the common default. */
  card?: CardFields; rule?: BatchRule; addToDeck?: boolean; description?: string;
  status: BatchStatus; error?: string; cardId?: string;
  /** Stable while the request is the same, so a retry after a lost response hits the registration receipt. */
  attempt?: { signature: string; requestId: string };
  ids: { optionId: string; costKey: string };
}
export interface EffectiveItem { card: CardDraft; rule: BatchRule; addToDeck: boolean; custom: { card: boolean; rule: boolean; deck: boolean } }

export function newBatchItem(asset: BatchAsset, include = true, uuid: () => string = () => crypto.randomUUID()): BatchItem {
  return { assetId: asset.id, include, ...(asset.thumbnailUrl === undefined ? { imageless: true } : {}), status: 'ready', ids: { optionId: uuid(), costKey: uuid() } };
}
export function cardFields(draft: CardFields): CardFields {
  const { kind, spellLevel, roles, actions, range, tags, imageMode, concentration, ritual, upcastEffect, ownedResources } = draft;
  return { kind, spellLevel: kind === 'spell' ? spellLevel : undefined, roles: [...roles], actions: [...actions], range: { ...range }, tags: [...tags],
    ...(imageMode === undefined ? {} : { imageMode }), ...(concentration === undefined ? {} : { concentration }),
    ...(ritual === undefined ? {} : { ritual }), ...(upcastEffect === undefined ? {} : { upcastEffect }), ...(ownedResources === undefined ? {} : { ownedResources }) };
}
export function effectiveItem(item: BatchItem, name: string, common: BatchCommon): EffectiveItem {
  const fields = item.card ?? common.card;
  const card: CardDraft = { ...cardFields(fields), name: name.trim(), ...(item.imageless || fields.imageMode === 'none' ? { imageMode: 'none' } : { imageAssetId: item.assetId }), ...(item.description?.trim() ? { description: item.description } : {}) };
  if (card.spellLevel === undefined) delete card.spellLevel;
  return { card, rule: item.rule ?? common.rule, addToDeck: item.addToDeck ?? common.addToDeck,
    custom: { card: !!item.card, rule: !!item.rule, deck: item.addToDeck !== undefined && item.addToDeck !== common.addToDeck } };
}
/** The cost rule of one card (cast options + bindings), or an error message the list shows as “확인 필요”. */
export function itemRule(effective: EffectiveItem, ids: BatchItem['ids']): { configured: boolean; castOptions: CastOption[]; bindings: { costKey: string; resourceInstanceId: string }[] } {
  if (effective.rule.kind === 'unconfigured') return { configured: false, castOptions: [{ id: ids.optionId, label: '비용 미설정', costs: [] }], bindings: [] };
  const now = new Date(0).toISOString();
  const card: CardDefinition = { ...effective.card, id: 'batch-draft', castOptions: [{ id: ids.optionId, label: '일반 사용', costs: [] }], createdAt: now, updatedAt: now };
  const built = buildBasicRule(card, { ...effective.rule.draft, kind: effective.rule.kind, spellLevel: effective.card.spellLevel }, ids);
  return { configured: true, castOptions: built.castOptions, bindings: built.bindings };
}
/** What stops a card from being registered, in the words the list shows. */
export function itemProblem(effective: EffectiveItem, ids: BatchItem['ids'], ctx: { characterId?: string } = {}): string | undefined {
  const parsed = cardDraftSchema.safeParse(effective.card);
  if (!parsed.success) return parsed.error.issues[0].message;
  if (effective.rule.scope === 'character' && effective.rule.kind !== 'unconfigured' && !ctx.characterId) return '캐릭터 전용 규칙에는 캐릭터가 필요합니다.';
  try {
    if (itemRule(effective, ids).bindings.length && !ctx.characterId) return '횟수·포인트 연결에는 캐릭터가 필요합니다.';
  } catch (error) { return (error as Error).message; }
  return undefined;
}

export interface BatchRequestContext {
  target: RegistrationTarget | null; characterId?: string; revision?: number;
  /** A resource drafted in the common rule: sent with the first card that uses it, then replaced by the created ID. */
  draft?: NewResourceDraft; createdDraftId?: string;
}
/** The `saveCards` input for one card, without the request ID (see `attempt`). */
export function itemRequest(effective: EffectiveItem, ids: BatchItem['ids'], ctx: BatchRequestContext) {
  const rule = itemRule(effective, ids);
  const usesDraft = !!ctx.draft && rule.bindings.some(binding => binding.resourceInstanceId === ctx.draft!.draftId);
  const bindings = usesDraft && ctx.createdDraftId ? rule.bindings.map(binding => binding.resourceInstanceId === ctx.draft!.draftId ? { ...binding, resourceInstanceId: ctx.createdDraftId! } : binding) : rule.bindings;
  const initialRules: Omit<InitialRules, 'requestId'> = {
    configured: rule.configured, scope: effective.rule.scope === 'character' && !ctx.characterId ? 'shared' : effective.rule.scope, characterId: ctx.characterId,
    expectedRevision: rule.configured && ctx.characterId ? ctx.revision : undefined,
    castOptions: rule.castOptions, bindings, ...(usesDraft && !ctx.createdDraftId ? { newResources: [ctx.draft!] } : {}),
  };
  const addToDeck = ctx.target && !effective.addToDeck ? false : undefined;
  return { cards: [effective.card], registrationTarget: ctx.target, ...(addToDeck === false ? { addToDeck } : {}), initialRules, createsDraft: usesDraft && !ctx.createdDraftId };
}
/** The request ID for a request: kept while nothing changed (so a re-send hits the receipt), new when it changed. */
export function attemptFor(item: BatchItem, request: ReturnType<typeof itemRequest>, uuid: () => string = () => crypto.randomUUID()): { signature: string; requestId: string } {
  const { initialRules, ...rest } = request;
  const signature = JSON.stringify({ ...rest, initialRules: { ...initialRules, expectedRevision: undefined } });
  return item.attempt?.signature === signature ? item.attempt : { signature, requestId: uuid() };
}

/** Same image twice in one batch: later copies are flagged (and excluded by default). Existing cards come from the import. */
export function batchDuplicates(assets: BatchAsset[]): Map<string, { existing: string[]; trashed: boolean; repeatOf?: string }> {
  const seen = new Map<string, BatchAsset>(); const out = new Map<string, { existing: string[]; trashed: boolean; repeatOf?: string }>();
  for (const asset of assets) {
    const first = asset.sha256 ? seen.get(asset.sha256) : undefined;
    if (asset.sha256 && !first) seen.set(asset.sha256, asset);
    if (first || asset.duplicates?.length) out.set(asset.id, { existing: asset.duplicates?.map(item => item.name) ?? [], trashed: !!asset.duplicates?.some(item => item.trashed), ...(first ? { repeatOf: first.name } : {}) });
  }
  return out;
}

export interface BatchSummary {
  included: number; excluded: number; problems: number; custom: number; toDeck: number; libraryOnly: number;
  rules: Record<BatchRuleKind, number>; duplicates: number; createsResource: boolean;
  saved: number; failed: number; pending: number;
}
export function summarizeBatch(items: BatchItem[], names: Record<string, string>, common: BatchCommon, ctx: { target: RegistrationTarget | null; characterId?: string; draft?: NewResourceDraft; duplicates: Map<string, unknown> }): BatchSummary {
  const summary: BatchSummary = { included: 0, excluded: 0, problems: 0, custom: 0, toDeck: 0, libraryOnly: 0, rules: { unconfigured: 0, none: 0, slots: 0, uses: 0, points: 0 }, duplicates: 0, createsResource: false, saved: 0, failed: 0, pending: 0 };
  for (const item of items) {
    if (item.status === 'saved') summary.saved++;
    if (!item.include) { summary.excluded++; continue; }
    if (item.status === 'failed') summary.failed++;
    if (item.status === 'pending') summary.pending++;
    if (item.status === 'saved') continue;
    summary.included++;
    const effective = effectiveItem(item, names[item.assetId] ?? '', common);
    if (itemProblem(effective, item.ids, ctx)) summary.problems++;
    if (effective.custom.card || effective.custom.rule || effective.custom.deck || item.description?.trim()) summary.custom++;
    if (ctx.target && effective.addToDeck) summary.toDeck++; else summary.libraryOnly++;
    summary.rules[effective.rule.kind]++;
    if (ctx.duplicates.has(item.assetId)) summary.duplicates++;
    if (ctx.draft && effective.rule.draft.resourceId === ctx.draft.draftId && (effective.rule.kind === 'uses' || effective.rule.kind === 'points')) summary.createsResource = true;
  }
  return summary;
}

// ---- registration templates --------------------------------------------------------------------------------------
export function templateFrom(id: string, name: string, common: BatchCommon, resources: ResourceView[]): RegistrationTemplate {
  const rule = common.rule; const draft = rule.draft;
  const resource = resources.find(item => item.id === draft.resourceId);
  return {
    id, name: name.trim(),
    card: cardFields(common.card),
    rule: { kind: rule.kind, scope: rule.scope, family: draft.family, homebrew: draft.homebrew, belowBase: draft.belowBase,
      ...(draft.minLevel !== undefined ? { minLevel: draft.minLevel } : {}), ...(draft.maxLevel !== undefined ? { maxLevel: draft.maxLevel } : {}),
      ...((rule.kind === 'uses' || rule.kind === 'points') && draft.resourceKey?.trim() ? { resourceKey: draft.resourceKey.trim() } : {}),
      ...((rule.kind === 'uses' || rule.kind === 'points') && resource ? { resourceName: resource.name } : {}),
      amount: draft.amount, variable: draft.variable, min: draft.min, max: draft.max, step: draft.step,
      ...(draft.allowUpcast === undefined ? {} : { allowUpcast: draft.allowUpcast }) },
    addToDeck: common.addToDeck,
  };
}
/** Fill the common settings from a template. Missing tags and resources are left out and reported. */
export function applyTemplate(template: RegistrationTemplate, ctx: { tags: Tag[]; resources: ResourceView[]; characterId?: string; base: BasicRuleDraft }): { common: BatchCommon; notes: string[] } {
  const notes: string[] = [];
  const tags = template.card.tags.filter(id => ctx.tags.some(tag => tag.id === id));
  if (tags.length < template.card.tags.length) notes.push(`지워진 태그 ${template.card.tags.length - tags.length}개는 빼고 적용했습니다.`);
  const t = template.rule;
  let resourceId = '';
  if ((t.kind === 'uses' || t.kind === 'points') && t.resourceName) {
    const matches = bindableCounters(ctx.resources).filter(resource => sameResourceName(resource.name, t.resourceName!));
    if (matches.length === 1) resourceId = matches[0].id;
    else {
      const issue = matches.length ? `템플릿의 자원 ‘${t.resourceName}’과 이름이 같은 자원이 여러 개 있습니다.`
        : `템플릿의 자원 ‘${t.resourceName}’을(를) 이 캐릭터에서 찾지 못했습니다.`;
      const next = t.resourceKey ? '사용할 자원을 직접 고르거나 식별 키로 연결할지 확인해 주세요.' : '사용할 자원을 직접 골라 주세요.';
      notes.push(`${issue} ${next}`);
    }
  }
  let scope = t.scope;
  if (scope === 'character' && !ctx.characterId) { scope = 'shared'; notes.push('캐릭터를 고르지 않아 규칙 적용 범위를 공통으로 바꿨습니다.'); }
  const card: CardFields = { ...cardFields(template.card), imageMode: template.card.imageMode, concentration: template.card.concentration ?? false,
    ritual: template.card.ritual ?? false, upcastEffect: template.card.upcastEffect ?? false, ownedResources: template.card.ownedResources, tags };
  return {
    common: {
      card,
      rule: { kind: t.kind, scope, draft: { ...ctx.base, kind: t.kind === 'unconfigured' ? 'none' : t.kind, resourceId, resourceKey: t.resourceKey, amount: t.amount, variable: t.variable, min: t.min, max: t.max, step: t.step,
        family: t.family, homebrew: t.homebrew, belowBase: t.belowBase, allowUpcast: t.allowUpcast, minLevel: t.minLevel, maxLevel: t.maxLevel, spellLevel: card.spellLevel } },
      addToDeck: template.addToDeck,
    },
    notes,
  };
}
