# P4-B 표시 설정 보충 계약

SQLite 버전은 **v6 유지**. DDL·도메인 마이그레이션은 없다. 기존 자원 엔진·소비 이벤트·비용·카드·덱·휴지통 테이블은 변경하지 않는다.

`settings(key,value_json)`의 저장 형태:

- `preferences`: 기존 `viewMode`, `reducedMotion`, `resourcePanelCollapsed` 세 필드 유지. P0~P4-A 형식으로 읽을 수 있다.
- `resource_display`: 캐릭터 ID별 표시 설정. 사용자가 그룹 접힘이나 우선 표시를 바꿀 때만 생성한다.

```json
{
  "character-uuid": {
    "collapsedGroups": ["counter"],
    "priorityIds": ["resource-instance-uuid"]
  }
}
```

그룹 키는 `standard`, `pact`, `counter`, `generic` 중 하나다. 우선 표시는 모듈 단위이며 해당 모듈이 속한 그룹과 그룹 내부 순서만 바꾼다. 여러 우선 항목 사이에서는 기존 순서를 유지한다. 자동 사용 빈도 분석이나 자원 계산 규칙은 추가하지 않는다.

기존 설정 IPC의 런타임 계약에는 선택적인 `resourceViews` 맵을 추가한다. 메인에서 검증 후 `preferences`와 `resource_display`를 하나의 SQLite 트랜잭션으로 저장한다. 표시 맵이 없는 기존 설정 요청은 표시 맵을 지우지 않는다. 캐릭터 최대 200개, 캐릭터당 그룹 키 최대 4개·자원 ID 최대 1000개, ID 길이 최대 128자로 제한한다. 잘못된 저장값은 초기화하지 않고 오류로 알린다.

기존 DB는 표시 키가 없으면 모든 그룹 펼침·기존 자원 순서로 연다. 캐릭터마다 별도로 유지하며 패널 접기·관리창 왕복·앱 재시작 후 복원한다. 개별 자원 수정 행의 펼침은 저장하지 않는다. 사라진 모듈의 표시 ID는 현재 자원이 없으므로 무시하고 다른 모듈에 재배정하지 않는다.

표시 변경은 자원 revision과 `PlayEvent`를 변경하지 않으며 자원 사용 Undo 및 일괄 편집 복원 대상이 아니다. 원본 이미지·카드 ID·사용 이력·클래스 변경 정책에는 영향을 주지 않는다.
