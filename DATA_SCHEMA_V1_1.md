# v1.1 표시 이력 보충 계약

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

## 지켜지는 것

- `play_events`는 추가만 되며(Undo도 새 기록) 이 기능은 이벤트를 지우거나 고치지 않는다.
- 자원 현재량, 캐릭터 revision, 직전 자원 변경 실행 취소 대상, 전체 카드 사용 기록, USED 더미는 바뀌지 않는다.
- `preferences`·`resource_display`·`appearance` 키는 그대로이므로 0.6.0도 이 DB를 그대로 연다(모르는 키는 읽지 않는다).
- 전체 교체 복원은 DB와 함께 이 키도 되돌린다. 사본 가져오기는 설정을 가져오지 않는다.
