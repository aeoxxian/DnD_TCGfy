# DnD TCG-fy — 데이터 규격 및 자원 엔진 계약

- 스키마 문서 버전: 1.0.0
- 목표: 카드/프리셋/홈브루/플레이 상태의 동일 엔진 처리
- 본 문서의 타입은 **논리 모델 예시**이며 실제 SQLite 테이블 분할은 구현자가 정규화하여 결정한다.

## 1. 도메인 엔티티

```ts
type ID = string; // immutable UUID

type CardKind = 'spell' | 'feature' | 'attack' | 'item' | 'feat' | 'other';
type Role = 'heal' | 'damage' | 'utility' | 'other';
type ActionEconomy = 'action' | 'bonus_action' | 'reaction' | 'no_action' | 'passive' | 'special';
type RangeKind = 'self' | 'touch' | 'melee' | 'ranged' | 'special';
type RecoveryTrigger = 'short_rest' | 'long_rest' | 'dawn' | 'manual';

interface CardDefinition {
  id: ID;
  name: string;
  imageAssetId?: ID;
  kind: CardKind;
  roles: Role[];
  actions: ActionEconomy[];
  range: { kind: RangeKind; feet?: number };
  tags: string[];           // namespaced/canonical tag IDs
  description?: string;
  spellLevel?: number;      // 0..9; only if kind==='spell'
  castOptions: CastOption[]; // one or more possible ways to use card
  createdAt: string;
  updatedAt: string;
}

type CostSpec =
  | { type: 'fixed'; costKey: string; amount: number } // maps through character binding
  | { type: 'slot'; costKey: string; slotSelection: 'standard' | 'pact' }
  | { type: 'variable'; costKey: string; min: number; max: number; step: number };

interface CastOption {
  id: ID;
  label: string; // 일반 사용, 강화 사용, 무소모 발동...
  costs: CostSpec[];  // empty = no consumption
  casting?: {
    mode: 'standard' | 'pact' | 'homebrew';
    allowUpcast: boolean;
    allowBelowBase: boolean; // false by default; allowed only for homebrew option
    minSlotLevel?: number;
    maxSlotLevel?: number;
  };
}

type CapacityRule =
  | { type: 'fixed'; value: number }
  | { type: 'level_table'; values: Record<string, number> }
  | { type: 'ability_modifier'; ability: 'STR'|'DEX'|'CON'|'INT'|'WIS'|'CHA'; offset: number; minimum: number; maximum?: number };

type RecoveryAmount =
  | { type: 'full' }
  | { type: 'fixed'; value: number };

interface RecoveryRule {
  triggers: RecoveryTrigger[];
  amount: RecoveryAmount;
}

interface ResourceTemplate {
  id: ID;
  key: string;         // stable logical key (e.g. pact_slots)
  name: string;
  kind: 'counter' | 'slot_track';
  unit: string;
  capacity?: CapacityRule; // counter type
  slotCapacity?: Record<string, CapacityRule>; // slot_track with fixed tier set, keys are spell levels 1..9
  slotCapacityByClassLevel?: Record<string, Record<string, number>>; // 1..20 -> {slotLevel:capacity}; for pact progression etc.
  recovery: RecoveryRule[];
  source: 'class_2014' | 'user';
  version: number;
}

interface ResourceInstance {
  id: ID;
  characterId: ID;
  templateId: ID;
  nameOverride?: string;
  remaining?: number; // counter
  remainingByLevel?: Record<string, number>; // slot_track
  capacityOverride?: number;
}

interface CharacterProfile {
  id: ID;
  name: string;
  ruleset: 'dnd5e_2014' | 'homebrew';
  classId?: string;  // PHB single class or custom
  level: number;     // 1..20
  abilityScores?: Record<'STR'|'DEX'|'CON'|'INT'|'WIS'|'CHA', number>;
  activeDeckId?: ID;
}

interface Deck { id: ID; characterId: ID; name: string; cardIds: ID[] }
interface CardBinding {
  id: ID;
  characterId: ID;
  cardId: ID;
  costKey: string;
  resourceInstanceId: ID; // must belong to same character
}

interface PlayEvent {
  id: ID;
  characterId: ID;
  type: 'card_used'|'manual_adjustment'|'recovery'|'undo'|'profile_changed';
  cardId?: ID;
  castOptionId?: ID;
  selectedSlotLevel?: number;
  changes: Array<{resourceInstanceId: ID; slotLevel?: number; before: number; after: number}>;
  timestamp: string; // ISO 8601
  undoesEventId?: ID;
}
```

## 2. 도메인 불변 조건

1. **자원 상태는 CardDefinition에 저장 금지**. CardDefinition은 모든 캐릭터가 공유 가능.
2. 모든 ID는 이름 변경과 무관하게 안정적으로 유지하며 참조 무결성을 검사한다.
3. `remaining`은 항상 정수, `0 ≤ remaining ≤ max`.
4. 자원 소비, 복수 비용 차감, 이벤트 기록은 하나의 원자적 트랜잭션.
5. `costKey`는 캐릭터의 해당 카드 사용 시 **ResourceInstance** 하나에 바인딩되어야 함. 미바인딩이면 사용 비활성화·이유 안내.
6. 소모하는 자원이 `slot_track`이면 구체적인 레벨을 기록.
7. 현재 자원 값을 템플릿의 최대치 계산 결과에서 임의로 초기화해서는 안 됨. 레벨 변경·템플릿 수정에만 명시적 재계산. `slotCapacityByClassLevel`은 클래스 레벨에 따른 슬롯 **레벨과 수량의 동시 변화**를 표현한다.
8. 짧은 휴식의 회복 대상은 `short_rest`, 긴 휴식의 회복 대상은 `long_rest` 또는 `short_rest`; 둘 다 들어 있더라도 이벤트당 **1회** 회복. 새벽은 별도 이벤트.
9. 앱 실행 시 아무 휴식도 자동 실행하지 않음.
10. undo는 가장 최근에 성공적으로 반영된 변경 이벤트 하나를 정확히 되돌려야 한다. 다른 이벤트 변경을 우연히 덮어쓰면 안 됨.
11. 다운캐스팅은 `mode: 'homebrew'`이면서 `allowBelowBase=true`인 경우만 허용.
12. `spellLevel=0`은 슬롯 선택 없이 사용 가능; 다른 자원 비용이 붙은 홈브루 소마법은 예외적으로 별도 비용 처리.
13. 2014년 기본 클래스 프리셋은 **데이터**이지 전투 규칙 엔진 코드가 아니다.
14. `slot_track`의 `fixed` 부분 회복은 레벨별 회복 개수가 모호하므로 v1에서는 자동 지원하지 않는다. `full` 회복 또는 레벨별 슬롯 수동 증감으로 처리한다.

## 3. 예시 카드 1 — 1레벨 주문

```json
{
  "id": "card-cure-wounds",
  "name": "상처 치료",
  "kind": "spell",
  "roles": ["heal"],
  "actions": ["action"],
  "range": { "kind": "touch" },
  "tags": [],
  "spellLevel": 1,
  "castOptions": [
    {
      "id": "cast-normal",
      "label": "주문 시전",
      "costs": [{ "type": "slot", "costKey": "spell_slots", "slotSelection": "standard" }],
      "casting": { "mode": "standard", "allowUpcast": true, "allowBelowBase": false }
    }
  ],
  "createdAt": "2026-11-16T00:00:00.000Z",
  "updatedAt": "2026-11-16T00:00:00.000Z"
}
```

- 캐릭터 바인딩에서 `spell_slots`를 일반 주문 슬롯 자원 인스턴스로 연결한다.
- 슬롯 레벨 1..9 중 **현재 보유하고 주문 레벨 이상인 슬롯**만 활성화한다.
- 3레벨 슬롯으로 시전하면 3레벨 잔여량만 1 감소.

## 4. 예시 자원 — 홈브루 영력 5점

```json
{
  "id": "res-template-spirit",
  "key": "spirit_points",
  "name": "영력",
  "kind": "counter",
  "unit": "점",
  "capacity": { "type": "fixed", "value": 5 },
  "recovery": [
    { "triggers": ["short_rest"], "amount": { "type": "fixed", "value": 2 } },
    { "triggers": ["long_rest"], "amount": { "type": "full" } }
  ],
  "source": "user",
  "version": 1
}
```

- `short_rest`: 기존 잔여량 +2, 단 최대치 5 이내. `long_rest`: 5로 회복.
- 동일 자원에 한 이벤트에서 둘 이상의 규칙이 반응할 경우 **우선순위는 `long_rest` 명시 규칙 > 짧은 휴식 상속 규칙**. `long_rest`에 대한 명시 규칙이 없을 때는 `short_rest` 규칙을 긴 휴식 시 한 번 적용한다.
- 같은 트리거의 회복 규칙이 복수면 모듈 저장 단계에서 오류로 처리한다(모호성 금지).

## 5. 예시 자원 — 워락 11레벨

```json
{
  "id": "res-template-pact-2014",
  "key": "pact_slots",
  "name": "계약 마법 슬롯",
  "kind": "slot_track",
  "unit": "개",
  "slotCapacityByClassLevel": { "11": { "5": 3 } },
  "recovery": [{ "triggers": ["short_rest", "long_rest"], "amount": { "type": "full" } }],
  "source": "class_2014",
  "version": 1
}
```

실제 프리셋에서는 `slotCapacityByClassLevel`에 1~20레벨 전체 테이블을 기입하여 슬롯 레벨 및 수량을 함께 결정한다. 위 JSON은 설명을 위해 **11레벨 항목만 발췌한 예시**이다. 신비의 비전(6레벨)은 별도의 횟수 모듈로 제공한다.

## 6. SQLite 논리적 테이블

```text
schema_migrations(version, applied_at)
card_definitions(id, name, image_asset_id, kind, spell_level, attributes_json, created_at, updated_at)
assets(id, relative_path, sha256, mime_type, width, height)
resource_templates(id, key, name, kind, definition_json, source, version)
character_profiles(id, name, ruleset, class_id, level, ability_scores_json, active_deck_id)
resource_instances(id, character_id, template_id, overrides_json, current_state_json)
decks(id, character_id, name)
deck_cards(deck_id, card_id, position)
card_bindings(id, character_id, card_id, cost_key, resource_instance_id)
play_events(id, character_id, event_type, payload_json, occurred_at)
settings(key, value_json)
```

- JSON 컬럼은 런타임 스키마 검증을 통과해야 한다.
- FK/인덱스 활성화, foreign keys ON, 별도 테이블로 확장해도 무관.
- 스키마 마이그레이션은 버전 관리하고 데이터 변경 전 백업.
- 카드 이미지는 DB blob에 담지 않고 앱 관리 assets 폴더에 보관.

## 7. ZIP 백업 표준 구조

```text
DnD_TCGfy_Backup.zip
  manifest.json       # schemaVersion, exportedAt, sha256, appVersion
  data.json           # cards, profiles, decks, resources, bindings, events
  assets/
    <asset-uuid>.png
    <asset-uuid>.webp
```

- `manifest.json`에 파일별 SHA-256을 포함하고 불일치 시 가져오기 중지.
- ZIP 내부 절대 경로·`..` 경로·심볼릭 링크·과도한 압축 해제 크기는 거부.
- 이전 데이터를 덮어쓰기 전 자동 백업/확인. 실패하면 기존 데이터 복구.

## 8. 해석 규칙과 구현자 메모

- 주문 레벨은 카드 정의, 선택한 슬롯 레벨은 **이벤트**에 저장한다.
- `allowsUpcast`는 슬롯 선택 허용 조건이며 실제 회복량/피해량 증가 계산은 수행하지 않는다.
- 슬롯 외 독립 자원도 똑같이 costs 배열에 기록하여 다중 소비에 대응한다.
- 사용 횟수 제한이 붙은 카드의 독립 카운터도 ResourceTemplate/Instance로 표현한다(`scope`는 카드 바인딩으로 구현).
- 클래스 레벨 표는 2014 PHB를 검증하여 JSON 프리셋 파일에 채운다. 본 문서의 축약 예시를 전체 표로 오해하지 않는다.
- 이름/설명/태그 한글 입력과 유니코드 정렬을 기본 지원한다.
