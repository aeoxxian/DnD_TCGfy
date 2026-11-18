# v1.2 데이터 보충 계약

SQLite 버전은 **v6 유지**. DDL·마이그레이션·새 `settings` 키는 없다. 1.1.0과 1.2 개발본은 같은 DB를 서로 열 수 있다.

## `library_state.viewScope` 해석 (Phase 1)

저장 형식(`'library' | 'deck'`)과 서버 검증(`deck`이면 캐릭터 필요)은 그대로다. 화면에서는 손패 머리의 ‘전체 카드’·‘활성 덱’ 버튼을 없애고 보기 범위를 상단 선택으로 정한다.

| 상단 선택 | 화면 범위 | 앱이 저장하는 값 |
| --- | --- | --- |
| 캐릭터(활성 덱 있음) | 그 캐릭터의 활성 덱 | `activeCharacterId: <id>`, `viewScope: 'deck'` |
| 캐릭터(활성 덱 없음, 예외) | 모든 카드 | 위와 같음 |
| ‘전체 라이브러리’ | 모든 카드 | `activeCharacterId` 없음, `viewScope: 'library'` |

- 1.1.0이 저장할 수 있었던 “캐릭터 + `library`” 상태는 화면에서 덱 보기로 해석하고 **저장값은 고치지 않는다**(사용자가 캐릭터를 다시 고를 때 위 표대로 저장).
- 덱 구성은 ‘전체 라이브러리’에서 카드를 고르고 관리 메뉴의 **덱에 넣기·빼기**로 바꾼다. 기존 `setDeckCards` IPC를 그대로 쓰며 카드 정의·이미지·비용은 바뀌지 않는다.

## `saveCards.initialRules.newResources` (Phase 1)

카드 등록 중 만든 새 자원(횟수·포인트)이다. 선택 필드이며 새 IPC 채널이나 DB 열은 없다.

```json
{
  "initialRules": {
    "configured": true, "scope": "character", "characterId": "character-uuid", "expectedRevision": 12,
    "castOptions": [{ "id": "option-uuid", "label": "일반 사용", "costs": [{ "type": "fixed", "costKey": "cost-uuid", "amount": 1 }] }],
    "bindings": [{ "costKey": "cost-uuid", "resourceInstanceId": "draft-uuid" }],
    "newResources": [{
      "draftId": "draft-uuid",
      "template": { "name": "지팡이 충전", "unit": "회", "kind": "counter", "capacity": { "type": "fixed", "value": 7 },
                    "recovery": [{ "triggers": ["dawn"], "amount": { "type": "fixed", "value": 3 } }] }
    }]
  }
}
```

- 최대 4개. `template`은 메인 프로세스에서 `templateDraftSchema`로 검증하고, `kind`는 `counter`만 허용한다(슬롯 트랙·카드/아이템 전용 범위는 자원 관리에서).
- 비용 연결(`bindings`)은 새 자원을 `draftId`로 가리킨다. 연결되지 않은 초안, 캐릭터 없는 등록, 비용 미설정 등록, 기존 자원 ID와 겹치는 `draftId`, 현재 캐릭터의 활성 자원 또는 다른 초안과 이름이 같은 초안(공백·대소문자 정규화)은 거부한다.
- 저장(`RegistrationStore.save`)은 하나의 트랜잭션이다: 검증 → 카드·덱 연결 저장 → 초안마다 기존 `create_resource`(사용자 템플릿 저장 + 활성 캐릭터에 `scope:'character'`로 장착, 현재량 = 최대치, “<이름> 자원 생성” 기록, revision +1) → `draftId`를 실제 자원 ID로 바꾼 비용 연결 저장 → 등록 영수증. 어느 단계든 실패하면 전부 취소된다.
- “자원 생성” 기록은 자원 관리에서 만든 것과 같이 이전 자원 변경 Undo의 경계가 된다. 같은 요청 ID 재전송은 영수증으로 한 번만 처리된다.
- 1.1.0은 이 필드를 보내지 않으며, 저장된 결과(템플릿·자원 인스턴스·비용 연결)는 기존 형식 그대로라 1.1.0에서도 열린다.
