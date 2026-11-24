# v1.3 데이터 보충 계약

SQLite 버전은 **v6 유지**. DDL·마이그레이션은 없다. 새 `settings` 키는 Phase 2의 `registration_templates` 하나다. 1.2.0과 v1.3 개발본은 같은 DB를 서로 열 수 있다(1.2.0은 새 키를 읽지 않는다).

## 이미지 없는 카드 (Phase 1)

저장 형식은 그대로다. `card_definitions.image_asset_id`가 `NULL`인 카드는 v1.0부터 저장할 수 있었고, v1.3은 표시만 바꾼다.

- 손패·IN PLAY·USED·휴지통·확대 화면에 기본 카드 면을 그린다: 카드 이름, 유형(`spell`이면 `spell_level`로 “N레벨”·“소마법”), 유형 아이콘, 행동 경제. 모두 기존 열과 `attributes_json`에서 읽는다.
- 새 카드 유형이나 아이콘 설정을 저장하지 않는다. 아이콘은 기존 6개 `kind`에 고정이다.
- 이미지 파일을 읽지 못한 카드(파일 누락·손상)도 같은 기본 면을 쓰되 “이미지 파일을 읽을 수 없습니다.”를 함께 표시한다. DB는 고치지 않는다.
- 나중에 정보 수정에서 이미지를 넣으면 기존 경로대로 `image_asset_id`만 바뀐다.

## `saveCards.addToDeck` (Phase 1)

선택 필드(`boolean`). `false`면 새 카드를 덱에 넣지 않고 라이브러리에만 등록한다. 없거나 `true`면 지금처럼 `registrationTarget`(없으면 현재 활성 덱)에 넣는다.

- `registrationTarget`은 `addToDeck: false`일 때도 그대로 보내고 검사한다. 등록 창을 연 뒤 활성 캐릭터·덱이 바뀌었으면 저장을 거부한다(기존 보호 유지).
- 1.2.0 렌더러는 이 필드를 보내지 않으므로 동작이 같다.

## `assets:discard` IPC (`discardImports`, Phase 1)

등록·정보 수정 창에서 고른 뒤 저장하지 않은 이미지를 지운다. 입력은 이미지 ID 배열(최대 200개), 결과는 `{ discarded: number }`.

| 조건 | 처리 |
| --- | --- |
| 이번 실행에서 `assets:import`로 가져온 ID가 아님 | 무시(이전 실행·백업·다른 카드의 이미지는 지울 수 없음) |
| 카드(`card_definitions.image_asset_id`, 휴지통 카드 포함)가 사용 | 무시 |
| 카드 이미지 기록(`card_asset_history`)에 있음 | 무시 |
| 카드 뒷면 내 이미지(`settings.appearance.customBacks`)가 사용 | 무시 |
| 카드 뒷면 설정을 읽을 수 없음 | 모두 무시(아무것도 지우지 않음) |
| 그 밖의 경우 | 기존 `asset_cleanup` 대기열에 넣고 바로 정리(원본 파일·썸네일·`assets` 행 삭제) |

- 한 ID는 한 번만 요청할 수 있다(요청하면 이번 실행 목록에서 빠진다).
- 정리가 실패하면(파일 잠김 등) 기존처럼 대기열에 남아 다음 시작 때 다시 시도한다.
- 앱이 등록 창을 연 채 종료되면 그 이미지는 남는다. 이전 실행에서 남은 이미지는 자동으로 지우지 않는다(사용자 데이터를 추측해 지우지 않는다).

## `settings.registration_templates` (Phase 2)

`Settings.registrationTemplates`, 등록 템플릿 배열(최대 20개). 다른 설정과 따로 저장해서 `preferences`는 바뀌지 않는다.

```ts
{
  id: string; name: string;                       // 이름 1~40자, 같은 이름(공백·대소문자·NFKC 무시)과 같은 ID 금지
  card: { kind; spellLevel?; roles; actions; range: { kind; feet? }; tags: string[] };   // 카드 정의와 같은 값 범위
  rule: { kind: 'unconfigured' | 'none' | 'slots' | 'uses' | 'points'; scope: 'shared' | 'character';
          family: 'standard' | 'pact'; homebrew: boolean; belowBase: boolean; minLevel?; maxLevel?;
          resourceName?: string;                  // 자원은 캐릭터마다 ID가 달라 이름으로 저장
          amount: number; variable: boolean; min: number; max: number; step: number };
  addToDeck: boolean;
}
```

- 카드 이름·이미지·설명은 저장하지 않는다. 여러 사용 방식 같은 고급 규칙은 템플릿에 넣지 않는다.
- 적용할 때 `resourceName`을 현재 캐릭터의 횟수·포인트 자원에서 이름으로 찾는다. 없으면 비워 두고 알린다. 지워진 태그는 빼고 알린다. 캐릭터가 없으면 `scope: 'character'`를 공통으로 바꿔 알린다.
- 템플릿을 지워도 이미 등록한 카드는 바뀌지 않는다.

## 이미지 가져오기 결과 (`AssetPreview`, Phase 2)

선택 필드 두 개가 늘었다. DB 변경은 없다(`assets.sha256`은 v1부터 있음).

- `sha256`: 가져온 원본의 해시. 같은 일괄 등록 안에서 같은 이미지를 두 번 고른 것을 찾는 데 쓴다(두 번째부터 기본 제외).
- `duplicates`: 같은 바이트의 이미지를 이미 쓰는 카드(휴지통 카드 포함, 최대 3장)의 `{ name, trashed }`. 경고만 하고 등록은 막지 않는다.

## 여러 장 등록의 저장 단위 (Phase 2)

새 IPC는 없다. 렌더러가 카드마다 `saveCards`를 한 번씩 부른다. 각 요청은 기존 등록 트랜잭션 하나이고 `initialRules.requestId`는 카드마다 다르다.

- 같은 카드를 같은 내용으로 다시 보내면 같은 `requestId`를 쓴다. 이미 저장됐으면 기존 등록 영수증(`registration:<requestId>`)이 같은 결과를 돌려주므로 카드가 두 번 생기지 않는다.
- 비용을 저장하면 캐릭터의 자원 revision이 올라가므로, `expectedRevision`은 카드마다 새로 읽는다.
- 공통 규칙의 새 자원 초안은 그것을 쓰는 첫 카드의 `newResources`로 한 번만 보낸다. 뒤의 카드는 만들어진 자원 ID에 연결한다.
