# 구현 결정

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
