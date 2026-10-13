/**
 * e-class(학교 학습관리, Moodle) 조회 — 로그인한 학생의 강의·과제·출석 현황을 **읽기만** 한다.
 *
 * 규칙
 *  - 이 파일은 읽기 전용이다. 강의 영상 보기(/mod/vod, /mod/ubvideo)·과제 제출·출석 처리가 일어날 수 있는 주소는 한 번도 열지 않는다
 *    (영상 페이지를 여는 것만으로 출석·진도가 기록될 수 있다). 열 수 있는 주소는 아래 safeReadPath 목록과 매개변수로만 제한된다.
 *  - 로그인 세션은 이 요청 안에서만 쓰고 버린다(저장하지 않는다). 평문 학번·비밀번호는 로그·오류·응답에 넣지 않는다.
 *  - 완료·출석을 추측하지 않는다: 읽지 못한 값은 unknown + 경고다.
 *  - 한 요청의 예산: 최대 요청 수·전체 시간·동시 요청 수를 둔다.
 *
 * 설계 메모: 팀이 먼저 만든 프로토타입은 e-class 로그인 세션 쿠키를 서버에 암호화해 8시간 보관했다. 여기서는 다른 학교 기능과 같이
 * "브라우저가 풀어서 보낸 계정으로 요청마다 로그인하고 바로 버린다"로 바꿨다(서버에 e-class 세션이 남지 않는다).
 */
import type { SchoolCredentials } from '../../shared/school/types.js';
import type { EclassSnapshot } from '../../shared/school/eclass.js';
import { SchoolAuthFailed, SchoolUnavailable } from './http.js';
import type { SchoolHttp, SchoolResponse } from './http.js';
import { createEclassParser } from './eclassParse.js';
import type { VodAttendanceRow } from './eclassParse.js';

export const ECLASS_MAX_COURSES = 12;
export const ECLASS_MAX_ITEMS = 160;
/** 알림에서 제외하는 강좌 (학교 공통 안내 강좌 등 — 수강 알림 대상이 아니다) */
const IGNORED_COURSE = /HSU\s*AI\s*활용\s*윤리\s*지침/i;
const MAX_REQUESTS = 64;
const BUDGET_MS = 40_000;
const CONCURRENCY = 4;

const SAFE_PATH =
  /^(?:\/|\/my\/?|\/local\/ubion\/user\/?|\/login\.php|\/login\/index\.php|\/course\/view\.php|\/mod\/assign\/index\.php|\/report\/ubcompletion\/(?:user_progress|user|progress|index)[a-z_]*\.php)$/;

/** 로그인 실패 화면에 보이는 문구 — 이게 있을 때만 "비밀번호가 맞지 않음"으로 단정한다(그 밖의 로그인 화면 변화는 "알 수 없음"). */
const LOGIN_ERROR_TEXT = /(?:잘못|일치하지|올바르지|확인해 주세요|확인하세요|invalid login|incorrect|failed)/i;

export type EclassFlowOptions = {
  /** 시험에서 시간을 고정할 때 */
  now?: () => number;
};

export function createEclassFlow(http: SchoolHttp, opts: EclassFlowOptions = {}) {
  const now = opts.now ?? Date.now;
  const origin = http.origin;
  const P = createEclassParser(origin);

  /** 읽기만 하는 주소인가 (경로 + 매개변수 모두) */
  function safeReadUrl(value: string): URL | null {
    const url = P.eclassUrl(value);
    if (!url || !SAFE_PATH.test(url.pathname)) return null;
    const allowed = new Set(['id', 'lang', 'testsession']);
    for (const [key, v] of url.searchParams) {
      if (!allowed.has(key)) return null;
      if (key === 'id' && !/^\d+$/.test(v)) return null;
    }
    return url;
  }

  class Budget {
    readonly deadline = now() + BUDGET_MS;
    requests = 0;
    private active = 0;
    private waiting: Array<() => void> = [];
    async acquire(): Promise<void> {
      if (this.active >= CONCURRENCY) await new Promise<void>((r) => this.waiting.push(r));
      else this.active++;
    }
    release(): void {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }

  const unavailable = (msg = 'e-class 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.') => new SchoolUnavailable(msg);

  /** 읽기 요청 한 번(리다이렉트는 한 단계씩 검사하며 따라간다). 로그인 화면이 돌아오면 세션이 없는 것이다. */
  async function read(budget: Budget, target: string, form?: [string, string][], purpose: 'login' | 'read' = 'read'): Promise<string> {
    await budget.acquire();
    try {
      let url = P.eclassUrl(target);
      if (!url) throw unavailable('e-class 주소를 확인하지 못해서 중단했어요.');
      if (!form && !safeReadUrl(url.href)) throw unavailable('e-class의 읽을 수 없는 주소라서 중단했어요.');
      if (form && !(purpose === 'login' && url.pathname === '/login/index.php')) throw unavailable('e-class 요청을 확인하지 못해서 중단했어요.');
      let body = form;
      for (let hop = 0; hop <= 5; hop++) {
        if (now() > budget.deadline || ++budget.requests > MAX_REQUESTS) {
          throw unavailable('e-class 조회 시간이 길어져 중단했어요. 잠시 후 새로고침해 주세요.');
        }
        const res: SchoolResponse = await http.request(url.href, {
          method: body ? 'POST' : 'GET',
          form: body,
          follow: false,
          encoding: 'utf-8',
          headers: { 'Accept-Language': 'ko-KR,ko;q=0.9', ...(body ? { Origin: origin, Referer: `${origin}/login.php?lang=ko` } : {}) },
        });
        if (res.status >= 300 && res.status < 400 && res.location) {
          const next = P.eclassUrl(res.location, url.href);
          // 307/308 은 본문(비밀번호)을 그대로 다시 보내므로 따라가지 않는다.
          if (!next || (body && (res.status === 307 || res.status === 308)) || !safeReadUrl(next.href)) {
            throw unavailable(`e-class가 허용되지 않은 주소(${next?.pathname ?? '알 수 없음'})로 이동시켜 중단했어요.`);
          }
          url = next;
          body = undefined;
          continue;
        }
        if (res.status === 401 || res.status === 403) throw unavailable('e-class 접근이 거절됐어요. 잠시 후 다시 시도해 주세요.');
        if (res.status >= 400) throw unavailable(`e-class가 ${res.status} 응답을 돌려줬어요.`);
        if (purpose !== 'login' && P.hasLoginForm(res.text)) throw unavailable('e-class 로그인 세션이 확인되지 않았어요. 다시 시도해 주세요.');
        return res.text;
      }
      throw unavailable('e-class의 이동이 반복돼서 중단했어요.');
    } finally {
      budget.release();
    }
  }

  async function mapLimited<T, R>(values: T[], fn: (v: T) => Promise<R>): Promise<R[]> {
    let cursor = 0;
    const out: R[] = new Array(values.length);
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, values.length) }, async () => {
        while (cursor < values.length) {
          const i = cursor++;
          out[i] = await fn(values[i]);
        }
      }),
    );
    return out;
  }

  /**
   * e-class 로그인. 학교 계정이 틀렸다는 **분명한 증거**(로그인 화면이 다시 나오면서 오류 문구가 있음)가 있을 때만
   * SchoolAuthFailed 를 던진다 — 이 오류는 학교 로그인 실패 가드(연속 5회 30분)에 세어지므로, 화면이 바뀐 것 같은
   * 애매한 경우는 SchoolUnavailable 로 알려 계정이 잠기는 일이 없게 한다.
   */
  async function login(creds: SchoolCredentials): Promise<Budget> {
    const budget = new Budget();
    const first = await read(budget, `${origin}/login.php?lang=ko`, undefined, 'login');
    const form = P.parseLoginForm(first);
    if (!form) throw unavailable('e-class 로그인 화면이 바뀌어서 연결을 확인하지 못했어요. 학교 사이트에서 직접 확인해 주세요.');
    form.fields.set('username', creds.studentId);
    form.fields.set('password', creds.password);
    const page = await read(budget, form.action, [...form.fields.entries()], 'login');
    if (P.hasLoginForm(page)) {
      if (LOGIN_ERROR_TEXT.test(page)) throw new SchoolAuthFailed();
      throw unavailable('e-class 로그인을 확인하지 못했어요. 학교 포털에서 로그인이 되는지 먼저 확인해 주세요.');
    }
    if (!P.isAuthenticatedPage(page)) {
      throw unavailable('e-class 로그인을 확인하지 못했어요. 학교 사이트에서 추가 인증이 필요한지 확인해 주세요.');
    }
    return budget;
  }

  /** 읽기 실패 이유를 화면에 보여 줄 짧은 문구로 (학교 응답 본문은 담지 않는다) */
  const reasonOf = (err: unknown) => (err instanceof SchoolUnavailable ? err.message : '연결 오류');

  /**
   * 로그인한 뒤 강의·과제 현황을 모은다 (한성대 e-class 화면 구조를 따른다 — eclassParse.ts 머리말 참고).
   * 강좌마다: 온라인 출석부(_a) · 강의 목록(강좌 페이지) · 과제 목록(/mod/assign/index.php)을 읽고,
   * 출석부를 못 읽거나 커뮤니티 강좌면 학습 진도 표(user_progress.php)로 대신한다.
   */
  async function snapshot(budget: Budget): Promise<EclassSnapshot> {
    const warnings = new Set<string>();
    const home = await read(budget, `${origin}/`);
    let parsed = P.parseCourses(home);
    if (!parsed.recognized) parsed = P.parseCourses(await read(budget, `${origin}/local/ubion/user/`));
    if (!parsed.recognized) throw unavailable('e-class 강좌 목록의 형식을 확인하지 못했어요. 학교 사이트에서 확인해 주세요.');
    const courses = parsed.courses.filter((c) => !IGNORED_COURSE.test(c.name)).slice(0, ECLASS_MAX_COURSES);
    if (parsed.courses.filter((c) => !IGNORED_COURSE.test(c.name)).length > ECLASS_MAX_COURSES) warnings.add(`강좌가 많아 처음 ${ECLASS_MAX_COURSES}개 강좌만 확인했어요. 나머지는 e-class에서 확인해 주세요.`);

    let failedCourses = 0;
    const perCourse = await mapLimited(courses, async (course) => {
      const url = (path: string) => `${origin}${path}?id=${course.id}`;
      const attendanceRead = course.community
        ? Promise.resolve(null)
        : read(budget, url('/report/ubcompletion/user_progress_a.php')).then((html) => ({ html, rows: P.parseAttendancePage(html) }));
      const [viewRes, attendanceRes, assignRes] = await Promise.allSettled([
        read(budget, course.url),
        attendanceRead,
        read(budget, url('/mod/assign/index.php')),
      ]);

      // 출석 자료: 출석부(_a)가 우선, 안 되면 학습 진도 표(user_progress.php)
      let attendance: VodAttendanceRow[] | null = null;
      let attendanceFail = '';
      // 출석부 표는 읽었는데 출석 대상 강의 줄이 하나도 없는 경우(주차 칸만 비어 있음) — 출석을 따지는 강의가 없는 강좌다
      const attendanceTableEmpty =
        attendanceRes.status === 'fulfilled' && !!attendanceRes.value?.rows && attendanceRes.value.rows.length === 0;
      if (attendanceRes.status === 'fulfilled' && attendanceRes.value?.rows && attendanceRes.value.rows.length > 0) {
        attendance = attendanceRes.value.rows;
      } else if (attendanceRes.status === 'rejected') {
        attendanceFail = reasonOf(attendanceRes.reason);
      } else if (attendanceRes.value) {
        attendanceFail = attendanceRes.value.rows
          ? `출석부에서 읽을 수 있는 줄이 없어요 [${P.describeAttendanceRows(attendanceRes.value.html)}]`
          : `출석부 표 형식을 읽지 못했어요 [${P.describeTables(attendanceRes.value.html)}]`;
      }
      let progressTried = false;
      const loadProgress = async (): Promise<VodAttendanceRow[] | null> => {
        progressTried = true;
        try {
          const rows = P.parseProgressPage(await read(budget, url('/report/ubcompletion/user_progress.php')));
          if (!rows || rows.length === 0) attendanceFail = attendanceFail || '학습 진도 표에서 읽을 수 있는 줄이 없어요';
          return rows && rows.length > 0 ? rows : null;
        } catch (err) {
          attendanceFail = attendanceFail || reasonOf(err);
          return null;
        }
      };
      if (!attendance && viewRes.status === 'fulfilled') attendance = await loadProgress();
      if (!attendance && attendanceTableEmpty) {
        attendance = [];
        attendanceFail = '';
      }

      const items = [];
      let anyOk = false;
      if (viewRes.status === 'fulfilled') {
        const list = P.parseVodList(viewRes.value);
        if (list.recognized) {
          anyOk = true;
          let lectures = P.mergeLectures(course, list.vods, attendance, now());
          // 출석부와 제목이 하나도 안 맞으면 학습 진도 표로 한 번 더 맞춰 본다
          if (list.vods.length > 0 && attendance && attendance.length > 0 && lectures.length === 0 && !progressTried) {
            const alt = await loadProgress();
            if (alt) {
              const second = P.mergeLectures(course, list.vods, alt, now());
              if (second.length > 0) {
                attendance = alt;
                lectures = second;
              }
            }
          }
          items.push(...lectures);
          if (list.vods.length > 0 && attendance && attendance.length > 0 && lectures.length === 0) {
            warnings.add(
              `${course.name}: 강의 목록과 출석부를 맞추지 못했어요 (강의 ${list.vods.length}개 / 출석 ${attendance.length}개, 예: "${list.vods[0].title.slice(0, 14)}" ↔ "${attendance[0].title.slice(0, 14)}")`,
            );
          }
        } else {
          warnings.add(`${course.name}: 강좌 페이지의 강의 목록 형식을 읽지 못했어요.`);
        }
      } else {
        warnings.add(`${course.name}: 강좌 페이지를 불러오지 못했어요 (${reasonOf(viewRes.reason)})`);
      }
      // 출석 표시만으로 다 판단된 경우에는 출석부를 못 읽어도 알리지 않는다
      if (viewRes.status === 'fulfilled' && !attendance && items.some((i) => i.kind === 'lecture' && i.completion === 'unknown')) {
        warnings.add(`${course.name}: 온라인 출석부를 읽지 못했어요 (${attendanceFail || '출석부 없음'})`);
      }
      if (assignRes.status === 'fulfilled') {
        const list = P.parseAssignList(assignRes.value);
        if (list.recognized) {
          anyOk = true;
          items.push(...P.mergeAssignments(course, list.assignments));
        } else {
          warnings.add(`${course.name}: 과제 목록 형식을 읽지 못했어요${list.note ? ` ("${list.note}")` : ''}.`);
        }
      } else {
        warnings.add(`${course.name}: 과제 목록을 불러오지 못했어요 (${reasonOf(assignRes.reason)})`);
      }
      if (!anyOk) failedCourses++;
      return items;
    });
    if (courses.length > 0 && failedCourses === courses.length) {
      throw unavailable('e-class 강좌 정보를 불러오지 못했어요. 잠시 후 새로고침해 주세요.');
    }

    const seenIds = new Set<string>();
    const all = perCourse
      .flat()
      .filter((i) => !IGNORED_COURSE.test(i.title) && !IGNORED_COURSE.test(i.courseName))
      .filter((i) => (seenIds.has(`${i.courseId}:${i.id}`) ? false : (seenIds.add(`${i.courseId}:${i.id}`), true)));
    if (all.length > ECLASS_MAX_ITEMS) warnings.add(`학습 항목이 많아 처음 ${ECLASS_MAX_ITEMS}개만 표시해요. 나머지는 e-class에서 확인해 주세요.`);
    const items = all.slice(0, ECLASS_MAX_ITEMS);
    if (items.some((i) => i.completion === 'unknown')) warnings.add('완료 여부를 확인하지 못한 항목은 "확인 필요"로 표시해요.');

    return { items, courseCount: courses.length - failedCourses, syncedAt: new Date(now()).toISOString(), warnings: [...warnings] };
  }

  return { login, snapshot, safeReadUrl };
}

export type EclassFlow = ReturnType<typeof createEclassFlow>;
