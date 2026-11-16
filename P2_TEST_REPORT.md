# P1.1 / P2 완료 보고서

2026-11-16 · 앱 0.3.0 · Windows NT 10.0.26200 x64 · Electron 45.3.3 / 내장 Node 24.22.3.

## 완료 순서와 P1.1 결과

P1.1 구현 → 린트/타입/48개 테스트 → 개발/패키징 Windows 실행 검증 → **0d80906** 커밋을 완료한 뒤 P2 구현을 시작했다. P2는 이 보고서를 포함하는 별도 `feat: add generic resource engine and Windows acceptance` 커밋으로 보존한다. 최종 응답에 실제 해시를 제공한다.

P1.1의 원인 분석과 검수 증거는 [별도 보고서](P11_TEST_REPORT.md)에 보존했다.

| 항목 | 확인한 원인 | 구현 및 결과 |
| --- | --- | --- |
| 신규 카드 자동 덱 연결 | 저장 경로에 덱 삽입 처리가 없었음 | 폼이 캡처한 활성 캐릭터/덱을 재검증하고 카드 저장과 같은 트랜잭션으로 연결. 수정/교체/무활성 덱은 다른 덱에 연결하지 않음 |
| 우측 이미지 클릭 확대 | 클릭 핸들러가 없는 표시 영역이었음 | 이미지 전체 버튼과 기존 원본 확대창 연결. 클릭/Enter/ESC/닫기 통과 |
| 손패 휠·드래그 | overflow-x만 있고 입력 변환/드래그 구분이 없었음 | 영역 안 세로 휠의 가로 이동, 6px 임계 드래그와 클릭 억제. 24장·영역 밖 휠·정상 클릭 검증 |
| 공격 유형 필터 | 실제 DB에 공격 역할 9장, 공격 유형 0장. SQL/분류 매핑 오류는 재현되지 않음 | 역할/유형 설명과 유형별 수 표시. 사용자 분류를 추정 변경하지 않음. 역할 19장/유형 2장/교집합 1장 회귀 통과 |

P1.1 당시 실제 사용자 DB는 읽기 전용으로만 집계했다. P1.1과 P2의 모든 변경 검증은 프로젝트 내부 격리 userData에서 수행했다.

## P2 구현과 설계

- 자원 템플릿, 캐릭터별 장착 인스턴스, 카드 공통 사용 방식/비용, 캐릭터별 비용 바인딩, 현재량, 영속 이벤트를 분리했다. 클래스 이름 조건 분기는 없다.
- `src/shared/resource-engine.ts`는 최대치·사용·회복·수동 변경을 순수 함수로 계산한다. 메인의 `electron/resource-store.ts`가 검증과 SQLite 트랜잭션을 담당한다. 렌더러는 범용 SQL/파일 IPC를 갖지 않는다.
- 카운터와 레벨별 일반 슬롯 트랙, 사용자 정의 단위, 고정/선택형 비용, 여러 사용 방식, 무소모, 다중 자원/공유 자원을 지원한다. 숫자는 정수이며 현재량은 0~최대치 범위로 제한한다.
- UI는 고정 최대치를 편집한다. 데이터 모델과 계산기는 레벨 표/능력치 수정치 규칙을 지원하며 임의 코드나 eval은 실행하지 않는다. 해당 규칙의 편집 UI·클래스 프리셋은 P3에 남겼다.
- 회복은 짧은 휴식/긴 휴식/새벽/수동의 명시 입력이다. 긴 휴식 전용 규칙을 우선하고, 없으면 짧은 휴식 규칙을 한 번 적용한다. 전량 또는 사용자 지정 정량을 지원한다. 슬롯 트랙 부분 회복은 레벨별 수동 변경으로 수행한다.
- 캐릭터 공유/카드 전용/아이템 소유 범위를 검증한다. 아이템 범위는 활성 아이템 카드 출처를 확인하고 같은 캐릭터의 카드들에 명시 연결한다.
- 장착 중인 템플릿은 복제 후 편집한다. 인스턴스 최대치 편집은 이미 소비한 양을 보존하고 다른 캐릭터를 바꾸지 않는다. 변경 전후 수량과 설정을 기록한다. 연결 해제는 보존형 삭제이며 기존 비용을 다른 자원에 자동 연결하지 않는다.
- 카드 선택·확대·비용 미리보기는 읽기 전용이다. **사용 확정**만 비용을 차감한다. 부족하면 전체 작업을 거부한다. 별도 확인하는 예외 사용은 비용을 전혀 차감하지 않고 예외 기록만 남긴다.
- 요청 UUID 원장 + 캐릭터 revision + 서버 재계산/견적 지문으로 재전송과 오래된 입력을 거부한다. UI에는 처리 중 잠금과 네이티브 더블클릭 억제를 적용했다.
- 사용/회복/수동 변경은 영속 기록을 역순으로 Undo한다. 다중 자원과 기록/중복 방지 원장까지 원자적으로 저장한다. Undo 자체를 다시 취소하지 않으며, 설정 변경이나 레거시 기록을 넘는 Undo는 거부한다.

상세 데이터 계약: [DATA_SCHEMA_P2.md](DATA_SCHEMA_P2.md). 구현 결정: [DECISIONS.md](DECISIONS.md).

## SQLite v3와 보존 검증

기존 v1/v2 마이그레이션을 변경하지 않고 v3를 추가했다. 자원 템플릿/인스턴스에 `archived_at`, 그리고 `resource_revisions`, `resource_requests`, `resource_undos` 테이블을 추가한다. 마이그레이션 전 `VACUUM INTO` 일관성 백업을 생성하고 스키마 변경은 한 트랜잭션으로 적용한다.

- 개발 모드에서 v1→v3, 패키징 EXE에서 **v2→v3**를 실행했다. 각각 이전 버전 백업 1개를 생성했다.
- 자동 테스트에서 v2 백업 파일의 `user_version=2`, 필터/환경 설정/이미지 파일/기존 자원 현재량 3의 보존과 시작 시 자동 회복 없음까지 확인했다.
- Windows 회귀에서 기존 카드/캐릭터/덱/태그 ID·비용 옵션·바인딩·기록을 확인했다. 원본 파일과 관리 복사본의 SHA-256을 비교했으며 교체/등록 해제된 원본도 유지했다.
- 최종 `PRAGMA integrity_check=ok`, `foreign_key_check=[]`. 지원하지 않는 미래 버전/인식 불가 데이터는 기존 보존 정책대로 거부하며 리셋하지 않는다.
- v3를 P1/P1.1 실행 파일로 다운그레이드해 열 수 없다. 실제 사용자 DB에 검수 데이터를 쓰거나 검수 목적으로 업그레이드하지 않았다.

## 품질 게이트

| 검사 | 결과 |
| --- | --- |
| ESLint `--max-warnings 0` | 통과, 경고 0 |
| TypeScript `--noEmit` | 통과 |
| Vitest | **7개 파일 / 67개 통과 / 실패 0** (P1.1 48개 + 자원 엔진 19개) |
| Vite + Electron main/preload 빌드 | 통과 |
| Windows x64 폴더 EXE 패키징 | 통과, 실제 실행 앱 버전 0.3.0 |
| Windows Vite 개발 모드 | P1/P1.1/P2 전체 시나리오 통과 |
| Windows 패키징 EXE | P1/P1.1/P2 전체 시나리오 통과 |
| renderer 예외 / Electron 보안 경고 | 각각 0 |

자원 자동 테스트는 정상 소비, 여러 카드의 공유 풀, 비용 합산, 부족 시 전체 거부, 동일 요청 재전송/변조·stale 요청, SQL 기록 실패 강제 주입 시 전체 롤백, 선택형 비용 범위·간격, 무료/예외 사용, 네 회복 조건과 우선순위, 최소/최대치, 연속 Undo와 상태 불일치 거부, 재시작, A/B 격리, 모듈 수명·소유 범위, 선언형 최대치, v2 마이그레이션을 검증한다. P3 표준/홈브루 시전 옵션은 **보존 후 실행 거부**를 검증했으며 시전 지원 완료를 의미하지 않는다.

Windows E2E에서는 20개 PNG/JPEG/WebP 파일을 실제 파일 입력과 드롭으로 등록했다. P1.1 검수 카드까지 최종 24장이다. 카드 2장의 공유 풀, 두 자원의 동시 차감/Undo, 실제 더블클릭, 부족/예외 사용, 네 회복 이벤트/Undo, 수동 증감/현재량 설정, A/B 동일 템플릿의 독립 인스턴스·바인딩·기록, 완전 종료/재시작의 스냅샷 일치, 동일 RPC의 동시 재전송, 소비량 보존 최대치 편집, 선택형 비용/무료 사용/복수 옵션, 삭제된 참조 거부와 원본 열람을 확인했다.

자원을 장착한 P2 화면에서도 1280×720 + Chromium 100/125/150% 배율에서 가로 넘침 없이 사용·휴식·원본 확대에 접근했다. 최종 EXE의 24장 손패 휠 응답은 관측 39ms다. 단일 환경의 관측값이며 성능 보증 수치가 아니다.

실행 증거: [개발 모드 JSON](docs/validation/p2-development.json), [EXE JSON](docs/validation/p2-packaged.json), [빌드/해시/품질 게이트](docs/validation/p2-build.json). 로컬 전체 검수 자료는 각 JSON의 artifacts 경로에 남겼다.

## 실행과 재현 명령

`release/win-unpacked/DnD TCG-fy.exe`를 실행한다. 해당 폴더 전체가 필요하며 개발 서버나 별도 Node 설치 없이 동작한다. 일반 데이터는 기존 `%APPDATA%\DnD TCG-fy`, 개발 데이터는 `%APPDATA%\DnD TCG-fy Development`를 유지한다.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run pack:win
node scripts/e2e.mjs --dev
$env:DND_TCG_EXECUTABLE = (Resolve-Path '.\release\win-unpacked\DnD TCG-fy.exe').Path
node scripts/e2e.mjs --from-v2
Remove-Item Env:DND_TCG_EXECUTABLE
```

이 환경에서는 npm 대신 `scripts/bootstrap-npm.ps1` 또는 설치된 도구의 Node 진입점을 사용했다. 실제 실행 명령은 `node node_modules/eslint/bin/eslint.js . --max-warnings 0`, `node node_modules/typescript/bin/tsc --noEmit`, `node scripts/test.mjs`, `node scripts/build.mjs`, `node node_modules/electron-builder/out/cli/cli.js --win --x64 --dir` 및 위 E2E 명령이다. 직접 electron-builder 실행 시 전역 npm이 없어 의존성 트리 탐색 방식으로 전환했으며 결과 EXE에서 Sharp native 이미지 가져오기까지 통과했다. 재현 시 부트스트랩의 `run pack:win`은 npm 경로도 제공한다.

빌드는 Zod 주석의 PURE 표식 2개를 Rollup이 제거한다는 기존 안내를 출력하며 성공했다. P2는 의존성을 추가/갱신하지 않았다. 이전 P1 감사의 런타임 0건, 전체 moderate 12건/high·critical 0건은 당시 결과이며 P2에서 새 보안 감사를 수행하지 않았다.

## 스크린샷

모두 패키징 EXE의 실제 화면 캡처다. 카드에는 삽화 대신 검수용 문자/테두리 이미지 파일을 사용했으며 사용자 삽화를 생성하거나 수정하지 않았다.

- [자원과 카드 중심 보드](docs/screenshots/p2-board.png)
- [부족 상태와 전체 비용 미리보기](docs/screenshots/p2-insufficient.png)
- [선택형 비용과 복수 사용 방식](docs/screenshots/p2-cost-editor.png)
- [별도 자원 관리](docs/screenshots/p2-resource-manager.png)
- [자원 사용 불가 상태에서도 원본 확대](docs/screenshots/p2-preview.png)
- [P2 150% 배율](docs/screenshots/p2-150pct.png)
- P1.1: [손패](docs/screenshots/p11-hand.png), [이미지 클릭 확대](docs/screenshots/p11-preview.png)

## 변경 파일과 다음 단계 위험

주요 변경은 `src/shared/resources.ts`, `resource-engine.ts`, `electron/resource-store.ts`, v3 마이그레이션·main/preload IPC, `ResourcePanel/ResourceManager/CardResources` 컴포넌트와 App/CSS, 자원 단위 테스트·Windows E2E다. 원본 네 계약 문서는 유지하고 보충 계약·README·이 보고서와 검수 자료를 추가했다.

P3에서는 다음을 먼저 설계·검증해야 한다. 이번 단계에는 추가하지 않았다.

1. 2014 단일 클래스의 검증된 레벨 표·출처·프리셋 버전 정책. 서브클래스 전체를 자동 지원한다고 가정하지 않는다.
2. 카드 공통 비용/사용 방식 변경이 여러 캐릭터의 바인딩에 미치는 영향. 지금은 공통 정보임을 안내하고 없는 연결을 거부한다. 프리셋 갱신 시 명시적 변경 검토가 필요하다.
3. 레벨·능력치 변경 시 최대치와 이미 소비한 양, 새로 생기거나 사라지는 슬롯 단계의 처리. 시작 시 자동 충전/리셋으로 해결하면 안 된다.
4. 일반 슬롯 트랙 비용과 주문의 표준/팩트/홈브루 시전 검증을 구분할 것. 업캐스팅·다운캐스팅·기본 주문 레벨을 검증한 뒤 실행 경로를 연결해야 한다.
5. 설정 변경은 현재 Undo 경계다. 향후 설정까지 되돌리려면 템플릿/바인딩/최대치 전체의 버전 복원이 필요하다. 이벤트·요청 원장의 장기 보존/용량 정책도 별도 설계가 필요하다.

검증 한계: 이 Windows 호스트에서 실행했으며 모든 Windows 10/11 빌드 조합, 실제 OS DPI 변경, 물리 네트워크 차단, NSIS 설치/제거/업그레이드, 코드 서명은 검수하지 않았다. 설치 배포는 기존 계획의 P5 범위다. 전투·명중·피해·턴·상태이상 자동화는 구현하지 않았다.
