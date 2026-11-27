# DnD TCG-fy v1.4 P5 최종 통합 검수

제품 코드 기준은 P4 승인 커밋 `8051128`이다. 인계 문서 01~06의 확정 요구사항을 Windows 빌드 26200에서 다시 검사했다. 이 단계의 변경은 재현 가능한 검증 코드와 기록이다. 코드에 포함된 앱 버전과 NSIS 설정은 기존과 같다.

## 요구사항별 판정

| ID | 판정 | 통합 빌드의 증빙과 구현 근거 |
|---|---|---|
| UI-001 | PASS | `v13-p3-e2e.mjs`, `v14-p5-display.mjs`. 실제 렌더링에서 간격 제외 24:52:24, IN PLAY 전고, 중앙 상세와 HAND 및 오른쪽 장부와 더미의 열 경계, 선택·미선택과 원본 비율을 검증했다. `App.tsx`, `theme-playmat.css`, `SelectedCardPanel.tsx`. |
| UI-002 | PASS | `v13-p3-ux-e2e.mjs`. 0·1·2·14개 자원에서 더미와 회복·Undo의 위치가 같다. 장문 이름과 마지막 자원까지 내부 스크롤, 접기 후 HAND·더미 접근, 수동 조정과 회복을 확인했다. `ResourcePanel.tsx`, `theme-playmat.css`. |
| UI-003 | PASS | `v13-p3-e2e.mjs`, `V13P3UI.test.tsx`. USED 및 DECK은 우측 하단에 나란히 있다. 앞면·뒷면·수량, 빈 자리, 좌클릭 기록·섞기, 우클릭/키보드 메뉴·포커스, 최근 기록 표시 비우기·되돌리기, 원래 순서 복원과 재시작을 확인했다. `Appearance.tsx`, `App.tsx`. |
| UI-004 | PASS | `v12-p3-e2e.mjs`, `v13-p3-ux-e2e.mjs`, 전체 E2E와 화면 직접 검토. 네 테마 재질·테두리·사용 인장, 텍스트 대비, 격자·휠·드래그·키보드·모션 감소, 비용/설명 스크롤과 고정 확정을 확인했다. 최대 200장 손패 및 최소 창에서 일괄 작업과 회복에 접근했다. `CardGallery.tsx`, `CardResources.tsx`, `theme-playmat.css`. |
| BUG-001 | PASS | `v13-p3-e2e.mjs`의 화면 픽셀 비교. 투명 PNG, 불투명 PNG, JPEG, 기본 카드에서 부족 오버레이가 그려진다. 투명 외곽, 부족 문구, 원본 이미지 해시, 파일 누락·교체 후 복구와 자원 회복을 확인했다. `CardFace.tsx`, `assets.ts`. |
| FLT-001 | PASS | `v13-p3-e2e.mjs`, `FiltersUI.test.tsx`. 행동·보너스 행동·반응 행동의 교체·재클릭 해제, 추가 필터의 복수 OR와 역할 조건 동작을 확인했다. `Filters.tsx`, `library.ts`. |
| FLT-002 | PASS | `v13-p3-e2e.mjs`, `v13-p3-ux-e2e.mjs`, `FiltersUI.test.tsx`. 반응 행동 바로 오른쪽의 추가 필터, 좁은 창, Ctrl+F, 닫기·초기화가 작동했다. `Filters.tsx`, `App.tsx`. |
| CARD-001 | PASS | `v14-p2-e2e.mjs`, 설치본 연속 흐름, 템플릿 및 백업 회귀. 등록·수정·혼합 일괄 등록·템플릿, 카드 위치 및 확대, 이미지 누락 표시와 원본 바이트 보존을 확인했다. `CardEditor.tsx`, `CardFace.tsx`, `batch-registration.ts`, `library-store.ts`. |
| CARD-002 | PASS | 최신 `v14-p2-e2e.mjs`. 집중만·의식만·둘 다·둘 다 아님을 독립 필터로 구분했다. 반응 행동·보너스 행동과 독립 저장, 재시작 후 값을 재확인했다. `CardMetadataFields.tsx`, `Filters.tsx`, `contracts.ts`. |
| CARD-003 | PASS | `v14-p2-e2e.mjs`, `tests/use-rules.test.ts`. 정상 슬롯 사용, 일반 슬롯 소진 시 의식 선택과 +10분 안내, 의식의 슬롯 미차감, 명시한 비슬롯 비용 차감·Undo, 전용 옵션 중복 방지를 확인했다. `casting.ts`, `CardResources.tsx`. |
| CARD-004 | PASS | `v14-p2-e2e.mjs`, 전체 E2E, `use-rules.test.ts`. 효과 강화 기본 OFF, 별도 슬롯 범위, 상위 사용, 고정·최소·최대, 계약 마법·소마법·홈브루 다운캐스트 및 기존 비용 보존을 확인했다. `use-rules.ts`, `casting.ts`, `CardCostEditor.tsx`. |
| RES-001 | PASS | `v14-p3-audit-e2e.mjs`. III까지 보유한 캐릭터가 I~IX 중 V 요구를 등록하고 읽었다. 미보유·소진을 구분하고 사용자 정의 V 트랙도 미보유 상태에서 등록했다. `RegistrationRules.tsx`, `CardCostEditor.tsx`, `casting.ts`. |
| RES-002 | PASS | `v14-p3-audit-e2e.mjs`, `v14-resources.test.ts`. 획득 후 같은 카드의 자동 연결, 다른 종류·슬롯 계열·모호한 후보 거부, 미리보기와 차감 일치를 검증했다. `casting.ts`, `resource-engine.ts`, `CardResources.tsx`. |
| RES-003 | PASS | `v14-p3-audit-e2e.mjs`, 설치본 연속 흐름, `v14-resources.test.ts`. 라이브러리만 등록하면 미생성, 덱 최초 추가 후 수동 연결 없이 자원 생성·차감. 고유·공유 복합 비용의 원자성과 Undo 통과. `migrations.ts`, `resource-store.ts`, `OwnedResourcesEditor.tsx`. |
| RES-004 | PASS | `v14-p3-audit-e2e.mjs`, `v14-resources.test.ts`. 7회 중 5회 소모 → 덱 제외 → 재추가 후 2/7, 두 덱의 단일 인스턴스와 다른 캐릭터의 독립 상태, 비활성 회복·최대량 변경·재시도·재시작·휴지통과 삭제 후 기록 보존을 확인했다. `migrations.ts`, `resource-store.ts`, `trash-store.ts`, `edit-store.ts`. |
| RES-005 | PASS | 전체 E2E, `use-rules.test.ts`, `v14-resources.test.ts`. 기존 수동 연결·캐릭터별 재정의, 미설정과 무소모 구분, 명시 예외 사용, 삭제된 연결과 자원 부족 시 무차감을 확인했다. `resource-store.ts`, `casting.ts`, `CardUseRules.tsx`. |
| DATA-001 | PASS | 설치본 연속 흐름과 `tests/deck-exchange.test.ts`. 카드 순서, 태그, 고급 비용·시전 범위, 캐릭터별 이식 비용, 고유 자원 정의가 JSON에 남았다. 잔여량·기록·Undo·로컬 ID·이미지 경로를 제외했다. `electron/deck-exchange.ts`, `src/shared/deck-exchange.ts`. |
| DATA-002 | PASS | 설치본에서 새 DB 왕복 및 반복 적용 후 5/7 유지. 통합 테스트에서 잘못된 버전·크기·ID·참조·경로 거부, 같은 원본 재사용, 기존 ID 보존과 확정 도중 실패의 전체 롤백. 화면에서 이미지/재연결/이름 충돌 안내 확인. `deck-exchange.ts`, `DeckExchangeManager.tsx`, `main.ts`, `preload.ts`. |
| DATA-003 | PASS | 후보 및 v1.3 실제 설치본을 별도 프로필로 실행했다. v1.3 데이터의 v6→v9 및 v1→v9 이행, 사전 백업·재시작, 신규 속성의 JSON 및 전체 ZIP 복원, 강제 이행 실패 후 거래 취소와 복구, v1.3의 v9 거부 및 DB SHA-256 무변경을 확인했다. `store.ts`, `migrations.ts`, `backup.ts`, `v14-migration-recovery.test.ts`, `v14-p5-downgrade.mjs`. |

## 화면 증빙

아래 PNG는 같은 Windows 앱을 캡처한 화면이다. 네 테마의 배경 재질·테두리·사용 인장을 직접 확인했다. 최소 창에서는 설명, 비용, 장부 목록이 각 영역에서 스크롤되고, 회복 버튼과 USED·DECK을 계속 볼 수 있다. 단일 등록에서 고유 자원의 항목을 펼치면 입력 필드가 한곳에 모이며, 다음 영역은 대화상자 내부 스크롤로 접근한다.

| 화면 | 파일 |
|---|---|
| 1920×1080 / 1366×768 / 1280×720 / 최소 860×440 | [1920×1080](../../artifacts/p5-display-g0oFno/board-1920x1080.png) · [1366×768](../../artifacts/p5-display-g0oFno/board-1366x768.png) · [1280×720](../../artifacts/p5-display-g0oFno/board-1280x720.png) · [최소 창](../../artifacts/p5-display-g0oFno/board-860x440.png) |
| 네 테마 | [Oxblood](../../artifacts/v12-p3-O58BJ5/oxblood.png) · [Ebony](../../artifacts/v12-p3-O58BJ5/ebony.png) · [Verdant](../../artifacts/v12-p3-O58BJ5/verdant.png) · [Arcane Blue](../../artifacts/v12-p3-O58BJ5/abyss.png) |
| 적은 자원 / 많은 자원 | [0개](../../artifacts/v13-ux-H2R6kc/shots/ledger-0-resources-1366x768.png) · [14개](../../artifacts/v13-ux-H2R6kc/shots/ledger-14-resources-1366x768.png) |
| 부족 카드가 있는 손패 / 오버레이 | [손패](../../artifacts/v13-ux-H2R6kc/shots/exhausted-1366x768.png) · [투명](../../artifacts/v13-p3-Pjsh4O/overlay-0-visible.png) · [불투명](../../artifacts/v13-p3-Pjsh4O/overlay-1-visible.png) |
| 신규 등록 / 고유 자원 / 덱 가져오기 | [등록](../../artifacts/v14-p4-fiYANi/card-registration.png) · [고유 자원](../../artifacts/v14-p4-fiYANi/owned-registration.png) · [가져오기](../../artifacts/v14-p4-fiYANi/02-import-preview.png) |
| 재현한 v1.3.0 / 현 후보 동일 조건 | [v1.3.0](../../artifacts/p5-display-gkfYCS/play-board.png) · [현 후보](../../artifacts/p5-display-g0oFno/play-board.png) |

같은 보드 데이터·카드·1366×768에서 v1.3.0의 열 폭은 260.8 / 688.4 / 260.8px이고, 현 후보는 290.4 / 629.2 / 290.4px다. 현 후보는 IN PLAY를 전고로 확장하고 USED를 DECK 옆으로 옮겼다. 카드 더미는 이미지와 수량을 우선하며, 조작은 우클릭 메뉴에 있다. 추가 필터는 반응 행동 바로 오른쪽으로 이동했다. 포토배쉬 B 및 대화 참고 이미지에서 제안했던 IN PLAY와 오른쪽 두 더미의 구성은 반영했다. 포토배쉬의 위아래 너비 차이 대신 승인된 24:52:24가 장부와 더미, 상세와 HAND의 경계까지 이어진다.

### 실제 Windows 배율과 Electron 강제 배율

1920×1080 디스플레이의 Windows 설정을 직접 변경했다. 후보 앱을 재실행해 Windows 보고 배율과 렌더러 보고 배율이 일치함을 확인했다. 검수가 끝난 뒤 Windows 설정을 원래의 **100%**로 복원했다.

| 실제 설정 | Electron 콘텐츠 논리 크기 | 결과 |
|---|---|---|
| 100% | 1366×768과 별도 4개 크기 | PASS · [화면](../../artifacts/p5-display-g0oFno/play-board.png) · [측정](../../artifacts/p5-display-g0oFno/report.json) |
| 125% | 1368×768 | PASS · [화면](../../artifacts/p5-display-lBdXYC/play-board.png) · [측정](../../artifacts/p5-display-lBdXYC/report.json) |
| 150% | 1280×628 | PASS · [화면](../../artifacts/p5-display-1x1svd/play-board.png) · [측정](../../artifacts/p5-display-1x1svd/report.json) |

별도로 Electron 강제 장치 배율 100/125/150% × 콘텐츠 크기 1920×1080/1366×768/1280×720 조합 9개와 기본·최소 창을 확인했다. 이 조합은 운영체제 배율을 바꾸지 않는 모의 검증이다. [보드 수치와 픽셀 검증](../../artifacts/v13-p3-Pjsh4O/report.json) · [손패·장부 검증](../../artifacts/v13-ux-H2R6kc/report.json)

## 설치 후보와 데이터 보호

| 검증 | 판정 | 근거 |
|---|---|---|
| 기존 설정의 x64 NSIS 빌드 | PASS | `npm run dist:win -- --publish never`. [설치 후보](../../release/DnD-TCG-fy-Setup-1.3.0-x64.exe) |
| 후보 본체 실행 | PASS | 원본 NSIS 빌드의 `win-unpacked/DnD TCG-fy.exe`에서 패키지 실행, 보드 크기, 오프라인 사용·비정상 종료·ZIP 복원을 확인했다. |
| 분리된 NSIS 설치와 설치본 실행 | PASS | 기존 v1.3 보호를 위해 QA 설치명과 ID, 작업 폴더의 설치 경로를 썼다. 설치 및 QA 제거 종료 코드 0, ASAR와 네이티브 구성 파일 48개의 SHA-256 일치, 기존 exe의 해시 무변경. [설치 확인](../../artifacts/p5-nsis-qa/installation-report.json) · [설치 앱 연속 흐름](../../artifacts/v14-p4-fiYANi/report.json) |
| 실제 사용자 환경에 같은 설치 ID로 덮어쓰기 | NOT RUN | 기존에 설치된 v1.3과 실제 사용자 데이터에 적용하는 작업은 최종 승인 이후 범위다. |
| 서명 또는 정식 1.4.0 버전 반영 | NOT RUN | 기존 앱 버전 `1.3.0`과 서명 없는 기존 설정의 로컬 후보다. 설치 파일명도 기존 버전을 따른다. |
| Windows 10, 다른 GPU 및 다중 모니터 | NOT RUN | 이번 검증에서 사용 가능한 Windows 호스트는 1대였다. |
| 고급 비용의 일괄 등록·템플릿 작성 | BLOCKED | 승인된 기존 제한이다. 입력 중인 고급 자원 요구 유실 방지와 이미 등록된 규칙의 덱 JSON 왕복은 PASS다. |

후보 SHA-256은 `69A0E33552032DD65D64E5A2D08371D88A68E3CB71216428D58C7F9AB5926EBE`다. v1.3 실행 파일은 격리된 v6 프로필에서 열렸고, v9 복사본에는 새 버전의 데이터라는 오류를 표시했다. v9 DB 해시는 실행 전후 동일했다. [구버전 거부 기록](../../artifacts/p5-downgrade-xp6lrb/report.json)

## 재현 명령과 변경 파일

- `npm run lint`, `npm run typecheck` 및 `node scripts/test.mjs --maxWorkers=3 --no-color`가 통과했다. 다른 Windows 앱 검사와 함께 실행했을 때 ZIP 복원 테스트 1건이 제한 시간에 걸렸다. 전체 자동 테스트를 단독 재실행해 39개 파일의 536개를 모두 통과했다.
- `node scripts/e2e.mjs`의 기존 Windows 회귀 38개, `v13-p3-e2e.mjs`와 `v13-p3-ux-e2e.mjs`의 보드 검사 각각 9개, `v12-p3-e2e.mjs`의 테마 검사 6개, `v13-p2-e2e.mjs`의 일괄·템플릿 검사 6개를 다시 실행했다. [기존 회귀](../../artifacts/p1-e2e-0YeC3h/result.json) · [테마](../../artifacts/v12-p3-O58BJ5/report.json) · [일괄·템플릿](../../artifacts/v13-p2-J5SedX/report.json)
- `v14-p4-e2e.mjs`를 확장해 실제 설치본에서 캐릭터·덱 생성부터 세 이미지 모드 등록, 카드 사용·회복·덱 재추가, JSON 및 ZIP 복원까지 6개 연속 검사를 통과했다. `v14-p2-e2e.mjs`의 5개 검사에 네 주문 속성 조합을 포함했고, `v14-p3-audit-e2e.mjs`의 7개 검사로 고유 자원과 자동 연결을 다시 확인했다. [설치 앱의 연속 흐름](../../artifacts/v14-p4-fiYANi/report.json) · [P2 회귀](../../artifacts/v14-p2-LANaGU/report.json) · [P3 회귀](../../artifacts/v14-p3-audit-ijISmN/report.json)
- `v14-p5-display.mjs`로 실제 배율·보드 캡처, `v14-p5-downgrade.mjs`로 기존 설치 앱의 DB 거부, `v14-migration-recovery.test.ts`로 이행 실패 및 복구를 재현했다. `p5-e2e.mjs`는 후보 본체를 대상으로 오프라인 사용·강제 종료·전체 교체/사본 복원을 검사했다. [후보 본체 백업 회귀](../../artifacts/p5-e2e-8i1npq/p5-report.json)
- Windows 자동화는 실제 앱의 폼과 버튼을 사용했다. 시스템 파일 선택창에는 테스트 파일 경로를 자동 전달했다. 화면 증빙과 테스트 데이터는 로컬 산출물이다.

### 승인 후 업데이트와 복구 순서

1. 기존 앱에서 **관리 → 백업·복원 → ZIP으로 내보내기**를 사용한다. ZIP을 설치 폴더 밖에 저장하고, 기존 앱의 **백업 파일 열기**로 미리보기에서 카드·덱·이미지 수를 확인한다.
2. 기존 앱을 종료한다. 승인된 설치 파일과 최종 버전을 확인한 뒤 설치한다. 처음 실행하면 기존 DB 사전 백업을 만들고 v9로 이행한다. 카드·덱·자원·기록과 이미지를 확인한 뒤 새 버전에서 전체 ZIP을 새로 보관한다.
3. 이행에 실패하면 앱을 닫고 오류 문구와 데이터 폴더를 보존한다. 원본을 덮어쓰기 전에 설치 전 ZIP을 준비하고, 필요하면 이전 앱 또는 고친 후보에서 별도 프로필로 먼저 복원한다.
4. v1.3으로 복귀할 때는 새 버전 데이터를 별도로 보관하고 설치 전 v1.3 ZIP을 사용한다. v1.3이 새 데이터 때문에 열리지 않으면 두 앱을 종료하고 신규 데이터 폴더를 다른 이름으로 보존한 다음, v1.3 앱을 빈 프로필로 열어 **백업·복원 → 현재 데이터를 백업으로 교체**로 기존 ZIP을 복원한다. 설치 전 SQLite 사본만 있을 때는 같은 시점의 관리 이미지 사본도 필요하다. 업데이트 이후에 새로 등록하거나 사용한 기록은 설치 전 ZIP에 포함되지 않는다.
