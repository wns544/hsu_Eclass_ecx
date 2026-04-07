https://chromewebstore.google.com/detail/hsu-ecx/adecpjfkagjglfmpljgbijdfhhlikmfi

# hsu_ecx_CustomedForMe

한성대 e-class용 크롬 확장 프로그램의 커스텀 작업본입니다.

현재 브랜치 기준 핵심 목표는 기존 편의 기능은 그대로 유지하면서, 별도 `직접다운` 버튼으로 HLS 강의를 원클릭 MP4 다운로드까지 가져가는 것입니다.

## 현재 주요 기능

### 강의 목록 보조 버튼

각 영상 강의 항목에 아래 버튼이 추가되어 있습니다.

- `열기`: `viewer.php`를 새 탭으로 엽니다.
- `복사`: `viewer.php` 주소를 복사합니다.
- `다운로드`: FetchV 같은 외부 다운로드 확장을 쓰기 좋은 helper 경로입니다.
- `직접다운`: 우리 확장 내부에서 직접 HLS를 잡아 MP4 다운로드를 시도합니다.

중요:

- `열기 / 복사 / 다운로드`는 유지 대상입니다.
- `직접다운`은 별도의 실험 기능이며 기존 `다운로드`와 합치지 않습니다.

### 강의 진행 정보 표시

강의 목록과 확장 UI에서 아래 정보를 더 정확히 보여줍니다.

- 시청 시간
- 실제 영상 길이
- 출석 기준 시간
- 남은 시청 필요 시간

### 직접다운 상태 UI

`직접다운` 실행 시 아래 상태 UI가 동작합니다.

- 강의 목록의 `직접다운` 옆 상태 배지
  - `대기중 / 캡처중 / 분석중 / 다운로드중 / 저장중 / 완료 / 실패`
- 확장 아이콘 배지 숫자
  - 현재 진행 중인 직접다운 작업 수 표시
- 확장 팝업
  - 진행 중 작업과 최근 완료 작업 목록
  - 과목명, 영상명, 진행률, 수집 크기 표시
- 진행상황 전용 탭
  - 직접다운 작업을 한 곳에 모아 보여주는 단일 탭
  - 새 작업이 생겨도 새 탭을 계속 만들지 않고 기존 탭을 재사용

## 직접다운 현재 구조

사이트 특성상 영상 viewer를 여러 개 동시에 오래 재생하면 다중 접속 팝업이 뜨며 한쪽이 중단될 수 있습니다.

그래서 현재 직접다운은 아래 구조를 사용합니다.

1. 사용자가 `직접다운` 버튼을 여러 개 눌러 작업을 예약
2. 숨은 viewer 탭이 한 번에 하나씩만 열려 실제 `m3u8`를 캡처
3. 캡처가 끝나면 viewer 탭은 바로 닫힘
4. 실제 HLS 다운로드와 remux는 background/offscreen 쪽에서 계속 진행
5. 결과 파일은 MP4로 저장

즉, "캡처는 순차", "실제 다운로드는 병렬" 구조입니다.

## 직접다운 구현 상태

현재 확인된 상태:

- HLS `m3u8` 감지 가능
- segment 다운로드 가능
- TS 기반 HLS는 `mux.js`로 MP4 remux 가능
- 파일은 실제 `.mp4`로 저장 가능
- 여러 작업을 연속으로 걸어둘 수 있음
- 진행상황 탭과 팝업에서 현재 상태를 확인 가능

최근 추가된 점:

- `동영상출석` 꼬리 제거된 파일명 저장
- 확장 아이콘 배지 숫자 표시
- 단일 진행상황 탭 재사용
- 다중 다운로드 중 진행 카드 순서 고정
  - 진행 중 목록은 생성 순서대로 유지되어 위아래로 흔들리지 않음

## 현재 한계 / 주의점

- 크롬 기본 다운로드 UI에는 "최종 저장 단계"부터만 항목이 잡힙니다.
  - 그 전 단계의 진행률은 우리 확장 팝업/진행상황 탭에서 확인해야 합니다.
- 암호화된 HLS는 아직 지원하지 않습니다.
- 확장 프로그램이 중간에 다시 로드되면 진행 중 작업은 실패 처리됩니다.
- viewer에서 자동 재생/스트림 감지가 안 되는 특수 케이스는 추가 보강이 필요할 수 있습니다.

## 개발 및 빌드

1. 프로젝트 루트에서 `npm install`
2. `npm run build`
3. 크롬에서 `chrome://extensions` 열기
4. 개발자 모드 켜기
5. `압축해제된 확장 프로그램을 로드합니다` 클릭
6. 이 프로젝트의 `dist` 폴더 선택

유용한 명령:

- `npm run check`
- `npm run build`
- `npm run export`

## 현재 직접다운 관련 주요 파일

- `src/content_scripts/progress/video.ts`
- `src/content_scripts/viewer/index.ts`
- `src/service_worker/index.ts`
- `src/offscreen/index.ts`
- `src/shared/direct-download-state.ts`
- `src/shared/direct-download-dashboard.ts`
- `src/shared/direct-download-store.ts`
- `src/popup/index.ts`
- `src/direct_downloads/index.ts`
- `app/manifest.dev.json`
- `app/manifest.prod.json`

## 브랜치 / 원격

- working branch: `wns544_Customed`
- remote: `https://github.com/wns544/hsu_Eclass_ecx.git`
