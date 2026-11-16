import { z } from 'zod';
import { idSchema, type Result } from './contracts';
import { saveCostsActionSchema } from './resources';

const ids = z.array(idSchema).min(1).max(5000).refine(v => new Set(v).size === v.length, '선택 항목이 중복됩니다.');
export const editActionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('costs'), characterId: idSchema, rules: saveCostsActionSchema, intent: z.enum(['remove_costs','remove_options','clear_costs','convert_slots']) }),
  z.strictObject({ type: z.literal('disconnect_resources'), characterId: idSchema, resourceIds: ids }),
  z.strictObject({ type: z.literal('archive_templates'), templateIds: ids }),
  z.strictObject({ type: z.literal('card_tags'), cardIds: ids, addTagIds: z.array(idSchema).max(100), removeTagIds: z.array(idSchema).max(100) }),
  z.strictObject({ type: z.literal('deck_cards'), deckId: idSchema, operation: z.enum(['add','remove']), cardIds: ids }),
  z.strictObject({ type: z.literal('restore'), batchId: idSchema }),
]);
export type EditAction = z.input<typeof editActionSchema>;
export const editCommitSchema = z.strictObject({ requestId: z.uuid(), action: editActionSchema, quote: z.string().length(64), confirmImpact: z.boolean() });
export interface EditSummary { label: string; details: string[]; characters: string[]; targets: string[]; requiresImpact: boolean }
export interface EditPreview extends EditSummary { quote: string }
export interface EditBatch extends EditSummary { id: string; createdAt: string; restoredAt?: string }
export interface EditBridge {
  previewEdit(action: EditAction): Promise<Result<EditPreview>>;
  applyEdit(input: z.input<typeof editCommitSchema>): Promise<Result<{ batchId: string; replayed: boolean }>>;
  getEditHistory(): Promise<Result<EditBatch[]>>;
}
