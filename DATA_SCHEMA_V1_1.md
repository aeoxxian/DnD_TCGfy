# v1.1 설정 보충 계약

SQLite 버전은 **v6 유지**. DDL·마이그레이션은 없다. 자원 엔진·`play_events`·`resource_undos`·카드·덱·휴지통 테이블은 변경하지 않는다.

## `settings` 키 `history_view` (Phase 2)

자원 패널 “최근 작업” 목록의 **표시 정리 지점**이다. 캐릭터 ID별로 하나씩, 사용자가 “기록 비우기”를 확정했을 때만 생긴다.

```json
{
  "character-uuid": {
    "clearedEventId": "play-event-uuid",
    "clearedAt": "2026-11-18T10:00:00.000Z"
  }
}
```

- `clearedEventId`: 비울 때 목록 맨 위(가장 최근)였던 `play_events.id`.
- `clearedAt`: 그 이벤트의 발생 시각(ISO 8601, UTC).
- 목록은 최신순 이벤트에서 이 이벤트보다 앞(더 최근)의 것만 보인다. 이 이벤트가 불러온 범위(최근 40건)에 없으면 `clearedAt`보다 늦은 이벤트만 보인다.
- 런타임 계약은 `settingsSchema.historyViews`(선택, 캐릭터 200개 이하, 항목은 `strictObject`)다. 설정 저장 요청에 이 맵이 없으면 기존 값을 지우지 않는다. 앱은 현재 캐릭터 목록에 없는 ID의 항목을 저장할 때 정리한다.
- “숨긴 기록 다시 표시”는 해당 캐릭터 항목을 지운다.

## `settings` 키 `effects` (Phase 3)

시각 효과 선택. 사용자가 환경 설정에서 바꿀 때만 생긴다.

```json
{ "cardTilt": false }
```

- `cardTilt`: 확대 카드 3D 기울임. 키가 없으면 켬으로 본다. 앱의 “모션 줄이기”가 켜져 있거나 Windows의 동작 줄이기 설정이면 값과 관계없이 기울이지 않는다.
- 런타임 계약은 `settingsSchema.effects`(선택, `strictObject`). `preferences`에 넣지 않으므로 0.6.0도 DB를 읽는다.
- 자원·사용 기록·카드 데이터와 무관하며 Undo 대상이 아니다.

## `settings` 키 `slot_colors` (Phase 4)

캐릭터별 주문 슬롯 보석 색. 사용자가 관리 → 자원 관리 → “주문 슬롯 색상”에서 바꿀 때만 생긴다.

```json
{
  "character-uuid": {
    "standard": { "base": "#a3283a" },
    "pact": { "base": "#2f7d4f", "levels": { "5": "#7547a3" } }
  }
}
```

- 색은 소문자 `#rrggbb`. `levels`의 키는 `"1"`~`"9"`이며 일부만 있어도 된다. 표시 색은 레벨 색 → 종류 색(`base`) → 기본 사파이어(`#4d62ad`) 순으로 정한다.
- 런타임 계약은 `settingsSchema.slotColors`(선택, 캐릭터 200개 이하, 모두 `strictObject`). “기본 색상으로 복원”은 해당 캐릭터 항목을 지우고, 비어 있는 종류·레벨 맵은 저장하지 않는다. 현재 캐릭터 목록에 없는 ID는 저장할 때 정리한다.
- 표시 전용이다. 슬롯 수·사용·회복 계산, revision, 사용 기록, Undo와 무관하다.

## 지켜지는 것

- `play_events`는 추가만 되며(Undo도 새 기록) 이 기능은 이벤트를 지우거나 고치지 않는다.
- 자원 현재량, 캐릭터 revision, 직전 자원 변경 실행 취소 대상, 전체 카드 사용 기록, USED 더미는 바뀌지 않는다.
- `preferences`·`resource_display`·`appearance` 키는 그대로이므로 0.6.0도 이 DB를 그대로 연다(모르는 키는 읽지 않는다).
- 전체 교체 복원은 DB와 함께 이 키도 되돌린다. 사본 가져오기는 설정을 가져오지 않는다.
