# UI 디테일 개선 — 2026-10-25

- 홈은 토·일요일에 다음 주부터 열리고, 이전·다음·이번 주로 이동한다. 선택한 주의 응답만 표시해 일회성 일정·예약이 다른 주에 섞이지 않는다. 시간표 바로 가기도 선택한 주를 전달한다.
- 학교에서 확인한 미완료 강의·과제 중 가까운 마감을 한국 날짜 기준으로 요약한다. 완료 여부가 불명확한 항목은 숫자에 넣지 않고 확인 필요로 표시한다. 마지막 조회 시각과 항목별 바로 가기를 유지한다.
- 모바일 공지·일정·회의 제목은 두 줄까지 표시하며 공지 날짜는 다음 줄로 분리한다. 학사 탭은 세로 넘침과 스크롤바 없이 키보드 좌우 이동을 유지한다.
- 빈 회의 화면에서 만들기와 코드 참가를 함께 제공한다.
- 친구 요청·추가·시간표·회의 초대는 내 정보 → 친구(`/account/friends`)로 이동한다. 라운지의 모집 상태는 테두리 배지 대신 점·텍스트로 표현한다.
- 모션은 눌림 120ms, 탭 표시 이동 240ms, 색상 변경 160ms로 제한한다. 진입 애니메이션이나 반복 장식 모션은 추가하지 않는다. 모션 감소 설정과 키보드 포커스 표시를 유지한다.

## 앱 아이콘

사용자가 제공한 부기 정면·측면 이미지를 참조해 기본 내장 imagegen으로 생성했다. 생성 결과는 프로젝트의 `client/public/brand/app-icon-1024.png`에 보관한다. 동일 원본에서 64/180/192/512px PNG와 여백 있는 Android maskable 아이콘을 만들었다. 매니페스트, 파비콘, Apple touch icon, 기본 알림 아이콘, 앱 헤더에 연결했다. 기존 설치 앱의 아이콘 반영 시점은 OS의 앱 업데이트 주기에 따른다.

### 최종 생성 프롬프트 (기본 내장 도구)

Create ONE finished square 1024x1024 app icon asset for a Hansung University campus app. Reference image shows the official turtle mascot Bugi from three views: preserve its identity very closely: navy blue round hood, white round face, small black dot eyes, distinctive little curled forehead tuft, soft pale blue cheeks, friendly w-shaped mouth, light blue turtle shell just visible on one side. A recognizable simplified head-and-shoulders portrait, front facing, centered, large friendly face. Refined Apple-like app-icon craftsmanship: understated softly sculpted matte ceramic/plastic forms, precise smooth silhouette, subtle dimensional bevels, very restrained soft top-left light, small crisp facial features. Strong deep university blue and pure white, pale blue shell/cheeks only. Background full bleed soft porcelain white, with extremely faint cool blue ambient shading. Mascot occupies central 68-72% square with comfortable all-side safe margin, centered vertically. Outer canvas square edge to edge, no rounded-square mask drawn into image, no external drop shadow, no mockup/device. No lettering (omit HSU), no badges, no extra objects, no sparkles, no glass, no busy gradients. Deliver only the actual app icon image, not a presentation sheet.

## 검증

### 라운지 통합 추가 수정

- 주요 메뉴는 홈·시간표·라운지·학사 알림·내 정보로 구성한다. 라운지 모임 탭에는 밥약·미팅·회의를 동일한 큰 카드로 제공한다. 회의 카드는 `/lounge/meetings` 목록으로 이어지고 기존 `/meetings` 진입 경로와 만들기/참가 요청도 이어진다.
- 라운지에는 모임·채팅 두 탭을 둔다. 채팅 목록은 `/api/lounge/rooms`에서 기간 제한 없이 실제 참여자의 열린 방만 가져온다. 기존 방 읽기 권한과 같은 기준이며 종료한 방은 대화 기록으로 표시한다. 신청만 했거나 떠난 방은 노출하지 않는다.
- 시간표의 선택 탭은 배경 면만 사용하고 겹치던 파란 밑줄은 제거한다. 생성 완료 토스트는 작은 둥근 패널에 체크와 닫기 버튼을 표시한다. 일반 안내는 정보 아이콘을 사용한다.
- 추가 검증: 채팅 권한·지난 방 포함 등 관련 서버 테스트 78개와 화면 검사 103건 통과. 실제 로컬 계정에서도 라운지 회의 목록과 채팅 빈 상태를 확인했다.

- 기존·신규 로직 테스트 833개 통과. 주말·연도 경계와 한국 시간 자정 전후 마감 계산을 포함한다.
- 브라우저 화면 검사 82건 통과. 375/390/768/844/1440px, 확대 글자, 모션 감소, 다크 모드, 팝업 저장, 주 이동, 친구 화면, 공지 넘침, 강의·과제 직접 이동을 확인했다.
- 화면 검증에는 별도 테스트 계정과 fixture를 사용하며 실제 학교 계정으로 신청·수강·제출 작업은 수행하지 않는다.

## 홈 통합 알림과 메뉴 표시

- 홈은 모든 화면 크기에서 주간 일정 → 알림 → 강의·과제 → 학교 소식 순서다. 상단 바로가기와 개별 시설 예약·회의·라운지 요약 패널은 제거했다. 시설 예약 패널의 옅은 파란 배경은 통합 알림에 사용한다.
- 통합 알림은 앞으로의 예약, 회의 참여/인원 변화, 라운지 약속, 친구 요청/수락, 밥 초대, 회의 초대와 채팅 소식을 모은다. 공지와 강의·과제는 각각의 홈 섹션에 유지한다.
- 웹 푸시를 켜지 않은 사용자도 새 요청/초대를 볼 수 있도록 `lounge_notifications`에 보관한다. 본인 전용 조회이며 프로필 연동 전에도 회의 초대는 볼 수 있다. 과거에 저장하지 않았던 푸시 내용은 복원하지 않는다.
- 메뉴 아이콘 오른쪽 위에 작은 파란 점으로 미확인 변경을 표시한다. 동일 데이터를 재조회한 것으로 새 점을 만들지 않는다. 공지는 공지 탭, 강의는 강의·과제 탭, 친구 요청은 친구 화면, 채팅은 해당 방에 들어가면 확인 처리한다. 홈은 알림 선택 또는 ‘모두 확인’으로 처리한다.
- 확인 상태는 이 기기의 계정별 저장소에 기록한다. API는 화면 이동·다시 활성화 및 60초 간격으로 갱신하고 백그라운드에서는 멈춘다. 학교 수강 데이터는 기존에 사용자가 조회한 캐시만 활용하며 학교에 자동 로그인하지 않는다.
- 최종 검증: 전체 40개 파일, 837개 테스트 통과. 화면 검사 103건 및 확인 상태 새로고침/새 공지 표시를 포함한 추가 15건 통과. 타입 검사와 빌드 통과.
- 검증 중 기존 회원가입 테스트에서 서명의 끝에서 두 번째 문자를 바꾸면서 마지막 문자로 비교해 원문과 같은 값이 생성될 수 있는 문제를 발견했다. 실제 변경 대상 문자와 비교하도록 테스트 한 줄을 수정했다. 인증 로직은 변경하지 않았다.

## 알림 항목 분리와 라운지 상세 통일

- 알림 패널의 파란 배경 안에서 각 항목을 별도의 배경 면과 간격으로 구분한다. 약속·예약은 날짜·요일·시작 시간과 예약 종료 시간까지 표시한다. 회의는 예정된 예약 일시를 사용하고 아직 잡힌 시간이 없으면 ‘일정 미정’을 표시한다. 날짜를 알 수 없는 친구 요청 등은 ‘받은 시각’으로 명시해 약속 시각과 혼동하지 않게 한다. 표시는 한국 시간 기준이다.
- 라운지의 세 카드 모두 같은 페이지 탐색으로 동작한다: 밥약 `/lounge/meal`, 미팅 `/lounge/meetup`, 회의 `/lounge/meetings`. 미팅 목록·내 약속·홈 알림에서 모임을 선택하면 `/lounge/gatherings/:id` 상세 페이지로 이동한다. 진입한 목록에 맞는 상단 뒤로가기를 제공한다.
- 상세는 동일한 헤더·본문 패널·버튼 틀을 사용한다. 목록과 상세의 모집 상태는 점과 텍스트로 통일한다. 만들기·신고·프로필 확인 같은 보조 작업은 기존 공통 시트를 유지한다. 위치 권한은 사용자가 밥약 시작을 눌렀을 때만 요청한다.
- 모집 중인 미팅과 내 약속은 각각 떨어진 회색 카드로 표시한다. 제목·일시·장소·참여 인원 배치는 유지한다.
- 검증: 알림 분류/실제 예약 날짜/한국 시간 경계 테스트 3개, 화면 검사 117건 통과. 밥약·미팅 상세가 모달 없이 열리고 원래 목록으로 돌아오는 동작을 확인했다. 타입 검사·빌드 통과.

## 예약 참여자와 홈 프로필 표시

- 화면 모드의 ‘기기 설정’ 이름을 ‘자동’으로 바꿨다.
- 회의 참여자 칩과 시간표 범례에서 ‘제외됨’ 문구를 제거했다. 참여 토글의 `aria-pressed`와 회색 상태는 유지한다. 방장은 테두리 배지 대신 이름 옆의 작은 텍스트로 표시한다.
- 홈 오른쪽 위의 고정 부기 삽화는 본인이 선택한 프로필 이미지로 교체했다. 공통 Avatar 컴포넌트를 사용해 저장된 선택과 이전 이미지 키의 호환 처리를 동일하게 적용한다.
- 검증: 변경 사항을 포함한 화면 검사 18건, 타입 검사·빌드 통과. 로컬 미리보기를 다시 실행하고 실제 로그인 계정의 홈 프로필을 확인했다.
