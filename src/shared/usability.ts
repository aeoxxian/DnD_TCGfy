/**
 * Whether the active character can use a card right now. `unknown` means there is no character to judge against.
 * Cost-not-set, short of resources and unlinked cost stay distinct; all three count as "unusable" on the board.
 */
export type CardUsability = 'usable' | 'unconfigured' | 'insufficient' | 'unbound' | 'unknown';
export const USABILITY_NOTES: Record<CardUsability, string> = { usable: '', unknown: '', unconfigured: '비용 미설정', insufficient: '자원 부족', unbound: '비용 연결 확인' };
export function isUnusable(state: CardUsability): boolean { return state === 'unconfigured' || state === 'insufficient' || state === 'unbound'; }
