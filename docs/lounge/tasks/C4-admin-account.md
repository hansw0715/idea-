> **셔틀버스 기능은 사용자 지시로 삭제되었다.** 셔틀 시트·기사 화면·노선도·`/bus/driver` 라우트는 만들지 않는다.

# 작업 C4 — 관리자 · 내 정보의 라운지 영역 · 홈의 "내 라운지 약속"

`docs/lounge/tasks/00-client-common.md` → `docs/lounge/00-overview.md` → `docs/lounge/01-contract.md`(§6) 를 읽는다. 원본(ZIP, 읽기 전용): `ROOT\.tmp\reference\idea-zip\src\components\{admin\ReportsAdmin,admin\StatsAdmin,admin\AdminTabs,BlockList}.tsx`. 기능은 옮기되 화면은 KRDS 모바일로 새로 짠다.

## 담당 파일
```
client/src/lounge/AdminPage.tsx           (자리표시를 채운다; 라우트 /admin)
client/src/lounge/admin/ReportsTab.tsx  admin/StatsTab.tsx
client/src/lounge/account/LoungeProfileCard.tsx   (새로) 내 정보용 라운지 프로필 카드
client/src/pages/Account.tsx              라운지·학교 연동 구역을 **삽입만** 한다 (아래 참고)
client/src/pages/Dashboard.tsx            "내 라운지 약속" 구역을 **삽입만** 한다
client/src/pages/account.css  client/src/pages/home.css   (삽입한 구역의 스타일만, 접두사 lounge-acct-/lounge-home-)
client/src/lounge/admin.css               (접두사 lounge-admin-)
```

## 체크리스트
**AdminPage** (ZIP admin) — `useLounge().isAdmin` 이 아니면 "관리자만 볼 수 있어요" `EmptyState` (서버도 막는다)
- [ ] `Tabs`: **신고** · **통계**. 신고(`loungeApi.adminReports()`): 상태 필터(처리 대기/전체), 카드: 사유 배지·맥락(미팅/밥약/채팅/프로필)·자세한 내용·신고자 → 대상(닉네임·온도·경고·정지 여부)·"이 사람에 대한 열린 신고 N건"·시각, 동작 4종: **조치 완료**(resolve) · **반려**(dismiss) · **이용 정지**(ban) · **정지 해제**(unban — 안내: 경고도 0 이 되고 이 사람에 대한 열린 신고가 모두 정리돼요), 각 동작 `useConfirm`, 처리 후 목록 갱신·토스트, 빈 상태.
- [ ] 통계(`loungeApi.adminStats()`): 요약 4칸(프로필 만든 사용자·평균 매너온도·정지 수·노쇼율 + 분모 설명), 기능별 표(미팅/밥약/팀빌딩: 전체·모집 중·종료·참여) — 모바일 폭에서 표가 넘치면 카드/`dl` 로. 숫자만이 아니라 해석 문장 한 줄.

**내 정보 (Account.tsx)** — 파일 전체를 다시 쓰지 말고 **구역만 삽입**한다(다른 작업자가 같은 파일을 고치지 않는다. 학교 연동 카드도 여기에 넣는다):
- [ ] `LoungeProfileCard`: 아바타(lg)·닉네임·단과대·학번, 매너온도(숫자+단계+얼굴), 경고 `n/2`, 정지 상태면 사유 `Alert`, "프로필 고치기"(`openProfileSheet`), 프로필이 없으면 "라운지 프로필 만들기" CTA(Secondary).
- [ ] 목록 행 추가: "차단한 사용자"(→ `BlockListSheet`), 관리자면 "관리자 화면"(→ `/admin`).
- [ ] 학교 계정 구역: `import SchoolLinkCard from '../school/SchoolLinkCard'` 를 프로필 카드 아래에 `<SchoolLinkCard />` 로 넣는다(C5 가 구현).
- [ ] 기존 로그아웃·글자 설정·회원 탈퇴 동작은 그대로 유지(회귀 금지).

**홈 (Dashboard.tsx)** — "내 라운지 약속" 구역 삽입: `loungeApi.mine()` 가까운 3건(`GatheringListItem` 재사용 또는 간단 행), 눌러 `/lounge` 로 이동("라운지에서 보기"), 프로필이 없으면 한 줄 안내+라운지로 가는 버튼, 비어 있으면 "아직 약속이 없어요 + 라운지 가기", 로딩·오류가 홈의 다른 구역을 막지 않음(독립 로딩). 기존 홈 구역·순서 유지(예약 → 회의 → **라운지 약속** → 시간표).

## 확인 시나리오
① admin1 로 관리자 화면: demo 사용자 3명이 한 사용자를 신고 → 자동 정지 → 처리 4종 ② 일반 사용자의 /admin 접근 ③ 내 정보 영역·홈 구역 캡처(프로필 있음/없음, 정지 상태) ④ 360/390·글자 150%·선명한 화면, 키보드 Tab, 가로 넘침·콘솔 오류 없음.
