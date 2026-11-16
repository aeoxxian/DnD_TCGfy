import { cardSchema, type CardDefinition } from './contracts';

const timestamp = '2026-11-16T00:00:00.000Z';
export const SAMPLE_CARDS: CardDefinition[] = [
  { id: 'sample-heal', name: '상처 치료', kind: 'spell', roles: ['heal'], actions: ['action'], range: { kind: 'touch' }, spellLevel: 1, tags: [], description: '치유 역할의 예시 카드입니다. 실제 효과와 비용은 등록한 카드에서 확인합니다.' },
  { id: 'sample-attack', name: '검격', kind: 'attack', roles: ['damage'], actions: ['action'], range: { kind: 'melee' }, tags: [], description: '공격 선택지를 나타내는 예시 카드입니다. 명중이나 피해를 계산하지 않습니다.' },
  { id: 'sample-utility', name: '빛', kind: 'spell', roles: ['utility'], actions: ['action'], range: { kind: 'touch' }, spellLevel: 0, tags: [], description: '유틸리티 역할의 예시 카드입니다. 카드 선택과 확대를 확인해 보세요.' },
  { id: 'sample-feature', name: '집중', kind: 'feature', roles: ['other'], actions: ['special'], range: { kind: 'self' }, tags: [], description: '특성 형태의 화면 검수용 예시입니다. 실제 D&D 규칙이나 능력 정의가 아닙니다.' },
].map(card => cardSchema.parse({ ...card, castOptions: [{ id: `${card.id}-preview`, label: '미리보기', costs: [] }], createdAt: timestamp, updatedAt: timestamp }));
