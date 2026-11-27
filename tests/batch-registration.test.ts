import { describe, expect, it } from 'vitest';
import { applyTemplate, attemptFor, batchDuplicates, effectiveItem, itemProblem, itemRequest, newBatchItem, summarizeBatch, templateFrom, type BatchCommon } from '../src/shared/batch-registration';
import { emptyBasicRule } from '../src/shared/use-rules';
import { registrationTemplatesSchema, type AssetPreview, type CardDefinition } from '../src/shared/contracts';
import type { ResourceView } from '../src/shared/resources';

const asset = (id: string, sha256?: string, duplicates?: AssetPreview['duplicates']): AssetPreview => ({ id, name: `file-${id}`, url: `app://assets/${id}`, thumbnailUrl: `app://assets/${id}/thumbnail`, width: 10, height: 15, sha256, duplicates });
const base = emptyBasicRule({} as CardDefinition);
const common = (patch: Partial<BatchCommon> = {}): BatchCommon => ({ card: { kind: 'other', roles: ['utility'], actions: ['action'], range: { kind: 'self' }, tags: [] }, rule: { kind: 'unconfigured', scope: 'character', draft: { ...base } }, addToDeck: true, ...patch });
let n = 0; const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const counter = (id: string, name: string): ResourceView => ({ id, characterId: 'a', templateId: `t-${id}`, name, unit: '회', kind: 'counter', capacity: 3, remaining: 3, overrides: { scope: 'character' },
  template: { id: `t-${id}`, key: `user_${id}`, name, unit: '회', kind: 'counter', capacity: { type: 'fixed', value: 3 }, recovery: [], source: 'user', version: 1 } });
const target = { characterId: 'a', deckId: 'deck-a' };

describe('v1.3 Phase 2 · batch registration helpers', () => {
  it('each card follows the common settings until it is set on its own, and says which values are its own', () => {
    const item = newBatchItem(asset('1'), true, uuid);
    const followed = effectiveItem(item, '  첫 카드 ', common());
    expect(followed.card).toEqual({ name: '첫 카드', kind: 'other', roles: ['utility'], actions: ['action'], range: { kind: 'self' }, tags: [], imageAssetId: '1' });
    expect(followed.custom).toEqual({ card: false, rule: false, deck: false });
    const own = effectiveItem({ ...item, card: { kind: 'spell', spellLevel: 2, roles: ['damage'], actions: ['bonus_action'], range: { kind: 'ranged', feet: 60 }, tags: ['t'] }, rule: { kind: 'none', scope: 'shared', draft: base }, addToDeck: false, description: '설명' }, '둘째', common());
    expect(own.card).toMatchObject({ kind: 'spell', spellLevel: 2, description: '설명', imageAssetId: '1' });
    expect(own.custom).toEqual({ card: true, rule: true, deck: true });
    // Setting the same deck value as the common one is not an exception.
    expect(effectiveItem({ ...item, addToDeck: true }, 'x', common()).custom.deck).toBe(false);
  });

  it('reports what blocks a card: empty name, slot cost on a card that is not a leveled spell, counters without a character', () => {
    const item = newBatchItem(asset('1'), true, uuid);
    expect(itemProblem(effectiveItem(item, ' ', common()), item.ids, { characterId: 'a' })).toBe('카드 이름을 입력해 주세요.');
    const slots = common({ rule: { kind: 'slots', scope: 'character', draft: { ...base } } });
    expect(itemProblem(effectiveItem(item, '주문', slots), item.ids, { characterId: 'a' })).toBe('기본 주문 레벨을 지정해 주세요.');
    expect(itemProblem(effectiveItem({ ...item, card: { kind: 'spell', spellLevel: 1, roles: [], actions: ['action'], range: { kind: 'self' }, tags: [] } }, '주문', slots), item.ids, { characterId: 'a' })).toBeUndefined();
    const uses = common({ rule: { kind: 'uses', scope: 'shared', draft: { ...base, resourceId: 'r1' } } });
    expect(itemProblem(effectiveItem(item, '횟수', uses), item.ids, {})).toBe('횟수·포인트 연결에는 캐릭터가 필요합니다.');
    expect(itemProblem(effectiveItem(item, '나중에', common()), item.ids, {})).toBeUndefined();
  });

  it('builds one registration request per card: deck link, revision, and a drafted resource created only once', () => {
    const item = newBatchItem(asset('1'), true, uuid);
    const unconfigured = itemRequest(effectiveItem(item, '카드', common({ addToDeck: false })), item.ids, { target, characterId: 'a', revision: 9 });
    expect(unconfigured).toMatchObject({ registrationTarget: target, addToDeck: false, initialRules: { configured: false, scope: 'character', characterId: 'a', castOptions: [{ costs: [] }], bindings: [] } });
    expect(unconfigured.initialRules.expectedRevision).toBeUndefined();
    const draft = { draftId: 'draft-1', template: { name: '지팡이 충전', unit: '회', kind: 'counter' as const, capacity: { type: 'fixed' as const, value: 7 }, recovery: [] } };
    const uses = effectiveItem(item, '지팡이', common({ rule: { kind: 'uses', scope: 'character', draft: { ...base, resourceId: 'draft-1', amount: 1 } } }));
    const first = itemRequest(uses, item.ids, { target, characterId: 'a', revision: 3, draft });
    expect(first.createsDraft).toBe(true); expect(first.initialRules).toMatchObject({ configured: true, expectedRevision: 3, newResources: [draft], bindings: [{ resourceInstanceId: 'draft-1' }] });
    expect(first).not.toHaveProperty('addToDeck');
    const later = itemRequest(uses, item.ids, { target, characterId: 'a', revision: 5, draft, createdDraftId: 'res-9' });
    expect(later.createsDraft).toBe(false); expect(later.initialRules).not.toHaveProperty('newResources');
    expect(later.initialRules.bindings).toEqual([{ costKey: item.ids.costKey, resourceInstanceId: 'res-9' }]);
  });

  it('keeps the request ID while the request is unchanged (revision aside), so a retry reaches the receipt', () => {
    const item = newBatchItem(asset('1'), true, uuid);
    const request = (name: string, revision: number) => itemRequest(effectiveItem(item, name, common({ rule: { kind: 'none', scope: 'character', draft: base } })), item.ids, { target, characterId: 'a', revision });
    const first = attemptFor(item, request('카드', 1), uuid);
    expect(attemptFor({ ...item, attempt: first }, request('카드', 8), uuid)).toBe(first);
    expect(attemptFor({ ...item, attempt: first }, request('바뀐 이름', 8), uuid).requestId).not.toBe(first.requestId);
  });

  it('flags repeated images in the batch and images that existing cards already use', () => {
    const map = batchDuplicates([asset('1', 'aa'), asset('2', 'bb', [{ name: '기존 카드', trashed: true }]), asset('3', 'aa'), asset('4', 'cc')]);
    expect(map.get('1')).toBeUndefined();
    expect(map.get('2')).toEqual({ existing: ['기존 카드'], trashed: true });
    expect(map.get('3')).toEqual({ existing: [], trashed: false, repeatOf: 'file-1' });
    expect(map.has('4')).toBe(false);
  });

  it('summarises the batch for the final check', () => {
    const items = [newBatchItem(asset('1'), true, uuid), { ...newBatchItem(asset('2'), true, uuid), addToDeck: false, rule: { kind: 'none' as const, scope: 'shared' as const, draft: base } }, newBatchItem(asset('3'), false, uuid), { ...newBatchItem(asset('4'), true, uuid), status: 'saved' as const }, { ...newBatchItem(asset('5'), true, uuid), status: 'failed' as const }];
    const names = { 1: '하나', 2: '둘', 3: '셋', 4: '넷', 5: '' };
    const summary = summarizeBatch(items, names, common(), { target, characterId: 'a', duplicates: new Map([['1', {}]]) });
    expect(summary).toMatchObject({ included: 3, excluded: 1, saved: 1, failed: 1, problems: 1, custom: 1, toDeck: 2, libraryOnly: 1, duplicates: 1, rules: { unconfigured: 2, none: 1 } });
  });

  it('templates store resources by name and re-find them per character; missing tags/resources are reported', () => {
    const settings = common({ card: { kind: 'spell', spellLevel: 1, roles: ['damage'], actions: ['action'], range: { kind: 'ranged', feet: 120 }, tags: ['t1', 'gone'] }, rule: { kind: 'uses', scope: 'character', draft: { ...base, resourceId: 'r-a', amount: 2 } }, addToDeck: false });
    const template = templateFrom('tpl-1', ' 화살 주문 ', settings, [counter('r-a', 'Ki Points')]);
    expect(template).toMatchObject({ id: 'tpl-1', name: '화살 주문', card: { kind: 'spell', spellLevel: 1 }, rule: { kind: 'uses', resourceName: 'Ki Points', amount: 2 }, addToDeck: false });
    expect(registrationTemplatesSchema.safeParse([template]).success).toBe(true);
    const other = applyTemplate(template, { tags: [{ id: 't1', name: '태그', usageCount: 0 }], resources: [counter('r-b', 'ki points')], characterId: 'b', base });
    expect(other.common.rule.draft.resourceId).toBe('r-b'); expect(other.common.card.tags).toEqual(['t1']); expect(other.common.addToDeck).toBe(false);
    expect(other.notes).toEqual(['지워진 태그 1개는 빼고 적용했습니다.']);
    const none = applyTemplate(template, { tags: [], resources: [], base });
    expect(none.common.rule).toMatchObject({ kind: 'uses', scope: 'shared', draft: { resourceId: '' } });
    expect(none.notes).toEqual(expect.arrayContaining([expect.stringContaining('Ki Points'), '캐릭터를 고르지 않아 규칙 적용 범위를 공통으로 바꿨습니다.']));
    expect(registrationTemplatesSchema.safeParse([template, { ...template, id: 'tpl-2', name: '화살 주문' }]).success).toBe(false);
    expect(registrationTemplatesSchema.safeParse(Array.from({ length: 21 }, (_, i) => ({ ...template, id: `t${i}`, name: `t${i}` }))).success).toBe(false);
  });

  it('round-trips the image mode, independent spell traits and fixed slot choice through templates', () => {
    const settings = common({ card: { ...common().card, kind: 'spell', spellLevel: 2, imageMode: 'illustration', concentration: true, ritual: true, upcastEffect: false },
      rule: { kind: 'slots', scope: 'shared', draft: { ...base, allowUpcast: false } } });
    const [template] = registrationTemplatesSchema.parse([templateFrom('p2-template', 'P2', settings, [])]);
    const { common: applied } = applyTemplate(template, { tags: [], resources: [], characterId: 'a', base });
    const picture = newBatchItem(asset('1'), true, uuid);
    const blank = newBatchItem({ id: 'blank', name: '기본' }, true, uuid);
    expect(effectiveItem(picture, '삽화', applied).card).toMatchObject({ imageMode: 'illustration', imageAssetId: '1', concentration: true, ritual: true, upcastEffect: false });
    expect(effectiveItem(blank, '기본', applied).card).toMatchObject({ imageMode: 'none', concentration: true, ritual: true });
    expect(itemRequest(effectiveItem(picture, '삽화', applied), picture.ids, { target, characterId: 'a' }).initialRules.castOptions[0].casting?.allowUpcast).toBe(false);
  });

  it('round-trips owned definitions and keyed requirements without guessing an ambiguous named binding', () => {
    const definition = { id: '04d673e9-c25f-43a1-80cd-a699a5026a22', name: '불꽃', unit: '회', maximum: 7, amount: 2,
      recovery: [{ triggers: ['dawn' as const], amount: { type: 'full' as const } }] };
    const original = common({
      card: { ...common().card, ownedResources: [definition] },
      rule: { kind: 'uses', scope: 'shared', draft: { ...base, resourceId: 'first', resourceKey: 'homebrew:focus', amount: 2 } },
    });
    const first = counter('first', '집중');
    const [template] = registrationTemplatesSchema.parse([templateFrom('p3', 'P3', original, [first])]);
    expect(template.rule).toMatchObject({ resourceName: '집중', resourceKey: 'homebrew:focus' });
    const ambiguous = applyTemplate(template, { tags: [], resources: [first, counter('second', '집중')], characterId: 'a', base });
    expect(ambiguous.common.rule.draft.resourceId).toBe('');
    expect(ambiguous.notes[0]).toContain('여러 개');
    const item = newBatchItem(asset('1'), true, uuid);
    const input = itemRequest(effectiveItem(item, '복사 카드', ambiguous.common), item.ids, { target, characterId: 'a' });
    expect(input.cards[0].ownedResources).toEqual([definition]);
    expect(input.initialRules.bindings).toEqual([]);
    expect(input.initialRules.castOptions[0].costs[0]).toMatchObject({ amount: 2, requirement: { key: 'homebrew:focus', kind: 'counter' } });
    const legacy = applyTemplate(templateFrom('legacy', '기본', common(), []), { tags: [], resources: [], base });
    expect({ ...original.card, ...legacy.common.card }.ownedResources).toBeUndefined();
  });
});
