# 작업 A — 로그인 · 회원가입 · 내 정보

## 담당 파일 (이것만 쓴다)
- `client/src/pages/Login.tsx`, `client/src/pages/Signup.tsx`, `client/src/pages/Account.tsx` (현재는 자리표시 stub — 덮어쓴다)
- `client/src/pages/auth.css`, `client/src/pages/account.css` (필요하면)

## cody 원본 (읽기 전용)
`cody/client/src/pages/Login.tsx`, `Signup.tsx`, `Account.tsx`, 그리고 `cody/client/src/App.tsx` 의 TopNav(로그아웃이 여기 있었다), `cody/server/auth.ts` (API 계약·오류 메시지·검증 규칙 확인용)

## 기능 유지 체크리스트
**로그인**
- [ ] 아이디 칸: 학번 또는 이메일 입력 (`type="text"`, autoComplete username), "@hansung.ac.kr 은 생략해도 됩니다" 안내
- [ ] 비밀번호 입력 (보기/숨기기 → `PasswordField`)
- [ ] `POST /auth/login {email, password}` → `setUser(user)` → 홈으로 이동. 실패 시 서버 메시지 표시, 입력값 보존, 제출 중 버튼 비활성+문구 변경
- [ ] "아직 계정이 없나요? 회원가입" 링크
**회원가입 (2단계)**
- [ ] 1단계: 이메일 앞부분만 입력(`@`·공백 제거) + 고정 접미 `@hansung.ac.kr`, 비어 있으면 제출 불가, `POST /auth/request-code {email}`
- [ ] 2단계 진입: "{email} 으로 인증코드를 보냈습니다. 10분 안에 입력해 주세요." 안내, 코드 칸에 자동 포커스
- [ ] 인증코드: 숫자만 6자리 (`inputMode="numeric"`, `autoComplete="one-time-code"`), 남은 시간 mm:ss 카운트다운, 0 이 되면 "만료됨" 표시, "코드 다시 받기"
- [ ] 이름(2자 이상), 비밀번호(8자 이상), 비밀번호 확인 — 불일치 시 "비밀번호가 서로 일치하지 않습니다." (제출 전 클라이언트 검사)
- [ ] `POST /auth/signup {email, name, password, code}` → `setUser` → 홈. 실패 시 서버 메시지
- [ ] "이메일 다시 입력" (1단계로 복귀, 코드·메시지 초기화)
- [ ] 단계 표시기(`Stepper`: 이메일 확인 → 정보 입력), "이미 계정이 있나요? 로그인" 링크
**내 정보**
- [ ] 가입 정보: 이름, 학교 이메일, 관리자 배지(`user.isAdmin`)
- [ ] **로그아웃** (새로 이 화면에 둔다 — 모바일에는 상단 로그아웃 버튼이 없다): `POST /auth/logout` 실패해도 무시하고 `setUser(null)` → `/login`
- [ ] 글자·화면 설정 열기 행 (`useDisplay().openSettings()`)
- [ ] 회원 탈퇴: 관리자는 불가 안내 문구(원문 의미 유지). 일반 계정은 영향 안내("시간표·회의 참여 기록·예약이 모두 삭제되고 되돌릴 수 없음, 내가 만든 회의는 가장 먼저 참여한 사람에게 넘어가고 아무도 없으면 회의도 사라짐") → "회원 탈퇴" 누르면 폼 펼침: 비밀번호 + 확인 문구 `탈퇴합니다` 그대로 입력해야 활성 → `DELETE /auth/me {password}` → `setUser(null)` → `/login` (replace). 취소 시 입력 초기화. 실패 시 서버 메시지, 처리 중 상태

## 모바일 설계 방향
- 로그인/가입은 탭바 없는 한 컬럼. `<AppHeader />`(서비스 이름 + 글자·화면 설정) 아래에 화면 제목(`h1.page-title` 명사형: "로그인", "회원가입")과 한 줄 안내. 안내문에 아직 없는 기능(밥 약속·소개팅)을 쓰지 않는다.
- 입력은 `TextField`/`PasswordField` (`size="lg"` 권장 — 인증 화면은 큰 입력). 제출 버튼은 `Button size="lg" block type="submit"`, 하단에 붙이지 않고 폼 흐름 안에 둔다(키보드가 올라와도 가려지지 않게).
- KRDS "개인 식별 정보 입력" 패턴: 이메일·이름을 받는 이유를 `help` 로 평문 안내 ("학교 이메일은 한성대학교 재학생 확인과 로그인에 사용합니다."). 필수 항목은 `required`.
- 오류는 `Alert tone="danger"` 를 폼 위에, 필드 단위 오류는 해당 `TextField error`. 제출 실패 시 첫 오류 칸으로 포커스.
- 인증코드 남은 시간은 `aria-live="polite"` 로 1분 단위/만료 시에만 알린다 (매초 읽히지 않게). 시각 표시는 매초 갱신해도 된다.
- 내 정보는 상단에 프로필 요약 카드(이름·이메일·배지), 그 아래 `.list` 행(글자·화면 설정), 로그아웃 `Button variant="tertiary" block`, 맨 아래 "회원 탈퇴" 구역(위험 동작이므로 시각적으로 분리, 평소엔 접힘). Primary 버튼은 이 화면에 두지 않는다.
- 비밀번호 칸은 붙여넣기·브라우저 자동완성을 막지 않는다. `autoComplete` 속성을 정확히 (`username`, `current-password`, `new-password`).

## 보고서 스키마
공통 지침의 JSON 스키마를 따른다.
