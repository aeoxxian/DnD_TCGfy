/**
 * Whether the active character can use a card right now. `unknown` means there is no character to judge against.
 * Cost-not-set, short of resources and unlinked cost stay distinct; all three count as "unusable" on the board.
 */
export type CardUsability = 'usable' | 'unconfigured' | 'insufficient' | 'unbound' | 'missing' | 'level' | 'unknown';
export const USABILITY_NOTES: Record<CardUsability, string> = { usable: '', unknown: '', unconfigured: '비용 미설정', insufficient: '자원 부족', unbound: '비용 연결 확인', missing: '자원 미보유', level: '필요 슬롯 레벨 없음' };
export function isUnusable(state: CardUsability): boolean { return state !== 'usable' && state !== 'unknown'; }
