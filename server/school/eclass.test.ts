/**
 * e-class 조회 단위 테스트 — 가짜 e-class(고정 HTML)로만 돈다. 실제 학교에는 요청하지 않는다.
 * 화면 구조는 한성대 e-class 를 읽는 오픈소스(dotbugi)의 파서가 기대하는 구조를 따른다:
 *   출석부 user_progress_a.php(.user_progress_table), 학습 진도 user_progress.php(.user_progress),
 *   강좌 페이지 li.modtype_vod, 과제 목록 /mod/assign/index.php.
 * 지키는 것: 읽기 전용(영상 페이지를 열지 않는다), 로그인 실패는 분명할 때만 SchoolAuthFailed, 모르는 값은 unknown.
 */
import { describe, expect, it } from 'vitest';
import { createEclassFlow } from './eclass.js';
import { SchoolAuthFailed, SchoolHttp, SchoolUnavailable } from './http.js';
import { createEclassParser } from './eclassParse.js';

const ORIGIN = 'https://learn.hansung.ac.kr';
const NOW = Date.parse('2026-10-11T03:00:00Z'); // KST 12:00

const LOGIN_PAGE = `<html><body class="notloggedin"><form method="post" action="${ORIGIN}/login/index.php">
  <input type="hidden" name="logintoken" value="tok123"><input name="username"><input name="password" type="password">
  <input type="submit" name="loginbutton" value="로그인"></form></body></html>`;
const LOGIN_FAILED = LOGIN_PAGE.replace('<form', '<div class="loginerrors">로그인 정보가 잘못되었습니다. 확인해 주세요.</div><form');

const homeOf = (communityId?: string) => `<html><body id="page-my-index"><a href="${ORIGIN}/login/logout.php?sesskey=x">로그아웃</a>
  <ul class="my-course-lists">
    <li class="course_label_ct"><a class="course_link" href="${ORIGIN}/course/view.php?id=7" title="자료구조(01)"><div class="course-title"><h1>자료구조</h1><p>홍길동</p></div></a></li>
    <li class="${communityId === '8' ? 'course_label_ec' : 'course_label_ct'}"><a class="course_link" href="${ORIGIN}/course/view.php?id=8" title="운영체제(02)"><div class="course-title"><h1>운영체제</h1><p>김교수</p></div></a></li>
    <li class="course_label_ec"><a class="course_link" href="${ORIGIN}/course/view.php?id=9" title="HSU AI 활용 윤리 지침"><div class="course-title"><h1>HSU AI 활용 윤리 지침</h1><p>신상희</p></div></a></li>
  </ul></body></html>`;

/** 강좌 페이지: 1주차(기간 중, 두 강의 + 숨김 1개) · 2주차(공개 예정) */
const COURSE = (id: string) => `<html><body><div class="course-content"><ul>
  <li id="section-1"><h3 class="sectionname">1주차</h3><ul>
    <li class="activity vod modtype_vod"><div class="activityinstance">
      <a href="${ORIGIN}/mod/vod/view.php?id=${id}1"><span class="instancename">1주차 강의<span class="accesshide"> 동영상</span></span></a>
      <span class="text-ubstrap">2026-10-05 00:00 ~ 2026-10-18 23:59</span><span class="text-info">45:00</span></div></li>
    <li class="activity vod modtype_vod"><div class="activityinstance">
      <a href="${ORIGIN}/mod/vod/view.php?id=${id}2"><span class="instancename">1주차 실습</span></a>
      <span class="text-ubstrap">2026-10-05 00:00 ~ 2026-10-18 23:59</span></div></li>
    <li class="activity vod modtype_vod dimmed"><div class="activityinstance">
      <a href="${ORIGIN}/mod/vod/view.php?id=${id}9"><span class="instancename">숨겨진 강의</span></a>
      <span class="text-ubstrap">2026-10-05 00:00 ~ 2026-10-18 23:59</span></div></li>
  </ul></li>
  <li id="section-2"><h3 class="sectionname">2주차</h3><ul>
    <li class="activity vod modtype_vod"><div class="activityinstance">
      <a href="${ORIGIN}/mod/vod/view.php?id=${id}3"><span class="instancename">2주차 강의</span></a>
      <span class="text-ubstrap">2026-10-19 00:00 ~ 2026-10-25 23:59</span></div></li>
  </ul></li>
</ul></div></body></html>`;

const ATT_HEAD = `<thead><tr><th></th><th>강의 자료</th><th>출석인정 요구시간</th><th>총 학습시간</th><th>출석</th><th>주차 출석</th></tr></thead>`;
/** 1주차: 첫 강의 미출석(X, 18/45분), 둘째 출석(O). 주차 출석 칸은 rowspan 으로 합쳐진다. 2주차 강의는 아직 X */
const ATT_A = (weekly = 'X') => `<html><body><table class="user_progress_table">${ATT_HEAD}<tbody>
  <tr><td rowspan="2">1</td><td>1주차 강의</td><td>45:00</td><td>18:00<br><button class="track_detail">1회 열람</button></td><td>X</td><td rowspan="2">${weekly}</td></tr>
  <tr><td>1주차 실습</td><td>10:00</td><td>12:30<br><button class="track_detail">2회 열람</button></td><td>O</td></tr>
  <tr><td>2</td><td>2주차 강의</td><td>30:00</td><td>00:00</td><td>X</td><td>X</td></tr>
  <tr><td>3</td><td>출석 대상이 아닌 자료</td><td>00:00</td><td>00:00</td><td>X</td><td>X</td></tr>
</tbody></table></body></html>`;

/** 학습 진도 표(대체): 1주차 강의 18:00/45:00 → 미출석, 1주차 실습 12:30/10:00 → 출석 */
const PROGRESS = `<html><body><table class="user_progress"><tbody>
  <tr><td class="sectiontitle" rowspan="2">1</td><td><img src="${ORIGIN}/theme/image/vod.png">1주차 강의</td><td>45:00</td><td>18:00<br><button class="track_detail">1회 열람</button></td></tr>
  <tr><td><img src="${ORIGIN}/theme/image/vod.png">1주차 실습</td><td>10:00</td><td>12:30<br><button class="track_detail">2회 열람</button></td></tr>
</tbody></table></body></html>`;

const ASSIGN_INDEX = `<html><body><table class="generaltable"><tbody>
  <tr><td class="cell c0">1주차</td><td class="cell c1"><a href="${ORIGIN}/mod/assign/view.php?id=701">과제 1</a></td><td class="cell c2">2026-10-13 23:59</td><td class="cell c3">미제출</td><td class="cell c4">-</td></tr>
  <tr><td class="cell c0"></td><td class="cell c1"><a href="${ORIGIN}/mod/assign/view.php?id=702">과제 2</a></td><td class="cell c2">2026-10-20 23:59</td><td class="cell c3">제출 완료</td><td class="cell c4">-</td></tr>
</tbody></table></body></html>`;

type Site = { password?: string; drift?: boolean; community?: string; attFail?: boolean; progFail?: boolean; weekly?: string; noAssign?: boolean; emptyAtt?: boolean };

function fakeSite(opts: Site = {}) {
  const seen: string[] = [];
  const fetch = async (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input);
    seen.push(`${init.method ?? 'GET'} ${url.pathname}${url.search}`);
    const html = (body: string, status = 200, headers: Record<string, string> = {}) =>
      new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
    const redirect = (to: string, headers: Record<string, string> = {}) => new Response(null, { status: 303, headers: { location: to, ...headers } });
    if (url.pathname === '/login.php') return html(opts.drift ? '<html><body>점검 중</body></html>' : LOGIN_PAGE, 200, { 'set-cookie': 'MoodleSession=abc; Path=/; HttpOnly' });
    if (url.pathname === '/login/index.php' && init.method === 'POST') {
      const body = new URLSearchParams(String(init.body));
      if (body.get('password') !== (opts.password ?? 'right-pass')) return html(LOGIN_FAILED);
      return redirect('/login/index.php?testsession=1');
    }
    if (url.pathname === '/login/index.php') return redirect('/');
    if (url.pathname === '/') return html(homeOf(opts.community));
    if (url.pathname === '/course/view.php') return html(COURSE(url.searchParams.get('id')!));
    if (url.pathname === '/report/ubcompletion/user_progress_a.php') {
      if (opts.attFail) return html('gone', 404);
      return html(opts.emptyAtt ? `<html><body><table class="user_progress_table">${ATT_HEAD}<tbody></tbody></table></body></html>` : ATT_A(opts.weekly));
    }
    if (url.pathname === '/report/ubcompletion/user_progress.php') return opts.progFail ? html('gone', 404) : html(PROGRESS);
    if (url.pathname === '/mod/assign/index.php') {
      return html(opts.noAssign ? '<html><body><div id="region-main"><div class="alert">이 강좌에는 과제가 없습니다.</div></div></body></html>' : ASSIGN_INDEX);
    }
    return html('not found', 404);
  };
  return { fetch, seen };
}

function flowOf(site: ReturnType<typeof fakeSite>) {
  const http = new SchoolHttp('eclass', {
    fetch: site.fetch,
    origins: { info: 'https://info.hansung.ac.kr', resve: 'https://hansung.ac.kr', eclass: ORIGIN },
    now: () => NOW,
  });
  return createEclassFlow(http, { now: () => NOW });
}

const CREDS = { studentId: '2021204044', password: 'right-pass' };
const run = async (opts: Site = {}) => {
  const site = fakeSite(opts);
  const flow = flowOf(site);
  return { site, snap: await flow.snapshot(await flow.login(CREDS)) };
};
const lecture = (snap: Awaited<ReturnType<typeof run>>['snap'], courseId: string, title: string) =>
  snap.items.find((i) => i.kind === 'lecture' && i.courseId === courseId && i.title === title);

describe('e-class 조회 (출석부·강의 목록·과제 목록)', () => {
  it('출석부(O/X)로 수강 여부를, 강의 기간으로 마감을 읽는다', async () => {
    const { snap } = await run();
    expect(snap.courseCount).toBe(2);
    const w1 = lecture(snap, '7', '1주차 강의')!;
    expect(w1).toMatchObject({ completion: 'pending', attendance: 'unknown', progress: 40 });
    expect(w1.dueAt).toBe('2026-10-18T14:59:00.000Z'); // KST 23:59
    expect(w1.availableAt).toBe('2026-10-04T15:00:00.000Z'); // KST 00:00
    expect(lecture(snap, '7', '1주차 실습')).toMatchObject({ completion: 'completed', attendance: 'present', progress: 100 });
    // 2주차 강의는 아직 공개 전 기간
    expect(Date.parse(lecture(snap, '7', '2주차 강의')!.availableAt!)).toBeGreaterThan(NOW);
  });

  it('같은 강의가 이번 주 요약과 주차 목록에 두 번 나와도 한 번만 센다', async () => {
    const base = fakeSite();
    const fetch = async (input: string, init: RequestInit) => {
      const res = await base.fetch(input, init);
      if (new URL(input).pathname !== '/course/view.php') return res;
      const html = await res.text();
      // 1주차 구역 앞에 같은 1주차 강의가 담긴 "이번 주" 요약 구역을 하나 더 둔다
      const block = html.match(/<li id="section-1">[\s\S]*?<\/ul><\/li>/)![0];
      const dup = block.replace('id="section-1"', 'id="section-6"');
      return new Response(html.replace(block, dup + block), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    };
    const flow = flowOf({ fetch, seen: base.seen });
    const snap = await flow.snapshot(await flow.login(CREDS));
    const titles = snap.items.filter((i) => i.kind === 'lecture' && i.courseId === '7').map((i) => i.title).sort();
    expect(titles).toEqual(['1주차 강의', '1주차 실습', '2주차 강의']);
    expect(new Set(snap.items.map((i) => `${i.courseId}:${i.id}`)).size).toBe(snap.items.length);
  });

  it('숨겨진(.dimmed) 강의와 출석부에 없는 자료는 뺀다', async () => {
    const { snap } = await run();
    const titles = snap.items.filter((i) => i.kind === 'lecture' && i.courseId === '7').map((i) => i.title).sort();
    expect(titles).toEqual(['1주차 강의', '1주차 실습', '2주차 강의']);
  });

  it('주차 출석이 일괄출석인정이면 그 주차 강의는 수강 완료다', async () => {
    const { snap } = await run({ weekly: '일괄출석인정' });
    expect(lecture(snap, '7', '1주차 강의')).toMatchObject({ completion: 'completed' });
  });

  it('과제 목록의 제출 상태·마감을 읽는다', async () => {
    const { snap } = await run();
    const a1 = snap.items.find((i) => i.kind === 'assignment' && i.courseId === '7' && i.title === '과제 1')!;
    expect(a1).toMatchObject({ completion: 'pending', attendance: 'not_applicable', url: `${ORIGIN}/mod/assign/view.php?id=701` });
    expect(a1.dueAt).toBe('2026-10-13T14:59:00.000Z');
    expect(snap.items.find((i) => i.title === '과제 2')).toMatchObject({ completion: 'completed' });
    expect(snap.syncedAt).toBe(new Date(NOW).toISOString());
  });

  it('출석부(_a)를 읽지 못하면 학습 진도 표로 대신한다 (학습시간 ≥ 요구시간이면 출석)', async () => {
    const { snap, site } = await run({ attFail: true });
    expect(site.seen.some((r) => r.includes('user_progress.php?id=7'))).toBe(true);
    expect(lecture(snap, '7', '1주차 강의')).toMatchObject({ completion: 'pending' });
    expect(lecture(snap, '7', '1주차 실습')).toMatchObject({ completion: 'completed' });
    expect(snap.warnings.join(' ')).not.toContain('출석부를 읽지 못했어요');
  });

  it('커뮤니티 강좌는 출석부(_a)를 요청하지 않고 학습 진도 표로 판단한다', async () => {
    const { snap, site } = await run({ community: '8' });
    expect(site.seen.some((r) => r.includes('user_progress_a.php?id=8'))).toBe(false);
    expect(site.seen.some((r) => r.includes('user_progress_a.php?id=7'))).toBe(true);
    expect(lecture(snap, '8', '1주차 실습')).toMatchObject({ completion: 'completed' });
  });

  it('두 표를 모두 못 읽으면 완료 여부를 추측하지 않고 확인 필요로 두며 이유를 알린다', async () => {
    const { snap } = await run({ attFail: true, progFail: true });
    expect(lecture(snap, '7', '1주차 강의')).toMatchObject({ completion: 'unknown' });
    expect(snap.warnings.some((w) => w.includes('온라인 출석부를 읽지 못했어요') && w.includes('404'))).toBe(true);
  });

  it('과제가 없는 강좌(표 대신 안내문)는 경고 없이 과제 0개로 읽는다', async () => {
    const { snap } = await run({ noAssign: true });
    expect(snap.items.filter((i) => i.kind === 'assignment')).toEqual([]);
    expect(snap.warnings.join(' ')).not.toContain('과제 목록');
  });

  it('출석부 표에 읽을 줄이 하나도 없으면 학습 진도 표로 대신한다', async () => {
    const { snap, site } = await run({ emptyAtt: true });
    expect(site.seen.some((r) => r.includes('user_progress.php?id=7'))).toBe(true);
    expect(lecture(snap, '7', '1주차 실습')).toMatchObject({ completion: 'completed' });
  });

  it('출석부 표는 있는데 출석 대상 강의 줄이 없는 강좌는 강의를 세지 않고 경고도 띄우지 않는다', async () => {
    const { snap } = await run({ emptyAtt: true, progFail: true });
    expect(snap.items.filter((i) => i.kind === 'lecture' && i.courseId === '7')).toEqual([]);
    expect(snap.warnings.join(' ')).not.toContain('출석부');
    expect(snap.items.some((i) => i.completion === 'unknown')).toBe(false);
  });

  it('강좌 페이지의 "출석" 글자는 보지 않는다 (확장 프로그램이 넣은 표시일 수 있다)', async () => {
    const base = fakeSite({ attFail: true, progFail: true });
    const fetch = async (input: string, init: RequestInit) => {
      const res = await base.fetch(input, init);
      if (new URL(input).pathname !== '/course/view.php') return res;
      const html = (await res.text()).replace(
        '<span class="instancename">1주차 강의<span class="accesshide"> 동영상</span></span></a>',
        '<span class="instancename">1주차 강의<span class="accesshide"> 동영상</span></span></a><span class="label label-success">출석</span>',
      );
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    };
    const flow = flowOf({ fetch, seen: base.seen });
    const snap = await flow.snapshot(await flow.login(CREDS));
    expect(lecture(snap, '7', '1주차 강의')).toMatchObject({ completion: 'unknown' });
  });

  it('"HSU AI 활용 윤리 지침" 강좌는 요청도, 알림도 하지 않는다', async () => {
    const { snap, site } = await run();
    expect(site.seen.some((r) => r.includes('id=9'))).toBe(false);
    expect(snap.items.some((i) => i.courseName.includes('HSU AI'))).toBe(false);
    expect(snap.courseCount).toBe(2);
  });

  it('읽기 전용: 강의 영상 페이지(/mod/vod)와 과제 상세는 한 번도 열지 않는다', async () => {
    const { site } = await run();
    expect(site.seen.filter((r) => r.includes('/mod/vod') || r.includes('/mod/ubvideo') || r.includes('/mod/assign/view.php'))).toEqual([]);
    expect(site.seen.filter((r) => r.startsWith('POST') && !r.includes('/login/index.php'))).toEqual([]);
  });

  it('비밀번호가 틀렸다는 분명한 화면이면 SchoolAuthFailed', async () => {
    const flow = flowOf(fakeSite({ password: 'something-else' }));
    await expect(flow.login(CREDS)).rejects.toBeInstanceOf(SchoolAuthFailed);
  });

  it('로그인 화면 형식이 바뀌면 실패로 세지 않고 SchoolUnavailable (계정이 잠기지 않게)', async () => {
    const flow = flowOf(fakeSite({ drift: true }));
    const err = await flow.login(CREDS).catch((e) => e);
    expect(err).toBeInstanceOf(SchoolUnavailable);
    expect(err).not.toBeInstanceOf(SchoolAuthFailed);
  });

  it('safeReadUrl: 읽기 경로와 매개변수만 허용한다', () => {
    const flow = flowOf(fakeSite());
    expect(flow.safeReadUrl(`${ORIGIN}/course/view.php?id=7`)).not.toBeNull();
    expect(flow.safeReadUrl(`${ORIGIN}/mod/assign/index.php?id=7`)).not.toBeNull();
    expect(flow.safeReadUrl(`${ORIGIN}/report/ubcompletion/user_progress_a.php?id=7`)).not.toBeNull();
    expect(flow.safeReadUrl(`${ORIGIN}/mod/vod/view.php?id=71`)).toBeNull();
    expect(flow.safeReadUrl(`${ORIGIN}/mod/assign/view.php?id=701`)).toBeNull();
    expect(flow.safeReadUrl(`${ORIGIN}/course/view.php?id=7&sesskey=x`)).toBeNull();
    expect(flow.safeReadUrl('https://evil.example/course/view.php?id=7')).toBeNull();
  });
});

describe('출석부 표 해석', () => {
  const P = createEclassParser(ORIGIN);
  it('출석인정 요구시간 열이 없는 5열 표도 읽는다', () => {
    const html = `<table class="user_progress_table"><thead><tr><th></th><th>강의 자료</th><th>총 학습시간</th><th>출석</th><th>주차 출석</th></tr></thead><tbody>
      <tr><td>1</td><td>강의 A</td><td>10:00</td><td>O</td><td>O</td></tr></tbody></table>`;
    expect(P.parseAttendancePage(html)).toEqual([{ title: '강의 A', isAttendance: 'o', weeklyAttendance: 'o', week: 1, watchedTime: '10:00' }]);
  });
  it('"강의 자료" 머리글이 두 열에 걸쳐 있고 출석이 ○/× 로 표시돼도 읽는다', () => {
    const html = `<table class="user_progress_table"><thead><tr><th colspan="2">강의 자료</th><th>총 학습시간</th><th>출석</th><th>주차 출석</th></tr></thead><tbody>
      <tr><td>1</td><td>Chapter 0. 수업 오리엔테이션</td><td>27:05<br><button>4회 열람</button></td><td>○</td><td rowspan="2">○</td></tr>
      <tr><td>1</td><td>Week 1-2</td><td>00:00</td><td>×</td></tr></tbody></table>`;
    const rows = P.parseAttendancePage(html)!;
    expect(rows.map((r) => [r.title, r.isAttendance, r.weeklyAttendance, r.watchedTime])).toEqual([
      ['Chapter 0. 수업 오리엔테이션', 'o', 'o', '27:05'],
      ['Week 1-2', 'x', 'o', '00:00'],
    ]);
  });
  it('머리글을 알아볼 수 없으면 null (형식이 달라졌다는 뜻)', () => {
    expect(P.parseAttendancePage('<table class="user_progress_table"><thead><tr><th>a</th><th>b</th><th>c</th><th>d</th><th>e</th></tr></thead></table>')).toBeNull();
  });
});

describe('e-class 날짜 해석', () => {
  const P = createEclassParser(ORIGIN);
  it('한국 시간으로 읽고, 시각이 없는 날짜는 마감으로 쓰지 않는다', () => {
    expect(P.parseSeoulDate('2026년 10월 13일 (화) 오후 11:59')).toBe('2026-10-13T14:59:00.000Z');
    expect(P.parseSeoulDate('2026-10-13 09:00')).toBe('2026-10-13T00:00:00.000Z');
    expect(P.parseSeoulDate('2026년 10월 13일')).toBeNull();
  });
});
