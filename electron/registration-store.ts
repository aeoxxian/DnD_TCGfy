import { castingLevels } from '../src/shared/casting';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { idSchema, saveCardsSchema } from '../src/shared/contracts';
import { templateDraftSchema } from '../src/shared/resources';
import { sameResourceName } from '../src/shared/resource-drafts';
import { transaction } from './migrations';
import { UserInputError } from './errors';
import type { AppStore } from './store';
import { LibraryStore } from './library-store';
import { ResourceStore } from './resource-store';

const newResourcesSchema = z.array(z.strictObject({ draftId: idSchema, template: templateDraftSchema })).max(4);

/** Compose existing writers in one transaction. Never accepts existing card IDs. */
export class RegistrationStore {
  constructor(private store: AppStore, private library: LibraryStore, private resources: ResourceStore) {}
  save(input: unknown) {
    const parsed = saveCardsSchema.parse(input);
    const { initialRules: rules, ...cardsInput } = parsed;
    if (!rules) return this.library.saveCards(cardsInput);
    if (parsed.libraryRules) throw new UserInputError('등록 규칙과 라이브러리 수정은 동시에 저장할 수 없습니다.');
    if (parsed.cards.some(card => card.id)) throw new UserInputError('초기 사용 규칙은 새 카드 등록에만 적용할 수 있습니다. 기존 카드는 독립 편집을 사용하세요.');
    // A resource refresh is not a new registration intent. Receipts must still
    // match after a committed response was lost and the client refreshed state.
    const intentRules = { ...rules, expectedRevision: undefined };
    const fingerprint = createHash('sha256').update(JSON.stringify({ ...parsed, initialRules: intentRules })).digest('hex');
    const receiptKey = `registration:${rules.requestId}`;
    const draftsResult = newResourcesSchema.safeParse(rules.newResources ?? []);
    if (!draftsResult.success) throw new UserInputError('새 자원 설정을 확인해 주세요.');
    const drafts = draftsResult.data;
    return transaction(this.store.db, () => {
      const receipt = this.store.db.prepare('SELECT value_json FROM settings WHERE key=?').get(receiptKey) as {value_json: string} | undefined;
      if (receipt) {
        if (JSON.parse(receipt.value_json).fingerprint !== fingerprint) throw new UserInputError('같은 등록 요청으로 다른 카드를 저장할 수 없습니다.');
        return this.library.getLibrary();
      }
      const state = this.library.getState();
      if (rules.characterId !== state.activeCharacterId) throw new UserInputError('활성 캐릭터가 바뀌었습니다. 등록 대상을 다시 확인해 주세요.');
      if (rules.scope === 'character' && !rules.characterId) throw new UserInputError('캐릭터 전용 규칙에는 캐릭터가 필요합니다.');
      if (!rules.configured && (rules.bindings.length || rules.castOptions.some(option => option.costs.length || option.casting))) throw new UserInputError('비용 미설정 등록에는 비용을 함께 저장할 수 없습니다.');
      if (new Set(rules.castOptions.map(option => option.id)).size !== rules.castOptions.length) throw new UserInputError('사용 방식 ID가 중복됩니다.');
      if (rules.configured && rules.characterId && rules.expectedRevision !== this.resources.snapshot(rules.characterId).revision) throw new UserInputError('자원 구성이 바뀌었습니다. 자원을 다시 불러와 확인해 주세요.');
      if (drafts.length) {
        if (!rules.configured || !rules.characterId) throw new UserInputError('새 자원은 캐릭터를 선택한 등록에서만 만들 수 있습니다.');
        if (new Set(drafts.map(draft => draft.draftId)).size !== drafts.length) throw new UserInputError('새 자원 초안이 중복됩니다.');
        const existing = this.resources.snapshot(rules.characterId).resources;
        drafts.forEach((draft, index) => {
          if (draft.template.kind !== 'counter' || draft.template.id) throw new UserInputError('카드 등록 중에는 횟수·포인트 자원만 새로 만들 수 있습니다.');
          if (existing.some(resource => resource.id === draft.draftId)) throw new UserInputError('새 자원 초안 ID가 기존 자원과 겹칩니다.');
          if (!rules.bindings.some(binding => binding.resourceInstanceId === draft.draftId)) throw new UserInputError('비용에 연결하지 않은 새 자원은 만들지 않습니다.');
          const same = existing.find(resource => !resource.ownedDefinitionId && sameResourceName(resource.name, draft.template.name))?.name ?? drafts.slice(0, index).find(other => sameResourceName(other.template.name, draft.template.name))?.template.name;
          if (same) throw new UserInputError(`같은 이름의 자원 “${same}”이(가) 이미 있습니다. 기존 자원을 선택해 주세요.`);
        });
      }
      for (const draft of parsed.cards) for (const option of rules.castOptions) {
        if(option.casting || option.costs.some(cost=>cost.type==='slot')) {
          try { castingLevels(draft,option); }
          catch(error) { throw new UserInputError((error as Error).message); }
        }
      }
      for (const option of rules.castOptions) for (const cost of option.costs) {
        if (cost.type === 'slot' && parsed.cards.some(card => card.kind !== 'spell' || card.spellLevel === undefined)) throw new UserInputError('슬롯을 사용할 카드의 유형과 기본 주문 레벨을 지정해 주세요.');
        if (!cost.requirement && !(cost.type === 'slot' && (cost.autoBind || parsed.cards.every(card=>card.spellLevel===0))) && !rules.bindings.some(binding => binding.costKey === cost.costKey)) throw new UserInputError('사용할 자원을 연결해 주세요.');
      }
      const before = new Set(this.library.getLibrary().cards.map(card => card.id));
      const library = this.library.saveCards(cardsInput, true);
      const created = library.cards.filter(card => !before.has(card.id));
      if (created.length !== parsed.cards.length) throw new UserInputError('등록 카드 수가 일치하지 않습니다.');
      // New counters are created here, after the cards and inside the same transaction, with the
      // same engine path as 자원 관리 (template + character-shared instance + "자원 생성" record).
      let bindings = rules.bindings;
      if (drafts.length && rules.characterId) {
        const ids = new Map<string, string>();
        for (const draft of drafts) {
          const before = this.resources.snapshot(rules.characterId);
          const result = this.resources.change({ requestId: randomUUID(), characterId: rules.characterId, expectedRevision: before.revision, action: { type: 'create_resource', template: draft.template, scope: 'character' } }, true);
          const added = result.snapshot.resources.filter(resource => !before.resources.some(old => old.id === resource.id));
          if (added.length !== 1) throw new UserInputError('새 자원을 만들지 못했습니다.');
          ids.set(draft.draftId, added[0].id);
        }
        bindings = rules.bindings.map(binding => ({ ...binding, resourceInstanceId: ids.get(binding.resourceInstanceId) ?? binding.resourceInstanceId }));
      }
      for (const card of created) {
        this.store.db.prepare("UPDATE card_definitions SET attributes_json=json_set(attributes_json,'$.costStatus','unconfigured') WHERE id=?").run(card.id);
        if (!rules.configured) continue;
        if (rules.characterId) {
          const current = this.resources.snapshot(rules.characterId);
          for (const binding of bindings) {
            const resource = current.resources.find(resource => resource.id === binding.resourceInstanceId);
            if (!resource) throw new UserInputError('현재 캐릭터의 활성 자원만 연결할 수 있습니다.');
            for (const option of rules.castOptions) for (const cost of option.costs.filter(cost => cost.costKey === binding.costKey)) {
              if (cost.type === 'slot' && (resource.kind !== 'slot_track' || (resource.template.slotKind ?? 'generic') !== cost.slotSelection)) throw new UserInputError('슬롯 계열과 연결 자원이 다릅니다.');
              if (cost.type !== 'slot' && resource.kind === 'slot_track' && (cost.slotLevel === undefined || !cost.requirement && resource.capacityByLevel?.[String(cost.slotLevel)] === undefined)) throw new UserInputError('사용할 자원 단계를 확인해 주세요.');
            }
          }
          this.resources.change({ requestId: randomUUID(), characterId: rules.characterId, expectedRevision: current.revision, action: { type: 'save_costs', scope: rules.scope, cardId: card.id, castOptions: rules.castOptions, bindings } }, true, true);
        } else {
          if (rules.bindings.length || rules.castOptions.some(option => option.costs.some(cost => !cost.requirement && (cost.type !== 'slot' || !cost.autoBind && card.spellLevel !== 0)))) throw new UserInputError('횟수·포인트 연결에는 캐릭터가 필요합니다.');
          this.store.db.prepare("UPDATE card_definitions SET attributes_json=json_set(attributes_json,'$.castOptions',json(?),'$.costStatus','configured') WHERE id=?").run(JSON.stringify(rules.castOptions), card.id);
        }
      }
      this.store.db.prepare('INSERT INTO settings(key,value_json) VALUES (?,?)').run(receiptKey, JSON.stringify({ fingerprint, cardIds: created.map(card => card.id) }));
      return this.library.getLibrary();
    });
  }
}
