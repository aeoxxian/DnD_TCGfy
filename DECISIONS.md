# 구현 결정

## 2026-11-16 · P1.1

- 첨부 지시서 순서를 따른다. P1.1 회귀·Windows 검증·별도 커밋을 마치기 전 P2 코드를 구현하지 않는다.
- 새 카드만 현재 활성 캐릭터의 선택 덱에 자동 연결한다. 등록 폼에 목적지를 표시하고, 저장 트랜잭션에서 캡처한 캐릭터/덱과 실제 활성 상태·소유권을 다시 검증한다. 이전 IPC 호출에는 현재 상태를 사용한다. 덱이 없으면 라이브러리만 저장하며 안내한다. 수정/교체에는 덱 연결을 추가하지 않는다.
- P1.1은 SQLite v2를 그대로 유지한다. 이미지와 기존 ID/설정을 변경하지 않는다.
- 공격 필터 원인 조사: 실제 배포 DB의 활성 카드 12장 중 역할 damage=9장, kind attack=0장(유형 feat=1, feature=4, item=3, spell=4)을 읽기 전용 집계로 확인했다. 기존 필터의 roles→roles, kinds→kind 및 SQLite 매핑은 올바르다. 데이터의 역할과 유형 차이 및 중복 표시명에 대한 안내 부족이 확인된 원인이다. 유형 수와 분류 안내를 추가하고, damage+spell / utility+attack / damage+attack의 독립/복합 테스트로 검증한다. 사용자 메타데이터를 공격 유형으로 추정 변환하지 않는다.
- 손패에만 passive:false 휠 처리를 붙인다. 수평 터치패드는 기본 동작을 유지하며 세로 휠은 제한된 가로 이동으로 바꾼다. 경계에서는 일반 세로 스크롤을 허용한다. 왼쪽 포인터 드래그는 6px 이후에만 캡처하고 클릭을 억제한다. 카드 클릭/키보드 조작/외부 파일 드롭은 유지한다.

## 2026-11-16 · P1 착수

- 사용자 P1 요구를 우선한다. 기존 `damage/heal/utility/other` 역할 ID를 보존하고 `protect/buff/debuff/revive`를 추가한다. 유형/사거리는 기존 계약대로 단일 값, 역할/행동/자유 태그는 다중 값이다. 기존 `no_action`도 유지한다.
- SQLite v2 마이그레이션은 기존 테이블/설정을 보존하고 태그 정의/카드 연결, 카드 등록 해제 시각을 추가한다. P0의 preferences 형식을 바꾸지 않고 검색/필터/활성 캐릭터/보기 범위를 별도 설정 키에 저장한다.
- 공통 태그는 영구 ID로 연결한다. 카드 편집에서 태그를 붙이거나 떼어도 다른 카드는 바뀌지 않는다. 공통 태그 이름 변경/삭제는 별도 관리 화면에서 영향 범위를 알리고 명시적으로 수행한다.
- 등록 해제는 보존형 삭제다. 카드와 이미지를 물리적으로 제거하지 않고 라이브러리/덱 표시에서 제외한다. 과거 바인딩/기록/덱 참조와 교체 전 원본을 보존한다. 복구 UI/미참조 원본 정리는 P5 이후 별도 검토하며 이번에 임의로 추가하지 않는다.
- PNG/JPEG/WebP를 메인에서 파일 크기·실제 포맷·디코딩·픽셀 제한으로 검사한다. Sharp를 이미지 검증과 별도 썸네일 캐시에 사용한다. 원본을 Sharp 출력으로 대체하지 않는다. Sharp는 Node-API 런타임 의존성으로 외부 번들 처리하고 Windows 패키지에서 native 바이너리를 unpack하여 실제 실행을 검증한다.
- 파일 선택과 드롭은 preload `webUtils.getPathForFile`로 메인에 전달한다. renderer에는 원본 경로나 파일 읽기 API를 노출하지 않는다. URL은 불변 asset ID로만 제공한다.
- 한 번에 최대 100장, 파일당 32 MiB, 디코딩 총 4천만 픽셀을 허용한다. 폴더/원격 UNC/형식 불일치/손상 파일은 이름과 오류만 안내한다. 여러 파일은 개별 검사하고 유효 파일만 편집 목록에 넣으며, 카드 일괄 저장은 하나의 트랜잭션이다.
- 원본 복사와 검증을 먼저 완료한 후 asset 메타데이터를 등록한다. DB에 저장하지 못한 복사본이나 취소된 등록의 미참조 원본은 자동 삭제하지 않는다. 실제 카드 저장 전에는 라이브러리에 나타나지 않는다.
- P1 구현 계획의 캐릭터별 덱 구성은 이름 기반 프로필/덱 생성·선택·카드 연결까지만 제공한다. 클래스 프리셋/능력치/자원 UI는 P2/P3 범위다. 기존 castOptions와 비용 구조는 편집 시 그대로 보존하며 소비 엔진은 구현하지 않는다.
- 실제 사용자 카드 파일이 아직 없으므로 자동 검수는 명확히 표시한 PNG/JPEG/WebP 테스트 문서 이미지를 사용한다. 사용자 삽화를 생성/재디자인하지 않는다.
- Git은 착수 시 P0 기준 커밋을 만들고, P1을 검증 가능한 단위의 후속 커밋으로 보존한다. 기존 네 계약 문서는 보존하고 변경 해석은 이 문서와 DATA_SCHEMA_P1에 기록한다.

참고: [Electron webUtils](https://www.electronjs.org/docs/latest/api/web-utils), [Sharp 입력 제한](https://sharp.pixelplumbing.com/api-constructor/), [Sharp Electron 설치](https://sharp.pixelplumbing.com/install/).

P1 검수 중 보완:

- 실제 디스크 File을 이용한 파일 선택/드롭을 검증한다. 이미지 위에는 UI를 덮지 않고, 전체 원본 확대와 원본 크기 스크롤을 제공한다.
- 보존형 등록 해제 후 다른 덱 카드를 수정해도 이미 연결된 과거 카드 참조를 유지한다. 새로 연결하는 카드는 활성 카드로 제한한다.
- native 이미지 의존성은 Sharp 0.35.5로 고정했다. 원본/캐시 모두 읽기 크기를 제한하고, asset 경로와 캐시의 실제 경로가 userData 안에 있는지 검사한다.
- 개발 모드의 Vite CSS 주입이 P0 CSP에 막히는 문제를 P1에서 발견했다. 개발 서버별 임의 nonce를 Vite의 cspNonce와 style-src에 함께 넣었다. 배포 CSP는 unsafe-inline 없이 기존 제한을 유지한다. 원본 확대의 computed object-fit과 실제 화면 캡처를 개발/배포 양쪽에서 검증한다.
- `npm`의 업데이트 알림은 로컬 .npmrc에서 끈다. 앱 실행이나 테스트를 위해 불필요한 버전 조회를 하지 않게 한다. 보안 감사는 명시적으로 실행한다.

## 2026-11-16 · P0

- 이번 작업 범위는 사용자가 요청한 P0 검수까지다. P1의 등록/검색/필터/덱 편집, P2 이후의 자원 엔진은 구현하지 않는다. 문서의 P1 진행 지침보다 이번 요청의 P0 우선 범위를 적용한다.
- Electron + React + TypeScript + Vite + electron-builder를 유지한다. SQLite는 Electron에 포함된 `node:sqlite`를 메인 프로세스에서 사용한다. 별도 native addon과 ABI 재빌드가 필요 없으며, 고정한 Electron 및 개발 Node 버전에서 실제 동작을 검사한다. 내장 SQLite API의 실험적 상태는 향후 Electron 업그레이드 때 다시 검증한다.
- 데이터 계약의 문자열 ID 예시와 호환되도록 ID를 UUID 형식으로 강제하지 않는다. 새 실사용 엔티티 생성은 후속 단계에서 UUID를 사용한다.
- 마이그레이션 1은 데이터 계약의 엔티티를 독립 테이블로 준비한다. P0에서 도메인 데이터를 시드하지 않는다. 샘플 카드는 메모리에만 있는 UI 검수 자료이며 실제 카드/자원 상태와 섞이지 않는다.
- `userData/data/app.sqlite3`, `userData/assets`, `userData/backups`를 사용한다. 개발 데이터는 별도 `DnD TCG-fy Development`, 배포 데이터는 `DnD TCG-fy` 경로를 쓴다. E2E는 임시 경로를 명시하며 실사용 데이터를 건드리지 않는다.
- DB 버전은 `PRAGMA user_version`과 `schema_migrations`에 함께 기록한다. 기존 DB 변경 전 SQLite 일관성 백업을 만들고, 새 버전 DB는 읽기 전용 사전 검사에서 거부한다. 실패 시 리셋하지 않는다.
- 샌드박스 preload는 CommonJS 단일 번들로 빌드한다. IPC는 초기 상태 읽기와 검증된 환경 설정 저장 두 개로 한정한다. 렌더러에 경로나 범용 IPC/파일 접근을 노출하지 않는다.
- 카드 그림은 제공되지 않았다. 문자 기반 플레이스홀더만 사용하며 원본 카드 생성/수정은 하지 않는다. 선택 화면의 사용 버튼은 P0에서 비활성화한다.
- 명세의 `allowUpcast`와 마지막 메모의 `allowsUpcast` 표기는 정식 타입의 `allowUpcast`를 따른다. 실제 시전 검증은 P3 범위다.

기능 확장 제안: 없음.

## 검증 도중 반영한 환경 수정

- 개발 Vite 감시에서 `artifacts`, `.tools`, `release`, `dist-electron`을 제외한다. Windows에서 테스트용 Chromium Cookies 파일을 감시하면서 발생한 EBUSY를 해결했다.
- Vitest 변환 임시 파일은 프로젝트 `artifacts/vitest-temp` 아래에 둔다. 제한된 Windows 실행 환경의 OS 임시 폴더 rename EPERM을 해결하며 사용자 데이터와 분리한다.
- 의존성 보안 검사 결과에 따라 Zod, Vite, Vitest, electron-builder, typescript-eslint를 수정 버전으로 올리고 잠금 파일을 갱신했다. 테스트와 실제 Electron 실행은 교체 후 다시 검증한다. 개발 도구의 전이 minimatch 의존성에 남은 moderate 보고는 검증되지 않은 메이저 버전 강제 override로 숨기지 않는다. 런타임 및 high/critical 결과는 TEST_REPORT에 기록한다.
- 참고한 1차 자료: [Electron 보안 권고](https://www.electronjs.org/docs/latest/tutorial/security), [샌드박스 preload의 ESM 제약](https://www.electronjs.org/docs/latest/tutorial/esm), [Node 내장 SQLite](https://nodejs.org/api/sqlite.html). 실제 API 호환성은 설치된 Electron 45.3.3 / Node 24.22.3에서 확인한다.
