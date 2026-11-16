# P2 데이터 계약 보충 · SQLite v3

원본 DATA_SCHEMA와 P1 보충을 유지한다. ResourceTemplate은 counter/slot_track과 선언형 CapacityRule, RecoveryRule을 사용한다. ResourceInstance의 overrides_json은 nameOverride/capacityOverride/slotCapacityOverride/scope/ownerCardId를 담고 current_state_json은 remaining 또는 remainingByLevel만 담는다.

- fixed/variable CostSpec에 선택적 slotLevel(1..9)을 추가한다. 일반 슬롯 트랙의 구체적인 비용 레벨이다. slot/casting은 P3 예약 계약으로 유지하며 P2에서 실행하지 않는다.
- resource_templates와 resource_instances에 archived_at을 추가한다. 템플릿 보관 해제는 기존 장착 인스턴스를 바꾸지 않는다. 인스턴스 삭제는 바인딩을 다른 자원으로 바꾸지 않으며 사용을 미연결로 거부한다.
- resource_revisions(character_id, revision)는 캐릭터별 낙관적 동시성 번호다. 변경 요청의 expectedRevision과 일치해야 한다.
- resource_requests(request_id, character_id, fingerprint, event_id, occurred_at)는 성공 요청의 중복 차감을 막는다. 같은 ID로 다른 내용은 거부한다.
- resource_undos(target_event_id, undo_event_id)는 변경 이벤트가 두 번 되돌려지지 않게 한다.
- play_events.payload_json에는 engineVersion=1, label, changes, reversible, barrier 및 선택적 cardId/castOptionId/choices/override/undoesEventId/configuration를 기록한다. 레거시 기록은 읽기 전용으로 보존한다.
- 범위 card는 해당 카드만 소비할 수 있고, item은 item 카드 출처를 갖는 캐릭터 공유 자원이다. 모든 바인딩은 같은 캐릭터 소유 인스턴스로 제한한다.
- 사용 중 템플릿은 복제 후 편집한다. 인스턴스 override 편집은 현재 소비량을 보존한 새 현재량을 명시 적용한다. 설정 변경은 Undo 경계이며, 상태 변경 Undo는 그 뒤의 기록 안에서만 수행한다.

v2→v3 전에 일관성 백업을 만든다. 현재량을 최대치로 초기화하지 않는다. 설정이 불완전한 레거시 자원은 오류를 안내하고 원본 행을 보존한다.
