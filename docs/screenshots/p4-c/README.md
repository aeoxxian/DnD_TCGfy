# P4-C 검수 화면

실제 Windows Electron 콘텐츠 캡처 19장. 변경 전은 P4-B 0.5.1 EXE, 변경 후는 P4-C 0.5.2 EXE다. 사용자 데이터에서 읽기 복사한 실제 카드 이미지를 격리된 검수 DB에 등록했다. 실사용 카드·원본 파일은 수정하지 않았다.

| 장면 | 화면 |
| --- | --- |
| 등록 전후 | [기존 등록](before-registration.png) · [새 등록 정보](after-registration-main.png) · [같은 등록 창의 비용 설정](after-registration-rules.png) |
| 확대 전후 | [기존 원본 보기](before-enlargement.png) · [이미지만 표시하는 새 확대](after-enlargement.png) |
| 복수 비용·사용 방식 | [등록 중 고급 규칙](registration-advanced.png) |
| 저장 오류 | [비용 연결 실패 후 전체 롤백 및 재시도](registration-rollback.png) |
| 디자인 비교 | [현재](design-current.png) · [A](design-direction-a.png) · [B](design-direction-b.png) |
| 관리 화면 디자인 비교 | [현재](design-current-management.png) · [A](design-direction-a-management.png) · [B](design-direction-b-management.png) |
| 1920×1080 / 앱별 100% | [확대](enlargement-1920x1080-1.png) |
| 1366×768 / 앱별 100% | [확대](enlargement-1366x768-1.png) |
| 1920×1080 / 앱별 125% | [확대](enlargement-1920x1080-1.25.png) |
| 1366×768 / 앱별 125% | [확대](enlargement-1366x768-1.25.png) |
| 1920×1080 / 앱별 150% | [확대](enlargement-1920x1080-1.5.png) |
| 1366×768 / 앱별 150% | [확대](enlargement-1366x768-1.5.png) |

디자인 비교는 같은 1366×768/100% 창, 실제 이미지 8장으로 구성한 검수 덱, 같은 선택 카드·자원 상태다. A/B는 `docs/design/` CSS를 검수 창에 일시 삽입한 시안이며 제품에 적용하거나 패키징하지 않았다. 상세 장단점은 프로젝트 루트 `P4_C_DESIGN_PROPOSALS.md`를 참고한다.

등록/사용 검수에는 기존 사용자의 비용·레벨·캐릭터 상태를 가져오지 않고 별도의 테스트 메타데이터를 지정했다. 이미지 자체의 색상·비율·원본 해상도는 변경하지 않았다.

배율은 Windows 프로세스의 `--force-device-scale-factor=1/1.25/1.5`와 네이티브 창 콘텐츠 크기로 검증했다. 전역 Windows 배율·모니터 설정을 변경한 검수는 아니다. 정수 DIP 반올림이 포함되며 실제 이미지/뷰포트 치수는 `docs/validation/p4-c-packaged.json`에 기록했다.
