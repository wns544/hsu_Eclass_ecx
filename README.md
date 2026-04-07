https://chromewebstore.google.com/detail/hsu-ecx/adecpjfkagjglfmpljgbijdfhhlikmfi

# hsu_ecx_CustomedForMe

한성 e-class 확장 프로그램을 내 환경에 맞게 수정한 버전입니다.

## 이번 커스텀 변경

- Windows 환경에서도 `build`, `export`가 동작하도록 빌드 스크립트를 정리했습니다.
- 강의 목록에서 영상 진행 바가 `시청 / 실제 길이` 기준으로 보이도록 바꿨습니다.
- `출석 기준` 시간은 별도 배지로 분리해서 보이도록 바꿨습니다.
- 학교 페이지에 표시되는 실제 영상 길이(`span.text-info`)를 읽어서 확장 UI에 반영합니다.
- 사이드패널에서도 `시청 / 실제 길이 / 출석 기준` 순서로 확인할 수 있게 맞췄습니다.
- 깨지던 한글 문구를 정리했습니다.

## 실행 방법

1. 프로젝트 루트에서 `npm install`
2. 필요할 때 `npm run build`
3. 크롬에서 `chrome://extensions` 열기
4. 개발자 모드 켜기
5. `압축해제된 확장 프로그램 로드` 클릭
6. 이 프로젝트의 `dist` 폴더 선택

코드를 수정하지 않았다면 PC를 다시 켠 뒤에도 다시 빌드할 필요는 없습니다.

## 다른 PC에서 사용

- 가장 간단한 방법은 이 프로젝트 폴더를 그대로 옮긴 뒤 `dist` 폴더를 크롬에 로드하는 것입니다.
- 다른 PC에서 계속 수정할 예정이면 `npm install` 후 `npm run build`를 다시 한 번 실행하면 됩니다.

## 참고

- 현재 작업 브랜치: `wns544_Customed`
- 원격 저장소: `https://github.com/wns544/hsu_Eclass_ecx.git`
