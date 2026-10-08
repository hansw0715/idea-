/**
 * 기능 스위치. 라운지(미팅·밥약·단톡방·관리자)는 코드는 모두 있지만 이번 배포에서는 숨긴다.
 * 다시 켜려면 true 로 바꾸고 빌드한다 — 탭, 라우트, 내 정보·홈의 라운지 구역이 한꺼번에 나타난다.
 * (서버의 /api/lounge 는 로그인한 사용자만 쓸 수 있어 켜져 있어도 화면에서 닿지 않는다)
 */
export const LOUNGE_ENABLED = true;

/**
 * 학교 메일 인증코드로 가입하는 옛 방식(pages/SignupEmail.tsx, 서버 EMAIL_SIGNUP_ENABLED=1)은 코드만 남기고 꺼 둔다.
 * 지금 가입은 학교 계정(학번·포털 비밀번호)으로 학생 인증을 한 뒤 플랫폼 아이디·비밀번호를 만드는 방식이다.
 * 다시 쓰려면 클라이언트 이 값과 서버 환경변수를 함께 켠다.
 */
export const EMAIL_SIGNUP_ENABLED = false;
