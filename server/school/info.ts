/**
 * 개인 포털 `info.hansung.ac.kr` — 로그인 · 내 정보 · 개인시간표.
 * 원본: .tmp/reference/school-py/hansung_info (1).py, hansung_timetable (1).py
 *
 * 규칙
 *  - 로그인은 한 번만 시도하고, 실패하면 곧바로 SchoolAuthFailed. 재시도하지 않는다 (재시도는 호출하는 쪽도 하지 않는다).
 *  - 평문(학번·비밀번호)은 로그인 요청 본문에만 실리고, 오류·로그에는 어디에도 넣지 않는다.
 *  - 학교 응답 본문은 오류 메시지에 넣지 않는다.
 */
import type { SchoolCredentials } from '../../shared/school/types.js';
import { SchoolAuthFailed, SchoolUnavailable } from './http.js';
import type { SchoolHttp, SchoolResponse } from './http.js';
import { parseProfile, parseTimetable } from './parse.js';
import type { ParsedProfile, ParsedTimetable } from './parse.js';

/** 로그인 판정 쿠키 (성공했을 때만 생긴다) */
const SSO_COOKIE = 'ssotoken';

/** 점검·차단(4xx/5xx)이면 비밀번호 판정이 아니므로 "실패 1회"로 세지 않는다 */
function assertReachable(res: SchoolResponse): void {
  if (res.status >= 400) throw new SchoolUnavailable();
}

/**
 * 로그인. 성공 = `ssotoken` 쿠키가 생김 (302 → /h_dae/dae_main.html). 실패 = 302 → `/` 에 쿠키 없음.
 * 비밀번호를 보내기 전에 첫 화면(JSESSIONID)부터 받아 오므로, 학교가 응답하지 않으면 비밀번호는 나가지 않는다.
 */
export async function loginInfo(http: SchoolHttp, creds: SchoolCredentials): Promise<void> {
  assertReachable(await http.get('/'));
  const res = await http.post(
    '/servlet/s_gong.gong_login_ssl',
    [
      ['changePass', ''],
      ['return_url', 'null'],
      ['id', creds.studentId],
      ['passwd', creds.password],
    ],
    { headers: { Referer: http.url('/'), Origin: http.origin }, follow: false },
  );
  assertReachable(res);
  if (!http.hasCookie(SSO_COOKIE)) throw new SchoolAuthFailed();
}

/** 내 정보 (학번·이름·학과). 화면 구조가 달라졌거나 세션이 유효하지 않으면 SchoolUnavailable */
export async function fetchProfile(http: SchoolHttp): Promise<ParsedProfile> {
  const res = await http.get('/jsp_21/index.jsp', { encoding: 'euc-kr' });
  assertReachable(res);
  const profile = parseProfile(res.text);
  if (!profile) throw new SchoolUnavailable('학교 포털에서 내 정보를 읽지 못했어요. 화면 구조가 바뀌었을 수 있어요.');
  return profile;
}

/** 개인시간표. FullCalendar 이벤트 JSON 을 수업 목록으로 (JSON 이 아니면 SchoolUnavailable) */
export async function fetchTimetable(http: SchoolHttp, studentId: string): Promise<ParsedTimetable> {
  const res = await http.post(
    '/jsp_21/student/kyomu/dae_sigan_main_data.jsp',
    [['as_hakbun', studentId]],
    { headers: { Referer: http.url('/jsp_21/student/kyomu/dae_h_siganpyo.jsp') }, encoding: 'euc-kr' },
  );
  assertReachable(res);
  const parsed = parseTimetable(res.text);
  if (!parsed) throw new SchoolUnavailable('학교 포털에서 시간표를 읽지 못했어요. 응답 형식이 바뀌었을 수 있어요.');
  return parsed;
}
