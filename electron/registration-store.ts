import { castingLevels } from '../src/shared/casting';
import { createHash, randomUUID } from 'node:crypto';
import { saveCardsSchema } from '../src/shared/contracts';
import { transaction } from './migrations';
import { UserInputError } from './errors';
import type { AppStore } from './store';
import { LibraryStore } from './library-store';
import { ResourceStore } from './resource-store';

/** Compose existing writers in one transaction. Never accepts existing card IDs. */
export class RegistrationStore {
  constructor(private store: AppStore, private library: LibraryStore, private resources: ResourceStore) {}
  save(input: unknown) {
    const parsed = saveCardsSchema.parse(input);
    const { initialRules: rules, ...cardsInput } = parsed;
    if (!rules) return this.library.saveCards(cardsInput);
    if (parsed.cards.some(card => card.id)) throw new UserInputError('초기 사용 규칙은 새 카드 등록에만 적용할 수 있습니다. 기존 카드는 독립 편집을 사용하세요.');
    // A resource refresh is not a new registration intent. Receipts must still
    // match after a committed response was lost and the client refreshed state.
    const intentRules = { ...rules, expectedRevision: undefined };
    const fingerprint = createHash('sha256').update(JSON.stringify({ ...parsed, initialRules: intentRules })).digest('hex');
    const receiptKey = `registration:${rules.requestId}`;
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
      for (const draft of parsed.cards) for (const option of rules.castOptions) {
        if(option.casting || option.costs.some(cost=>cost.type==='slot')) {
          try { castingLevels({...draft,id:'registration',castOptions:rules.castOptions,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},option); }
          catch(error) { throw new UserInputError((error as Error).message); }
        }
      }
      for (const option of rules.castOptions) for (const cost of option.costs) {
        if (cost.type === 'slot' && parsed.cards.some(card => card.kind !== 'spell' || card.spellLevel === undefined)) throw new UserInputError('슬롯을 사용할 카드의 유형과 기본 주문 레벨을 지정해 주세요.');
        if (!(cost.type === 'slot' && (cost.autoBind || parsed.cards.every(card=>card.spellLevel===0))) && !rules.bindings.some(binding => binding.costKey === cost.costKey)) throw new UserInputError('사용할 자원을 연결해 주세요.');
      }
      const before = new Set(this.library.getLibrary().cards.map(card => card.id));
      const library = this.library.saveCards(cardsInput, true);
      const created = library.cards.filter(card => !before.has(card.id));
      if (created.length !== parsed.cards.length) throw new UserInputError('등록 카드 수가 일치하지 않습니다.');
      for (const card of created) {
        this.store.db.prepare("UPDATE card_definitions SET attributes_json=json_set(attributes_json,'$.costStatus','unconfigured') WHERE id=?").run(card.id);
        if (!rules.configured) continue;
        if (rules.characterId) {
          const current = this.resources.snapshot(rules.characterId);
          for (const binding of rules.bindings) {
            const resource = current.resources.find(resource => resource.id === binding.resourceInstanceId);
            if (!resource) throw new UserInputError('현재 캐릭터의 활성 자원만 연결할 수 있습니다.');
            for (const option of rules.castOptions) for (const cost of option.costs.filter(cost => cost.costKey === binding.costKey)) {
              if (cost.type === 'slot' && (resource.kind !== 'slot_track' || resource.template.slotKind !== cost.slotSelection)) throw new UserInputError('슬롯 계열과 연결 자원이 다릅니다.');
              if (cost.type !== 'slot' && resource.kind === 'slot_track' && (cost.slotLevel === undefined || resource.capacityByLevel?.[String(cost.slotLevel)] === undefined)) throw new UserInputError('사용할 자원 단계를 확인해 주세요.');
            }
          }
          this.resources.change({ requestId: randomUUID(), characterId: rules.characterId, expectedRevision: current.revision, action: { type: 'save_costs', scope: rules.scope, cardId: card.id, castOptions: rules.castOptions, bindings: rules.bindings } }, true, true);
        } else {
          if (rules.bindings.length || rules.castOptions.some(option => option.costs.some(cost => cost.type !== 'slot' || !cost.autoBind && card.spellLevel !== 0))) throw new UserInputError('횟수·포인트 연결에는 캐릭터가 필요합니다.');
          this.store.db.prepare("UPDATE card_definitions SET attributes_json=json_set(attributes_json,'$.castOptions',json(?),'$.costStatus','configured') WHERE id=?").run(JSON.stringify(rules.castOptions), card.id);
        }
      }
      this.store.db.prepare('INSERT INTO settings(key,value_json) VALUES (?,?)').run(receiptKey, JSON.stringify({ fingerprint, cardIds: created.map(card => card.id) }));
      return this.library.getLibrary();
    });
  }
}
