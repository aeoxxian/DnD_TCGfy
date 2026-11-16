import { z } from 'zod';
import type { ResourceView } from './resources';

export const CLASS_NAMES = { barbarian:'바바리안', bard:'바드', cleric:'클레릭', druid:'드루이드', fighter:'파이터', monk:'몽크', paladin:'팔라딘', ranger:'레인저', rogue:'로그', sorcerer:'소서러', warlock:'워락', wizard:'위저드' } as const;
export type ClassId = keyof typeof CLASS_NAMES;
export const classInputSchema = z.strictObject({
  classId: z.enum([...Object.keys(CLASS_NAMES) as [ClassId,...ClassId[]], 'homebrew']),
  level: z.number().int().min(1).max(20),
  charisma: z.number().int().min(1).max(30).optional(),
  retire: z.enum(['keep','archive']).default('keep'),
});
export type ClassInput = z.input<typeof classInputSchema>;
export interface CharacterConfiguration { classId?: string; level: number; ruleset: 'dnd5e_2014'|'homebrew'; abilityScores?: Record<string,number> }
export interface ClassResourceChange { id:string; name:string; disposition:'create'|'update'|'keep'|'archive'; before?:ResourceView; after?:ResourceView }
export interface ClassPreview { revision:number; quote:string; before:CharacterConfiguration; after:CharacterConfiguration; resources:ClassResourceChange[]; warnings:string[]; requiresRetireConfirmation:boolean }
