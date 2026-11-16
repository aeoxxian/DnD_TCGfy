# P1 데이터 계약 보충 · SQLite v2

원본 DATA_SCHEMA.md의 엔티티 분리와 비용/자원 계약을 유지한다.

- Role에 `protect`, `buff`, `debuff`, `revive`를 추가한다. 기존 역할 ID/의미는 바꾸지 않는다.
- `tags(id, name, created_at, updated_at)`는 공통 태그 표시명을 보관한다. CardDefinition.tags는 표시명과 무관한 안정적인 태그 ID 배열이다.
- `card_tags(card_id, tag_id)`는 FK 연결이다. attributes_json의 tags도 같은 트랜잭션에서 일치시킨다. 기존 JSON 태그 ID는 마이그레이션에서 그대로 연결하고 초기 표시명으로 사용한다.
- `card_definitions.archived_at`이 있으면 등록 해제된 카드다. 원본/메타데이터/과거 참조는 유지한다.
- `assets.original_name`은 원래 파일명이며 경로가 아니다. `relative_path`는 앱 내부의 `assets/<uuid>.<ext>`, sha256은 원본 바이트 해시다. 썸네일은 `cache/thumbnails/<sha256(asset-id)>.webp`의 재생성 가능한 파생 캐시다. 캐시 키를 해시하여 기존 문자열 ID도 파일 경로로 해석되지 않게 한다.
- `settings.preferences`는 P0의 세 필드를 그대로 유지한다. `settings.library_state`에는 query, roles, actions, kinds, ranges, tagIds, viewScope 및 선택적 activeCharacterId를 저장한다. 동일 분류 OR, 분류 사이 AND를 적용한다.
- 새 카드/asset/태그/프로필/덱 ID는 메인에서 UUID로 생성한다. 기존 문자열 ID는 유지한다.
- 카드 편집 요청은 메타데이터만 받는다. 기존 ID/createdAt/castOptions 및 비용은 서버가 보존한다. 새 카드의 castOptions는 ID가 있는 일반 사용 옵션이며 costs는 빈 배열이다. P1에서는 사용 버튼이 비활성이다.
- 프로필 생성 시 레벨 1의 dnd5e_2014 프로필과 빈 기본 덱을 하나의 트랜잭션으로 만든다. 추가 덱도 해당 캐릭터 소유로 제한한다. 카드 정의는 공유하고 덱 연결은 별도다.
- 등록 해제는 비용 바인딩/과거 이벤트를 수정하지 않는다. 공통 태그 삭제는 연결/JSON/저장된 필터를 함께 정리한다. 다른 메타데이터와 비용 구조는 보존한다.

버전 1 → 2 전 기존 DB를 일관성 백업하고 트랜잭션 안에서 변경한다. 미래 버전 DB를 임의로 열거나 초기화하지 않는다.
