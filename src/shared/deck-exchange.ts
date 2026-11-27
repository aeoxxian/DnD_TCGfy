import { z } from 'zod';
import { cardDraftSchema, cardSchema, deckImageReferenceSchema, idSchema, type Library, type Result } from './contracts';
import { normalizeText } from './library';

export const DECK_FORMAT = 'dnd-tcg-fy-deck';
export const DECK_VERSION = 1;
export const MAX_DECK_BYTES = 16 * 1024 * 1024;
const alias = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/i);
const named = (length: number) => z.string().min(1).max(length).refine(value => !!value.trim());
const unique = (values: string[]) => new Set(values).size === values.length;
const casts = cardSchema.shape.castOptions.max(12).refine(options =>
  unique(options.map(option => option.id)) && options.reduce((sum, option) => sum + option.costs.length, 0) <= 100
  && options.every(option => option.id.length <= 128 && option.label.length <= 100
    && option.costs.every(cost => cost.costKey.length <= 128)));
const cardFields = cardDraftSchema.shape;
const portableCard = z.strictObject({
  ref: alias, name: named(200), kind: cardFields.kind, roles: cardFields.roles, actions: cardFields.actions,
  range: cardSchema.shape.range, tags: z.array(alias).max(100).refine(unique),
  description: cardFields.description, spellLevel: cardFields.spellLevel,
  imageMode: cardFields.imageMode, image: deckImageReferenceSchema.optional(),
  concentration: cardFields.concentration, ritual: cardFields.ritual, upcastEffect: cardFields.upcastEffect,
  ownedResources: cardFields.ownedResources, costStatus: cardSchema.shape.costStatus,
  castOptions: casts, characterRules: casts.optional(),
}).superRefine((card, ctx) => {
  if (card.imageMode === 'none' && card.image || card.imageMode && card.imageMode !== 'none' && !card.image) {
    ctx.addIssue({ code: 'custom', path: ['image'], message: '이미지 참조와 표시 방식이 맞지 않습니다.' });
  }
  if (card.spellLevel !== undefined && card.kind !== 'spell') ctx.addIssue({ code: 'custom', path: ['spellLevel'], message: '주문 레벨을 확인해 주세요.' });
});
export const deckDocumentSchema = z.strictObject({
  format: z.literal(DECK_FORMAT), schemaVersion: z.literal(DECK_VERSION),
  name: named(100), tags: z.array(z.strictObject({ ref: alias, name: named(60) })).max(5000), cards: z.array(portableCard).max(5000),
}).superRefine((deck, ctx) => {
  const tags = new Set(deck.tags.map(tag => tag.ref));
  if (tags.size !== deck.tags.length || !unique(deck.tags.map(tag => normalizeText(tag.name))) || !unique(deck.cards.map(card => card.ref))) {
    ctx.addIssue({ code: 'custom', message: '카드 또는 태그 참조가 중복됩니다.' });
  }
  if (deck.cards.some(card => card.tags.some(tag => !tags.has(tag)))) ctx.addIssue({ code: 'custom', message: '정의되지 않은 태그 참조가 있습니다.' });
});
export type DeckDocument = z.infer<typeof deckDocumentSchema>;
export const deckSelectionSchema = z.strictObject({ deckId: idSchema });
export const deckTargetSchema = z.strictObject({ characterId: idSchema, deckId: idSchema.optional() });
export const deckApplySchema = deckTargetSchema.extend({ token: z.uuid() });

export interface DeckNotice { card: string; kind: 'image' | 'reconnect'; detail: string }
export interface DeckPreview {
  token: string; characterName: string; name: string; cards: string[]; notices: DeckNotice[];
  existing: boolean; duplicateCardNames: number; renamed: boolean;
  append?: { added: string[]; duplicates: string[]; conflicts: { card: string; detail: string }[] };
}
export interface DeckImportResult { library: Library; name: string; deckId: string; replayed: boolean; notices: DeckNotice[]; added?: number }
type Canceled = { canceled: true };
export interface DeckExchangeBridge {
  exportDeck(input: z.infer<typeof deckSelectionSchema>): Promise<Result<Canceled | { path: string; cards: number; notices: DeckNotice[] }>>;
  inspectDeck(input: z.infer<typeof deckTargetSchema>): Promise<Result<Canceled | DeckPreview>>;
  importDeck(input: z.infer<typeof deckApplySchema>): Promise<Result<DeckImportResult>>;
}
