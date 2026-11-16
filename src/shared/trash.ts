import { z } from 'zod';
import { idSchema, type CardDefinition, type Result } from './contracts';
import type { ResourceEvent } from './resources';

const ids=z.array(idSchema).min(1).max(5000).refine(v=>new Set(v).size===v.length,'선택 항목이 중복됩니다.');
export const trashActionSchema=z.discriminatedUnion('type',[
  z.strictObject({type:z.literal('move'),cardIds:ids}),
  z.strictObject({type:z.literal('restore'),cardIds:ids}),
  z.strictObject({type:z.literal('purge'),cardIds:ids}),
  z.strictObject({type:z.literal('empty')}),
]);
export type TrashAction=z.infer<typeof trashActionSchema>;
export const trashCommitSchema=z.strictObject({requestId:z.uuid(),action:trashActionSchema,quote:z.string().length(64),confirmed:z.literal(true),phrase:z.string().max(100).optional()});
export interface TrashDeck {id:string;name:string;characterId:string;characterName:string;position:number}
export interface TrashCard {card:CardDefinition;deletedAt:string;decks:TrashDeck[]}
export interface TrashPreview {quote:string;count:number;names:string[];characters:string[];decks:string[];notes:string[];requiresPhrase:boolean;assetCount:number;sharedAssets:number;invalidatedBatches:number}
export interface TrashResult {count:number;cardIds:string[];type:TrashAction['type'];warnings:string[];replayed:boolean}
export interface CleanupResult {removed:number;pending:number;errors:string[]}
export interface TrashState {cards:TrashCard[];warnings:string[];pendingImages:number}
export const useHistoryInputSchema=z.strictObject({characterId:idSchema,beforeRow:z.number().int().positive().optional()});
export interface UseHistory {events:ResourceEvent[];nextRow?:number}
export interface TrashBridge {
  getTrash():Promise<Result<TrashState>>;
  previewTrash(action:TrashAction):Promise<Result<TrashPreview>>;
  changeTrash(input:z.infer<typeof trashCommitSchema>):Promise<Result<TrashResult & {cleanup?:CleanupResult}>>;
  retryImageCleanup():Promise<Result<CleanupResult>>;
  getUseHistory(input:z.infer<typeof useHistoryInputSchema>):Promise<Result<UseHistory>>;
}
