# v1.2 Phase 3 보고서 — 네 테마 재질·장식부 리디자인 (디자인 검수용 시안)

- 기준: Phase 2 `ad74657` → 브랜치 `feat/v1.2-phase3`
- 범위: [V1_2_PLAN.md](V1_2_PLAN.md)의 Phase 3. SQLite·IPC·설정 형식 변경 없음, 앱 버전 1.1.0 유지.
- 상태: **구현·자동 검증 완료, 사용자 디자인 검수 대기.** 지시서대로 이 결과는 **검수용 시안**이며 승인 전에는 최종 테마로 확정하지 않는다. Phase 4(책갈피·회복 버튼)는 승인 전까지 시작하지 않는다.

## 1. 무엇이 바뀌었나

변경 전에는 네 테마가 같은 가죽 질감, 같은 금/은 덩굴 모서리 틀, 같은 양피지·가죽 장부를 쓰고 **색만** 달랐다. 이제 테마마다 재질 질감, 보드 프레임 장식부, 장부·카드 페이지 모서리, 상단 버튼 테두리, 대화상자 바탕이 각각 다르다.

| | 적갈 가죽 | 흑단과 은 | 숲의 펠트 | 아케인 블루 (구 ‘심연의 남색’) |
| --- | --- | --- | --- | --- |
| 바탕 재질 | 적갈색 가죽(기존 결) | 흑단 나뭇결(곧은 결·가는 기공) | 짙은 녹색 펠트(미세 섬유, 무광) | 어두운 청회색 석재(입자·광물 맥·풍화 홈) |
| 프레임 장식부 | 가죽 띠 + 이중 새들 스티치, 테두리 중앙 리벳 | 나무에 평평하게 박은 은 상감선 3줄(모서리에서 맞춤) | 펠트 테 + 러닝 스티치 + 무광 청동 가는 띠 | 석재 테두리 턱(돋을새김) + 발광 음각 홈 |
| 코너 장식부 | 망치로 두드린 두꺼운 L자 황동 보호대 + 둥근 리벳 3개 | 정교한 은 필리그리(S자 덩굴·끝 소용돌이·잎) + 흑옥 마름모 | 참나무 잎·도토리 무광 청동, 압정 2개로 고정 | 석재를 깎은 모서리 블록 + 음각 원·내원·마름모·눈금, 은은한 하늘빛 발광(금속 없음) |
| 장부·카드 페이지 | 가죽 표지 + 양피지(찢긴 가장자리) + 리벳 보호대 모서리 | 흑단 표지 + 매끈한 카드 종이 + 은 상감 테두리·필리그리 | 펠트 표지 + 종이 문서 + 청동 사진 모서리 집게 | **어두운 석판**(밝은 글자) + 발광 음각 모서리 꺾쇠, 양피지·가죽 없음 |
| 상단 버튼 | 가죽 + 두꺼운 금속 테(위 반사·아래 그늘) + 양쪽 리벳 | 나무 + 은 실선 1줄 + 양쪽 은 마름모 | 펠트 + 무광 청동 테 + 안쪽 바느질 솔기(둥근 모서리) | 석재 블록 + 안쪽에 새긴 발광 음각선 |
| 금속 판(IN PLAY 등) | 금 | 은 | 무광 청동 | 석재에 박힌 발광 글자 |
| 대화상자 | 가죽 머리띠 + 양피지 | 흑단 머리띠 + 종이 | 펠트 머리띠 + 종이 | 석재 머리띠 + 밝은 석판(어두운 글자) |

- **조형 언어 차이(금속 세 테마):** 적갈 가죽은 두껍고 투박한 L자 판과 리벳(실용·보강), 흑단과 은은 얇은 선과 소용돌이 필리그리(세공·상감), 숲의 펠트는 잎·도토리 같은 자연물 형태를 압정으로 고정(무광·수수함). 금속 종류만 다른 같은 모양이 아니라 실루엣·내부 디테일·표면(망치 자국/광택/무광 풍화)·결합 방식(리벳/상감/압정)이 모두 다르다.
- **용어:** 문서와 주석은 프레임 장식부·코너 장식부·금속 장식부·음각 장식부로 정리했다. 코드의 CSS 변수 이름(`--m*` 등)은 대규모 변경을 피하려고 그대로 두었다(아케인 블루에서는 이 변수가 금속이 아니라 음각 발광색을 뜻한다).
- **크기·배치:** 레이아웃은 그대로다. 상단 버튼은 테두리를 실제 border가 아닌 안쪽 그림자로 그려서 네 테마 모두 v1.1과 같은 크기·클릭 영역이다(화면 배율에서 1px 테두리가 반올림되어 크기가 달라지는 문제를 피함).
- **이름:** ‘심연의 남색’ → **‘아케인 블루’**. 저장되는 테마 값은 `abyss` 그대로라 기존 설정이 그대로 이어진다.
- **에셋:** `scripts/design/materials_v12.py`(질감)와 `scripts/design/frames_v12.mjs`(장식부, SVG를 sharp로 2× 래스터화)로 직접 생성했다. 외부 이미지·폰트를 쓰지 않아 라이선스 문제가 없다. 카드 이미지와 사용자 에셋은 건드리지 않았다.

## 2. 테마별 변경 전후

같은 데이터(`repository-data` 사본), 1366×768, 100%, 카드 1장 선택. 화면은 이 PC의 150% 디스플레이 배율로 저장되었다.

### 적갈 가죽
| | 변경 전 | 변경 후 |
| --- | --- | --- |
| 전체 보드 | ![](docs/screenshots/v1.2-p3/before-oxblood-board.png) | ![](docs/screenshots/v1.2-p3/after-oxblood-board.png) |
| 프레임·코너 | ![](docs/screenshots/v1.2-p3/before-oxblood-corner.png) | ![](docs/screenshots/v1.2-p3/after-oxblood-corner.png) |
| 상단 버튼(기본) | ![](docs/screenshots/v1.2-p3/before-oxblood-buttons.png) | ![](docs/screenshots/v1.2-p3/after-oxblood-buttons.png) |
| 상단 버튼(‘관리’ 호버) | ![](docs/screenshots/v1.2-p3/before-oxblood-buttons-hover.png) | ![](docs/screenshots/v1.2-p3/after-oxblood-buttons-hover.png) |
| 자원 장부 | ![](docs/screenshots/v1.2-p3/before-oxblood-ledger.png) | ![](docs/screenshots/v1.2-p3/after-oxblood-ledger.png) |
| 카드 세부사항 | ![](docs/screenshots/v1.2-p3/before-oxblood-detail.png) | ![](docs/screenshots/v1.2-p3/after-oxblood-detail.png) |

### 흑단과 은
| | 변경 전 | 변경 후 |
| --- | --- | --- |
| 전체 보드 | ![](docs/screenshots/v1.2-p3/before-ebony-board.png) | ![](docs/screenshots/v1.2-p3/after-ebony-board.png) |
| 프레임·코너 | ![](docs/screenshots/v1.2-p3/before-ebony-corner.png) | ![](docs/screenshots/v1.2-p3/after-ebony-corner.png) |
| 상단 버튼(기본) | ![](docs/screenshots/v1.2-p3/before-ebony-buttons.png) | ![](docs/screenshots/v1.2-p3/after-ebony-buttons.png) |
| 상단 버튼(‘관리’ 호버) | ![](docs/screenshots/v1.2-p3/before-ebony-buttons-hover.png) | ![](docs/screenshots/v1.2-p3/after-ebony-buttons-hover.png) |
| 자원 장부 | ![](docs/screenshots/v1.2-p3/before-ebony-ledger.png) | ![](docs/screenshots/v1.2-p3/after-ebony-ledger.png) |
| 카드 세부사항 | ![](docs/screenshots/v1.2-p3/before-ebony-detail.png) | ![](docs/screenshots/v1.2-p3/after-ebony-detail.png) |

### 숲의 펠트
| | 변경 전 | 변경 후 |
| --- | --- | --- |
| 전체 보드 | ![](docs/screenshots/v1.2-p3/before-verdant-board.png) | ![](docs/screenshots/v1.2-p3/after-verdant-board.png) |
| 프레임·코너 | ![](docs/screenshots/v1.2-p3/before-verdant-corner.png) | ![](docs/screenshots/v1.2-p3/after-verdant-corner.png) |
| 상단 버튼(기본) | ![](docs/screenshots/v1.2-p3/before-verdant-buttons.png) | ![](docs/screenshots/v1.2-p3/after-verdant-buttons.png) |
| 상단 버튼(‘관리’ 호버) | ![](docs/screenshots/v1.2-p3/before-verdant-buttons-hover.png) | ![](docs/screenshots/v1.2-p3/after-verdant-buttons-hover.png) |
| 자원 장부 | ![](docs/screenshots/v1.2-p3/before-verdant-ledger.png) | ![](docs/screenshots/v1.2-p3/after-verdant-ledger.png) |
| 카드 세부사항 | ![](docs/screenshots/v1.2-p3/before-verdant-detail.png) | ![](docs/screenshots/v1.2-p3/after-verdant-detail.png) |

### 아케인 블루 (구 심연의 남색)
| | 변경 전 | 변경 후 |
| --- | --- | --- |
| 전체 보드 | ![](docs/screenshots/v1.2-p3/before-abyss-board.png) | ![](docs/screenshots/v1.2-p3/after-abyss-board.png) |
| 프레임·코너 | ![](docs/screenshots/v1.2-p3/before-abyss-corner.png) | ![](docs/screenshots/v1.2-p3/after-abyss-corner.png) |
| 상단 버튼(기본) | ![](docs/screenshots/v1.2-p3/before-abyss-buttons.png) | ![](docs/screenshots/v1.2-p3/after-abyss-buttons.png) |
| 상단 버튼(‘관리’ 호버) | ![](docs/screenshots/v1.2-p3/before-abyss-buttons-hover.png) | ![](docs/screenshots/v1.2-p3/after-abyss-buttons-hover.png) |
| 자원 장부 | ![](docs/screenshots/v1.2-p3/before-abyss-ledger.png) | ![](docs/screenshots/v1.2-p3/after-abyss-ledger.png) |
| 카드 세부사항 | ![](docs/screenshots/v1.2-p3/before-abyss-detail.png) | ![](docs/screenshots/v1.2-p3/after-abyss-detail.png) |

### 테마 선택·대화상자(변경 후)
| 적갈 가죽 | 흑단과 은 | 숲의 펠트 | 아케인 블루 |
| --- | --- | --- | --- |
| ![](docs/screenshots/v1.2-p3/after-oxblood-theme-menu.png) | ![](docs/screenshots/v1.2-p3/after-ebony-theme-menu.png) | ![](docs/screenshots/v1.2-p3/after-verdant-theme-menu.png) | ![](docs/screenshots/v1.2-p3/after-abyss-theme-menu.png) |
| ![](docs/screenshots/v1.2-p3/after-oxblood-dialog.png) | ![](docs/screenshots/v1.2-p3/after-ebony-dialog.png) | ![](docs/screenshots/v1.2-p3/after-verdant-dialog.png) | ![](docs/screenshots/v1.2-p3/after-abyss-dialog.png) |

상단 머리 띠 비교: [적갈](docs/screenshots/v1.2-p3/after-oxblood-header.png) · [흑단](docs/screenshots/v1.2-p3/after-ebony-header.png) · [펠트](docs/screenshots/v1.2-p3/after-verdant-header.png) · [아케인](docs/screenshots/v1.2-p3/after-abyss-header.png)

## 3. 검증

### 지시서 필수 검증 항목

| 항목 | 확인 | 결과 |
| --- | --- | --- |
| 네 테마의 소재 차이가 명확한가 | 재질 질감 4종이 서로 다름(가죽/나무/펠트/석재), E2E가 각 테마의 질감 파일을 확인 | 통과(자동) · **디자인 판단은 검수 대기** |
| 금속 장식 테마 세 종류의 형태가 구별되는가 | 프레임·코너·페이지 모서리 이미지가 4종 모두 서로 다른 파일, 형태는 1절 표 | 통과(자동) · **검수 대기** |
| 아케인 블루에 금속 장식이 남아 있지 않은가 | 프레임·페이지 모서리·상단 버튼·IN PLAY 판·덱 수 표시·이름판 고리를 석재/발광 음각으로 바꿈. E2E가 금속 장식 이미지 미사용을 확인 | 통과 · **단 회복 버튼 4개(은빛 동전)와 책갈피 리본은 Phase 4 범위라 그대로** |
| 아케인 블루의 자원 장부·카드 세부사항이 모두 석재인가 | 두 페이지 배경이 석재 질감이고 양피지·종이·가죽 없음(E2E) | 통과 |
| 펠트와 흑단에 가죽 질감이 남아 있지 않은가 | 상단 바·이름판·버튼·장부 표지·보드·페이지·필터 탭의 배경에 가죽 질감 없음(E2E) | 통과 |
| 적갈 가죽은 기존 정체성을 유지하는가 | 같은 가죽·양피지·금속 색. 모서리가 리벳 보호대로, 테두리가 스티치로 바뀜 | **검수 대기** |
| 텍스트와 버튼의 가독성 | 장부·카드 페이지 글자와 상단 버튼 글자의 명암비 7.69:1 이상(전 테마, WCAG 4.5:1 기준) | 통과 |
| 원본 카드 이미지와 시각적으로 경쟁하지 않는가 | 장식은 테두리·모서리에만 있고 발광은 낮은 세기(“은은한”). 카드 이미지는 `object-fit: contain`, 파일 해시 동일 | 통과(자동) · **검수 대기** |
| 테마 전환 및 설정 저장 | 테마 메뉴로 네 테마 전환, 재시작 후 아케인 블루 유지, 상단 버튼이 각 창을 엶 | 통과 |
| Windows 패키징 EXE에서 모든 에셋 표시 | 아래 실행 환경별 표 | 통과 |

`scripts/v12-p3-e2e.mjs` 6개 검사: ① 테마별 재질·프레임·페이지 장식·대화상자 바탕이 각자의 파일이고 모두 실제로 로드됨 ② 펠트·흑단·아케인 블루에 가죽 없음, 아케인 블루 페이지는 석재·금속 장식 이미지 없음 ③ 명암비 ≥4.5:1 ④ 상단 버튼 4개 크기가 네 테마에서 동일, 호버·누름·비활성 상태 변화 ⑤ 이름·저장·재시작·버튼 동작 ⑥ 카드 이미지 바이트 동일, 125%·150%에서 가로 넘침 없음.

명암비(최소/주요): 적갈 가죽 7.69(세부 속성) ~ 12.73, 흑단 8.15 ~ 13.59, 펠트 8.15 ~ 13.48, 아케인 블루 7.96 ~ 12.30. 상단 버튼 글자 10.76 ~ 13.59.

### 실행 환경별

| 환경 | Phase 3 E2E |
| --- | --- |
| 빌드 번들(`dist/`) | 6/6 통과 |
| Windows 개발 모드(Vite `--dev`) | 6/6 통과 |
| 패키징 EXE(`release/win-unpacked/DnD TCG-fy.exe`, `npm run pack:win`) | 6/6 통과(모든 테마 에셋이 EXE 안에서 로드됨) |

회귀·품질 게이트:

- `npm run lint` 통과(경고 0), `npm run typecheck` 통과, `npm test` **469/469 통과**(`tests/p11.test.tsx`·`tests/P4BUI.test.tsx`는 이전과 같이 이 PC의 Node 22.20에서 로드되지 않음).
- 기존 E2E(빌드 번들): 메인 38개 PASS, v1.2 Phase 1(9)·Phase 2(7), v1.1 Phase 1(8)·2(9)·3(11)·4(9, 주문 슬롯 색상·커서 포함), P4-A, P4-B, P4-C, P5(6) 모두 통과. 메인 E2E는 패키징 EXE에서도 38개 PASS.
- Phase 2 E2E는 전체 회귀 중 한 번 실패했다(150% 배율에서 확대 카드 여는 애니메이션이 끝나기 전에 포인터를 움직여 기울임이 시작되지 않음 — 앱은 애니메이션 중 기울이지 않는 것이 정상). 단독 실행에서는 통과했고, 검사가 애니메이션 종료를 기다리도록 고친 뒤 패키징 EXE에서 7/7 통과했다.
- 패키징은 첫 시도에 성공했다.

## 4. 미검증·제한·검수 요청

- **디자인 승인:** 자동 검사는 “서로 다르다·로드된다·읽힌다”까지만 확인한다. 재질감·조형의 완성도, 테마 정체성은 사용자 검수가 필요하다. 승인 전에는 이 디자인을 확정하지 않는다.
- **Phase 4 범위로 남긴 것:** 자원 장부 아래 회복 버튼(동전 모양)과 카드 페이지 책갈피 리본은 지시서상 Phase 4에서 테마별로 바꾼다. 그래서 아케인 블루에도 지금은 은빛 동전과 리본이 남아 있다. 사용 확정 밀랍 인장은 이번 지시서 범위 밖이라 그대로다.
- 상단 앱 로고(금속 문장 이미지)는 아케인 블루에서 회색조·발광 필터로 처리했다. 별도 석재 로고는 만들지 않았다.
- `frame-gold.png`·`frame-silver.png`(v1.1 프레임)는 더 이상 쓰지 않지만 파일은 남겨 두었다(승인 후 정리 가능).
- 실제 Windows 디스플레이 배율 설정 화면은 Chromium 배율로만 확인했다(**미검증**). NSIS 설치 파일은 만들지 않았다(**미검증**).
- Phase 2 커밋(`ad74657`)의 `scripts/v12-p2-e2e.mjs`에 사용하지 않는 변수 하나로 린트 오류가 있었다(테스트 스크립트, 앱 코드 아님). Phase 2 마무리 때 E2E 추가 뒤 린트를 다시 돌리지 않아 놓쳤고, 이번에 고쳐 린트를 통과시켰다.
