import type { SlotColor, SlotColorSet } from './contracts';

export type SlotFamily = 'standard' | 'pact';
export const SLOT_FAMILY_NAMES: Record<SlotFamily, string> = { standard: '일반 주문 슬롯', pact: '계약 마법 슬롯' };
/** Same sapphire as the bundled gem image, so an unchanged character looks exactly as before. */
export const DEFAULT_SLOT_COLOR = '#4d62ad';
export const PARCHMENT = '#e9e1cf';
/** Gem palette. Every colour keeps at least 3:1 contrast on the parchment ledger (checked in tests). */
export const SLOT_PALETTE: { name: string; hex: string }[] = [
  { name: '사파이어', hex: DEFAULT_SLOT_COLOR }, { name: '루비', hex: '#a3283a' }, { name: '에메랄드', hex: '#2f7d4f' }, { name: '자수정', hex: '#7547a3' },
  { name: '황옥', hex: '#946010' }, { name: '청록석', hex: '#1d7880' }, { name: '장미석', hex: '#a8406a' }, { name: '흑요석', hex: '#2b2b33' },
];

export function slotColor(set: SlotColorSet | undefined, family: SlotFamily, level?: number): string {
  const entry = set?.[family];
  return (level !== undefined ? entry?.levels?.[String(level) as keyof NonNullable<SlotColor['levels']>] : undefined) ?? entry?.base ?? DEFAULT_SLOT_COLOR;
}
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** Below 3:1 on parchment a filled gem gets a dark rim so it still reads apart from an empty socket. */
export const lowContrast = (hex: string) => contrastRatio(hex, PARCHMENT) < 3;
/** Drops empty entries so "restore defaults" leaves nothing behind. */
export function tidySlotColors(set: SlotColorSet): SlotColorSet | undefined {
  const out: SlotColorSet = {};
  for (const family of ['standard', 'pact'] as const) {
    const entry = set[family]; if (!entry) continue;
    const levels = entry.levels && Object.keys(entry.levels).length ? entry.levels : undefined;
    if (entry.base || levels) out[family] = { ...(entry.base ? { base: entry.base } : {}), ...(levels ? { levels } : {}) };
  }
  return Object.keys(out).length ? out : undefined;
}
