# DnD TCG-fy · P0

D&D 행동 선택지를 TCG 손패로 살펴보는 Windows 오프라인 데스크톱 앱입니다. 현재는 **P0 실행 가능한 골격**입니다. 카드 등록, 필터, 캐릭터/덱 편집, 자원 소비와 휴식은 아직 구현하지 않았습니다. 화면의 4장은 원본 이미지가 없는 임시 샘플이며 DB에 저장되지 않습니다.

## 바로 실행

Windows x64 배포용 폴더를 빌드했다면 `release/win-unpacked/DnD TCG-fy.exe`를 실행합니다. 이 폴더의 다른 파일도 필요하므로 exe만 따로 옮기지 마세요. Node.js나 개발 서버 없이 실행됩니다.

## 개발 환경

- Windows 10/11 x64, Node.js **24.x LTS**, npm 11.x 이상.
- 최초 의존성 설치와 최초 패키징 도구 다운로드에 인터넷이 필요합니다. 설치된 앱의 실행에는 인터넷이 필요하지 않습니다.
- 프로젝트 폴더: 이 README와 `package.json`이 있는 디렉터리.
- `package-lock.json`에 의존성을 고정했습니다. `npm ci`는 사용자 DB/이미지 폴더를 삭제하지 않습니다.

```powershell
cd C:\Users\HIKI\Desktop\DnD_TCG-FY\DnD_TCGfy_v1_0_Codex_Handoff
npm ci
npm run dev
```

개발 명령은 Vite를 `127.0.0.1:5173`에서 띄우고 Electron 창을 엽니다. React/CSS 변경은 개발 화면에 반영됩니다. 메인/preload 변경은 개발 명령을 다시 실행하세요. 창을 닫으면 개발 서버도 종료됩니다.

Node.js는 있지만 npm 명령이 없는 환경에서는 제공한 로컬 부트스트랩을 사용할 수 있습니다. npm 11.6.2를 프로젝트 `.tools`에만 내려받습니다.

```powershell
.\scripts\bootstrap-npm.ps1 ci --cache .tools/npm-cache
.\scripts\bootstrap-npm.ps1 run dev
```

아래 모든 `npm ...` 명령도 같은 방식으로 `.\scripts\bootstrap-npm.ps1 ...`로 대체할 수 있습니다. Electron 바이너리는 `postinstall`에서 공식 배포본을 설치합니다. 설치 도중 다운로드에 실패했다면 네트워크 복구 후 `node node_modules/electron/install.js`로 재시도하세요. 사용자 데이터를 지우거나 초기화할 필요가 없습니다.

## 빌드와 검증

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

`npm start`는 빌드된 로컬 번들을 엽니다. Vite 서버 없이도 실행됩니다.

```powershell
npm run test:e2e
node scripts/e2e.mjs --dev
npm run pack:win
$env:DND_TCG_EXECUTABLE = (Resolve-Path '.\release\win-unpacked\DnD TCG-fy.exe').Path
npm run test:e2e
Remove-Item Env:DND_TCG_EXECUTABLE
```

E2E는 실제 Electron 창을 열고 닫으며 샘플 카드, 보안 설정, 잘못된 IPC 입력, 설정 저장/재시작, 화면 크기, 오프라인 동작을 검사합니다. 개발 모드 E2E는 로컬 개발 서버를 사용하므로 offline 재로딩만 생략합니다. 테스트 산출물은 `artifacts/e2e-*/`의 PNG와 `result.json`입니다. 데이터는 실행별 테스트 경로에 격리하며 기존 테스트 결과도 삭제하지 않습니다.

125%/150% 검사는 Electron의 Chromium 확대를 사용합니다. 실제 Windows 디스플레이 배율 설정을 바꾼 DPI 검수와는 구별합니다. OS의 네트워크 어댑터를 끄는 대신 Chromium offline 및 앱의 외부 요청 차단을 검사합니다.

Windows NSIS 설치형 빌드 명령:

```powershell
npm run dist:win
```

예상 산출물: `release/DnD-TCG-fy-Setup-0.1.0-x64.exe`. 설치·제거와 업그레이드 후 사용자 데이터 유지 검수는 P5 범위입니다. 코드 서명은 설정하지 않았습니다.

## 현재 조작

- 카드를 클릭해 오른쪽에서 확대하고, 같은 카드를 다시 클릭하거나 `ESC`/닫기를 눌러 선택을 해제합니다.
- 손패/격자, 자원 패널 접기, 환경 설정의 모션 줄이기는 SQLite에 저장됩니다.
- 선택에는 자원 차감이 없습니다. P0의 사용 버튼은 비활성화되어 있습니다.
- 기본 화면은 한국어의 중립 다크 테마입니다. 키보드 포커스와 OS의 모션 감소 설정을 지원합니다.

## 데이터 보존과 보안

배포 기본 위치: `%APPDATA%\DnD TCG-fy\`, 개발 기본 위치: `%APPDATA%\DnD TCG-fy Development\`. 실제 기준은 Electron `app.getPath('userData')`입니다.

```text
userData/
  data/app.sqlite3       # SQLite 도메인 테이블, 설정, 마이그레이션 이력
  data/app.sqlite3-wal   # 앱 실행 중 존재할 수 있는 SQLite 저널
  data/app.sqlite3-shm
  assets/               # P1부터 원본 이미지 복사본 저장
  backups/              # 기존 DB 마이그레이션 전 일관성 백업
  chromium/             # Electron 로컬 세션 캐시
```

DB/이미지는 설치 폴더와 분리합니다. SQLite는 foreign keys ON, WAL, synchronous FULL 및 트랜잭션을 사용합니다. 지원하지 않는 새 버전 DB, 인식 불가 DB, 잘못된 설정을 만나면 오류를 알리고 원본을 유지합니다. 자동 리셋하지 않습니다. 마이그레이션 백업은 `backups/before-v*-to-v*-<uuid>.sqlite3`에 남습니다. ZIP 내보내기/복원 UI는 P5에서 구현합니다.

E2E의 `DND_TCG_TEST_USER_DATA`는 테스트 프로세스에서만 명시적으로 설정하는 절대 경로입니다. 패키지 E2E도 같은 방식으로 격리합니다. 일반 사용에서는 설정할 필요가 없습니다.

렌더러는 Node/파일/DB에 접근하지 못합니다. preload는 초기 화면 읽기와 환경 설정 저장 함수 두 개만 노출합니다. 메인은 요청 프레임과 런타임 스키마를 검증합니다. `contextIsolation`, sandbox, webSecurity를 유지하고 Node integration, 새 창, 외부 이동, 권한 요청을 차단합니다. 배포 번들은 `app://bundle/`에서 읽으며 외부 연결과 원격 스크립트를 허용하지 않습니다.

## 파일 안내와 다음 단계

- `src/App.tsx`, `src/styles.css`: 카드 중심 3패널 보드.
- `src/shared/`: 카드/설정 런타임 계약 및 메모리 샘플.
- `electron/`: 메인, preload, IPC 보안, SQLite 저장과 버전 마이그레이션.
- `scripts/`: 개발, 빌드, Windows E2E, npm 부트스트랩.
- `tests/`: 저장/호환성/트랜잭션/보안/UI 회귀 테스트.
- `DECISIONS.md`: 범위와 기술 결정, 명세의 표기 해석.
- `TEST_REPORT.md`: 실제 검증 결과와 제한 사항.

다음 단계는 P1: 원본 이미지 바이트를 유지하는 카드 등록과 필터, 메타데이터 저장, 캐릭터별 덱입니다. 자원 소비·회복·업캐스팅·다운캐스팅·Undo 테스트는 해당 엔진을 구현하는 P2~P4에서 추가합니다. 전투 판정 자동화는 제품 범위에 포함하지 않습니다.
