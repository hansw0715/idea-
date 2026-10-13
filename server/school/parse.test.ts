import { describe, expect, it } from 'vitest';
import type { SchoolClass } from '../../shared/school/types.js';
import {
  admissionYearOf,
  bookedSet,
  buildPayload,
  expandSlots,
  extractAlerts,
  formatWhen,
  identityNames,
  inputValue,
  isRealDate,
  kstDate,
  normalizeInfo,
  normalizeItems,
  normalizeSetup,
  parseMine,
  parseProfile,
  parseServerCheck,
  parseSpaces,
  parseTimetable,
  slotStates,
  toGrid,
  unescapeHtml,
  validationPayload,
  weekdayIndex,
} from './parse.js';
import { CELL_MAX, PROFILE_FIELD_MAX } from './parse.js';
import type { BookingContext, ResveSetup } from './parse.js';

// 학교 HTML/JSON 을 흉내 낸 고정 fixture (파이썬이 파싱하는 모양 그대로)
const PROFILE_HTML = `
<html><body>
  <a href="/jsp/haksang_sajin.jsp?hakbun=2021204044"><img src="x.jpg"></a>
  <div class="info">AI응용학과<br/>   <a href="/jsp_21/x.jsp">박민재</a> 님</div>
</body></html>`;

describe('parseProfile', () => {
  it('학번·이름·학과를 읽는다 (마지막 줄 = 이름, 그 앞 줄 = 학과)', () => {
    expect(parseProfile(PROFILE_HTML)).toEqual({ studentId: '2021204044', name: '박민재', department: 'AI응용학과' });
  });

  it('엔티티와 여분 공백을 정리한다', () => {
    const html = `<a href="haksang_sajin.jsp?hakbun=2019100001"></a><div class="info">컴퓨터공학부 &amp; 융합<br>  <a href="#">김 &nbsp; 철수</a>`;
    expect(parseProfile(html)).toEqual({ studentId: '2019100001', name: '김 철수', department: '컴퓨터공학부 & 융합' });
  });

  it('학과 줄이 없으면 학과는 빈 문자열', () => {
    const html = `<a href="haksang_sajin.jsp?hakbun=2021204044"></a><div class="info"><a href="#">박민재</a>`;
    expect(parseProfile(html)).toEqual({ studentId: '2021204044', name: '박민재', department: '' });
  });

  it('구조가 달라지면 null', () => {
    expect(parseProfile('<html>로그인하세요</html>')).toBeNull();
    expect(parseProfile('<a href="haksang_sajin.jsp?hakbun=2021204044"></a>')).toBeNull();
  });
});

describe('admissionYearOf', () => {
  it('8자리 이상은 앞 4자리, 6~7자리는 앞 2자리', () => {
    expect(admissionYearOf('2021204044', 2026)).toBe(2021);
    expect(admissionYearOf('210044', 2026)).toBe(2021);
  });
  it('범위를 벗어나면 null', () => {
    expect(admissionYearOf('2099000001', 2026)).toBeNull();
    expect(admissionYearOf('1999000001', 2026)).toBeNull();
    expect(admissionYearOf('990000', 2026)).toBeNull(); // 2099 년 입학은 아직 없다
  });
});

describe('parseTimetable', () => {
  const events = [
    { title: '자료구조(01)\n김교수\n공학관 B101', start: '2026-10-12T09:15:00', end: '2026-10-12T10:45:00' },
    { title: '자료구조(01)\n김교수\n공학관 B101', start: '2026-10-19T09:15:00', end: '2026-10-19T10:45:00' }, // 다음 주 같은 수업 → 중복
    { title: '운영체제(02)\n이교수\n상상관 201', start: '2026-10-14T13:00:00', end: '2026-10-14T15:00:00' },
    { title: '주말특강(01)\n박교수\n상상관 301', start: '2026-10-17T10:00:00', end: '2026-10-17T12:00:00' }, // 토요일
    { title: '교양', start: '2026-10-13T11:00:00', end: '2026-10-13T12:00:00' }, // 분반·교수·강의실 없음
  ];

  it('요일·시간·과목·분반·교수·강의실을 읽고 월~금만 두며 중복을 합친다', () => {
    const r = parseTimetable(JSON.stringify(events))!;
    expect(r.classes).toEqual([
      { day: 0, start: '09:15', end: '10:45', subject: '자료구조', section: '01', professor: '김교수', room: '공학관 B101' },
      { day: 1, start: '11:00', end: '12:00', subject: '교양', section: '', professor: '', room: '' },
      { day: 2, start: '13:00', end: '15:00', subject: '운영체제', section: '02', professor: '이교수', room: '상상관 201' },
    ]);
    expect(r.skipped).toEqual([{ subject: '주말특강', reason: '주말 수업은 시간표에 넣을 수 없어요.' }]);
  });

  it('빈 배열은 수업 없음', () => {
    expect(parseTimetable('[]')).toEqual({ classes: [], skipped: [] });
  });

  it('JSON 이 아니거나 배열이 아니거나 읽을 수 있는 이벤트가 하나도 없으면 null', () => {
    expect(parseTimetable('<html>로그인</html>')).toBeNull();
    expect(parseTimetable('{"a":1}')).toBeNull();
    expect(parseTimetable('[{"x":1},{"y":2}]')).toBeNull();
  });

  it('시간대 표기가 붙어도 문자열의 날짜·시각을 그대로 쓴다', () => {
    const r = parseTimetable(JSON.stringify([{ title: 'A(1)\n\n', start: '2026-10-12T09:00:00+09:00', end: '2026-10-12T10:00:00+09:00' }]))!;
    expect(r.classes[0]).toMatchObject({ day: 0, start: '09:00', end: '10:00' });
  });
});

describe('toGrid (설계 §6)', () => {
  const cls = (day: number, start: string, end: string, subject = '과목', room = '강의실'): SchoolClass => ({
    day, start, end, subject, section: '', professor: '', room,
  });

  it('시작은 내림, 끝은 올림: 09:15→09:00, 10:45→11:00', () => {
    const r = toGrid([cls(0, '09:15', '10:45')]);
    expect(r.entries).toEqual([{ day: 0, startMin: 540, endMin: 660, title: '과목', place: '강의실' }]);
    expect(r.adjusted).toBe(1);
  });

  it('이미 격자에 맞으면 조정하지 않는다', () => {
    const r = toGrid([cls(1, '10:00', '11:30')]);
    expect(r.entries).toHaveLength(1);
    expect(r.adjusted).toBe(0);
  });

  it('21:50 은 22:00 으로 올린다', () => {
    const r = toGrid([cls(2, '20:00', '21:50')]);
    expect(r.entries[0]).toMatchObject({ startMin: 1200, endMin: 1320 });
    expect(r.adjusted).toBe(1);
  });

  it('24시 직전에 끝나면 24:00 으로 올려 맞추고 조정으로 센다', () => {
    const r = toGrid([cls(2, '23:00', '23:59')]);
    expect(r.entries[0]).toMatchObject({ startMin: 1380, endMin: 1440 });
    expect(r.adjusted).toBe(1);
  });

  it('22시 이후 수업도 24시 안이면 그대로 가져온다', () => {
    const r = toGrid([cls(2, '21:00', '23:30')]);
    expect(r.entries[0]).toMatchObject({ startMin: 1260, endMin: 1410 });
    expect(r.adjusted).toBe(0);
  });

  it('09:00 앞에서 시작하면 09:00 으로 자른다', () => {
    const r = toGrid([cls(0, '08:00', '09:30')]);
    expect(r.entries[0]).toMatchObject({ startMin: 540, endMin: 570 });
    expect(r.adjusted).toBe(1);
  });

  it('잘라도 길이가 0 이면 건너뛰고 이유를 남긴다 (09시 이전)', () => {
    const r = toGrid([cls(1, '07:00', '09:00', '조조')]);
    expect(r.entries).toEqual([]);
    expect(r.adjusted).toBe(0);
    expect(r.skipped.map((s) => s.subject)).toEqual(['조조']);
    expect(r.skipped[0].reason).toContain('09:00~24:00');
  });

  it('주말은 건너뛴다', () => {
    const r = toGrid([cls(5, '10:00', '11:00', '토요강의'), cls(6, '10:00', '11:00', '일요강의')]);
    expect(r.entries).toEqual([]);
    expect(r.skipped).toHaveLength(2);
    expect(r.skipped[0].reason).toContain('주말');
  });

  it('격자에 맞춘 뒤 같아지는 수업은 하나로 합친다', () => {
    const r = toGrid([cls(0, '09:05', '10:50'), cls(0, '09:20', '10:40')]);
    expect(r.entries).toHaveLength(1);
  });

  it('시간이 거꾸로이거나 읽을 수 없으면 건너뛴다', () => {
    const r = toGrid([cls(0, '11:00', '10:00', 'A'), cls(0, 'xx', '10:00', 'B')]);
    expect(r.entries).toEqual([]);
    expect(r.skipped).toHaveLength(2);
  });

  it('긴 이름·강의실은 30자로 자른다', () => {
    const r = toGrid([cls(0, '10:00', '11:00', '가'.repeat(40), '나'.repeat(40))]);
    expect(Array.from(r.entries[0].title)).toHaveLength(30);
    expect(Array.from(r.entries[0].place)).toHaveLength(30);
  });
});

describe('공간 목록 · 내 신청내역', () => {
  it('parseSpaces: select 의 옵션을 읽고 placeholder 는 건너뛴다', () => {
    const html = `<form><select id="resveSpceSeq" name="resveSpceSeq"><option value="">선택</option>
      <option value="47">소모임실 Challenge</option><option value="48" selected>소모임실 &amp; Co</option></select><select><option value="9">다른</option></select>`;
    expect(parseSpaces(html)).toEqual([
      { id: 47, name: '소모임실 Challenge' },
      { id: 48, name: '소모임실 & Co' },
    ]);
  });

  it('parseSpaces: select 자체가 없으면 null (구조 변경)', () => {
    expect(parseSpaces('<html>점검 중</html>')).toBeNull();
  });

  it('parseMine: no-data 행과 8칸 미만 행은 건너뛴다', () => {
    const html = `<table>
      <tr><th>번호</th><th>공간</th></tr>
      <tr class="no-data"><td colspan="8">내역 없음</td></tr>
      <tr><td>12</td><td> 소모임실
         Challenge </td><td>2026-10-12</td><td>10:00~12:00</td><td>홍길동</td><td>2021204044</td><td>2026-10-08</td><td><span>승인대기</span></td></tr>
      <tr><td>짧은</td><td>행</td></tr></table>`;
    expect(parseMine(html)).toEqual([
      { no: '12', space: '소모임실 Challenge', date: '2026-10-12', time: '10:00~12:00', applied: '2026-10-08', status: '승인대기' },
    ]);
  });
});

describe('설정 정규화', () => {
  const row = { resveTm: '09:00,10:00,11:00', posblDay: '월,화,수', posblBgnde: '20260101', posblEndde: '20261231', posblTm: '2', posblTerm: '60', resveGroupSeq: 5 };

  it('normalizeSetup', () => {
    expect(normalizeSetup(row)).toEqual({
      slots: ['09:00', '10:00', '11:00'],
      posblDay: '월,화,수',
      posblBgnde: '20260101',
      posblEndde: '20261231',
      posblTm: 2,
      posblTerm: '60',
      termMin: 60,
      resveGroupSeq: '5',
    });
  });

  it('필수 필드가 이상하면 null', () => {
    expect(normalizeSetup(null)).toBeNull();
    expect(normalizeSetup({ ...row, resveTm: '' })).toBeNull();
    expect(normalizeSetup({ ...row, resveTm: '9시' })).toBeNull();
    expect(normalizeSetup({ ...row, posblTerm: 0 })).toBeNull();
    expect(normalizeSetup({ ...row, posblBgnde: '2026-01-01' })).toBeNull();
  });

  it('normalizeItems: 항목이 없을 때 오는 빈 placeholder 를 거른다', () => {
    expect(normalizeItems([{ itemNm: '', mustYn: '' }])).toEqual([]);
    expect(normalizeItems([{ itemNm: '소속', mustYn: 'Y' }, { itemNm: '목적', mustYn: 'N' }])).toEqual([
      { name: '소속', mustYn: 'Y' },
      { name: '목적', mustYn: 'N' },
    ]);
  });

  it('normalizeInfo / identityNames / bookedSet', () => {
    expect(normalizeInfo(undefined)).toEqual({ groupNm: '', spceNm: '', mngr: '', telno: '', identityCode: '' });
    expect(identityNames('IDENTITY_00007, IDENTITY_00008,IDENTITY_99999')).toEqual(['학사(재학생)', '학사(졸업생)', 'IDENTITY_99999']);
    expect(bookedSet([{ resveTm: '10:00' }, { resveTm: '11:00:00' }, { x: 1 }])).toEqual(new Set(['10:00', '11:00']));
  });
});

describe('날짜 · 슬롯 상태 · 펼치기', () => {
  // 2026-10-12 는 월요일. 지금 = 2026-10-08(목) 12:00 KST
  const NOW = Date.UTC(2026, 9, 8, 3, 0, 0);
  const setup: ResveSetup = normalizeSetup({
    resveTm: '09:00,10:00,11:00,12:00,13:00', posblDay: '월,화,수,목,금', posblBgnde: '20260101', posblEndde: '20261231', posblTm: 1, posblTerm: 60, resveGroupSeq: 5,
  })!;

  it('weekdayIndex / isRealDate / kstDate', () => {
    expect(weekdayIndex('2026-10-12')).toBe(0);
    expect(weekdayIndex('2026-10-17')).toBe(5);
    expect(isRealDate('2026-10-12')).toBe(true);
    expect(isRealDate('2026-09-32')).toBe(false);
    expect(isRealDate('2026-2-3')).toBe(false);
    expect(kstDate(NOW)).toBe('2026-10-08');
    expect(kstDate(Date.UTC(2026, 9, 8, 16, 0, 0))).toBe('2026-10-09'); // UTC 16시 = KST 다음 날 01시
  });

  it('slotStates: 가능 / 예약됨', () => {
    const s = slotStates(setup, new Set(['11:00']), '2026-10-12', NOW);
    expect(Object.fromEntries(s.map((x) => [x.start, x.state]))).toEqual({
      '09:00': 'available', '10:00': 'available', '11:00': 'booked', '12:00': 'available', '13:00': 'available',
    });
  });

  it('slotStates: 운영 요일 밖(토요일)·기간 밖은 모두 닫힘', () => {
    expect(slotStates(setup, new Set(), '2026-10-17', NOW).every((x) => x.state === 'closed')).toBe(true);
    const short = { ...setup, posblEndde: '20261011' };
    expect(slotStates(short, new Set(), '2026-10-12', NOW).every((x) => x.state === 'closed')).toBe(true);
  });

  it('slotStates: 시작 < 지금 + 리드타임이면 닫힘 (한국 시각 기준)', () => {
    // 지금 = 10-08 12:00 KST, 리드타임 1시간 → 13:00 보다 이른 슬롯은 닫힘
    const today = slotStates(setup, new Set(), '2026-10-08', NOW);
    expect(Object.fromEntries(today.map((x) => [x.start, x.state]))).toEqual({
      '09:00': 'closed', '10:00': 'closed', '11:00': 'closed', '12:00': 'closed', '13:00': 'available',
    });
    // 예약됨과 닫힘이 겹치면 닫힘이 이긴다 (파이썬 순서와 같다)
    expect(slotStates(setup, new Set(['09:00']), '2026-10-08', NOW)[0].state).toBe('closed');
  });

  it('expandSlots: 슬롯 단위로 펼친다', () => {
    expect(expandSlots(600, 720, setup)).toEqual({ ok: true, times: ['10:00', '11:00'] });
    expect(expandSlots(660, 720, setup)).toEqual({ ok: true, times: ['11:00'] });
  });

  it('expandSlots: 단위에 안 맞으면 이유를 돌려준다', () => {
    const r1 = expandSlots(600, 690, setup); // 90분
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toContain('60분 단위');
    const r2 = expandSlots(630, 690, setup); // 10:30 시작 → 슬롯 아님
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toContain('10:30');
    expect(expandSlots(600, 600, setup).ok).toBe(false);
    expect(expandSlots(1200, 1260, setup).ok).toBe(false); // 20:00 은 이 공간의 슬롯이 아님
  });

  it('formatWhen', () => {
    expect(formatWhen('2026-10-12', ['10:00', '11:00'], 60)).toBe('10월 12일 (월) 10:00~12:00 (60분 × 2칸)');
  });
});

describe('신청 폼', () => {
  const setup = normalizeSetup({
    resveTm: '09:00,10:00,11:00', posblDay: '월,화,수,목,금', posblBgnde: '20260101', posblEndde: '20261231', posblTm: 1, posblTerm: 60, resveGroupSeq: 5,
  })!;
  const ctx: BookingContext = {
    key: 'cncschool/2', site: 'cncschool', fn: '2', space: { id: 47, name: '소모임실 Challenge' }, day: '2026-10-12', setup,
    info: { groupNm: '상상파크', spceNm: '소모임실 Challenge', mngr: '홍담당', telno: '02-760-4800', identityCode: 'IDENTITY_00007' },
    identities: ['학사(재학생)', '학사(졸업생)'],
    items: [{ name: '소속', mustYn: 'Y' }, { name: '목적', mustYn: 'N' }],
    regUrl: 'https://hansung.ac.kr/resve/cncschool/2/artclRegistWrap.do', layout: 'abc', userNm: '홍길동', hakbun: '2021204044', telno: '010-1111-2222', email: 'a@hansung.ac.kr',
  };

  it('필드 순서가 파이썬 build_payload 와 같고 resveTm 이 슬롯마다 반복된다', () => {
    const p = buildPayload(ctx, ['11:00', '10:00', '10:00'], { 소속: 'AI응용학과' });
    expect(p).toEqual([
      ['layout', 'abc'], ['siteId', 'cncschool'], ['fnctNo', '2'], ['lmttYn', 'N'],
      ['groupNm', '상상파크'], ['spceNm', '소모임실 Challenge'], ['selDay', '월'], ['posblDay', '월,화,수,목,금'],
      ['posblTerm', '60'], ['posblBgnde', '20260101'], ['posblEndde', '20261231'], ['resveGroupSeq', '5'],
      ['userNm', '홍길동'], ['hakbun', '2021204044'], ['addItemCnt', '2'], ['group', '5'],
      ['resveSpceSeq', '47'], ['mngr', '홍담당'], ['mngrTelno', '02-760-4800'], ['resveDeStr', '2026-10-12'],
      ['identityCode', '학사(재학생),학사(졸업생)'],
      ['resveTm', '10:00'], ['resveTm', '11:00'],
      ['telno', '010-1111-2222'], ['email', 'a@hansung.ac.kr'],
      ['addItemMustYn1', 'Y'], ['addItem1', 'AI응용학과'], ['addItemMustYn2', 'N'], ['addItem2', ''],
    ]);
  });

  it('연락처·이메일을 직접 주면 그 값을 쓴다 (빈 문자열도 그대로)', () => {
    const p = Object.fromEntries(buildPayload(ctx, ['10:00'], {}, '010-9999-0000', ''));
    expect(p.telno).toBe('010-9999-0000');
    expect(p.email).toBe('');
  });

  it('검증용 폼은 첫 필드(layout)만 비운다', () => {
    const p = buildPayload(ctx, ['10:00'], {});
    const v = validationPayload(p);
    expect(v[0]).toEqual(['layout', '']);
    expect(v.slice(1)).toEqual(p.slice(1));
  });

  it('inputValue: name 이 맞는 input 의 value (엔티티 해제), 없으면 빈 문자열', () => {
    const html = `<input type="hidden" name="layout" value="abc"/><input name="email" value="a&amp;b@x.kr"><input name="telno">`;
    expect(inputValue(html, 'layout')).toBe('abc');
    expect(inputValue(html, 'email')).toBe('a&b@x.kr');
    expect(inputValue(html, 'telno')).toBe('');
    expect(inputValue(html, 'nope')).toBe('');
  });
});

describe('서버 검증 · 제출 응답', () => {
  it('빈 본문 · [] · null 은 통과', () => {
    expect(parseServerCheck('')).toEqual({ kind: 'ok' });
    expect(parseServerCheck('  \n')).toEqual({ kind: 'ok' });
    expect(parseServerCheck('[]')).toEqual({ kind: 'ok' });
    expect(parseServerCheck('null')).toEqual({ kind: 'ok' });
  });
  it('오류 배열은 각 오류 객체의 값들을 문장으로', () => {
    expect(parseServerCheck('[{"field":"email","msg":"이메일을 입력하세요."},{"msg":"필수 항목입니다."}]')).toEqual({
      kind: 'errors',
      messages: ['email', '이메일을 입력하세요.', '필수 항목입니다.'],
    });
  });
  it('읽을 수 없는 응답(HTML·객체)은 통과로 보지 않는다', () => {
    expect(parseServerCheck('<html>login</html>')).toEqual({ kind: 'unreadable' });
    expect(parseServerCheck('{"a":1}')).toEqual({ kind: 'unreadable' });
  });
  it('extractAlerts', () => {
    expect(extractAlerts(`<script>alert('신청되었습니다.'); alert("두번째");</script>`)).toEqual(['신청되었습니다.', '두번째']);
  });
  it('unescapeHtml', () => {
    expect(unescapeHtml('&lt;a&gt; &amp; &#39;x&#39; &#x41; &unknown;')).toBe("<a> & 'x' A &unknown;");
  });
});

// ───────────────────────────────────────────────────────────────
// 적대적 입력 (ReDoS). 학교(또는 중간자)가 '<' 만 계속되는 본문을 주어도 서버가 멈추지 않아야 한다.
// 예전 정규식은 '>' 나 닫는 태그가 없을 때 시작 위치마다 끝까지 훑어 2차 시간이었다 (4만 자에 1~4초, 2MB 면 사실상 무한).
// 아래는 응답 크기 제한(2MB)과 같은 규모로 넣어도 한 번 훑는 데 걸리는 정도의 시간만 쓰는지 본다.
describe('적대적 입력: 2차 시간(ReDoS)이 아니다', () => {
  const BIG = 2 * 1024 * 1024;
  const timed = (fn: () => void): number => {
    const t = process.hrtime.bigint();
    fn();
    return Number(process.hrtime.bigint() - t) / 1e6;
  };
  // 예전 코드는 이 크기에서 수 초~수 분이 걸렸다. 선형이면 CI 가 느려도 한참 아래다.
  const LIMIT_MS = 1500;

  it("parseMine: td 안에 '<' 가 2MB", () => {
    const html = '<table><tr><td>' + '<'.repeat(BIG) + '</td></tr></table>';
    expect(timed(() => parseMine(html))).toBeLessThan(LIMIT_MS);
  });

  it("parseMine: 닫히지 않는 '<tr>' 이 2MB / '<td>' 가 2MB / '<tr ' 가 2MB", () => {
    for (const unit of ['<tr>', '<tr><td>', '<tr ', '<td ']) {
      const html = unit.repeat(Math.floor(BIG / unit.length));
      expect(timed(() => parseMine(html)), unit).toBeLessThan(LIMIT_MS);
    }
  });

  it("parseMine: 닫힌 tr 안에 닫히지 않는 '<td>' / '<td ' 가 2MB", () => {
    for (const unit of ['<td>', '<td ', '<td></td', '<td x="1"']) {
      const html = '<tr>' + unit.repeat(Math.floor(BIG / unit.length)) + '</tr>';
      expect(timed(() => parseMine(html)), unit).toBeLessThan(LIMIT_MS);
    }
  });

  it("parseMine: '<' 와 '>' 가 번갈아 2MB", () => {
    const html = '<tr><td>' + '<>'.repeat(BIG / 2) + '</td></tr>';
    expect(timed(() => parseMine(html))).toBeLessThan(LIMIT_MS);
  });

  it("parseProfile: '<a' 가 2MB (닫는 '>' 없음) / 시작 div 가 2MB (</a> 없음)", () => {
    const withAnchors = '<div class="info">' + '<a'.repeat(BIG / 2) + '</a>haksang_sajin.jsp?hakbun=1999000';
    expect(timed(() => parseProfile(withAnchors))).toBeLessThan(LIMIT_MS);
    const noClose = '<div class="info">'.repeat(Math.floor(BIG / 18)) + 'haksang_sajin.jsp?hakbun=1999000';
    expect(timed(() => parseProfile(noClose))).toBeLessThan(LIMIT_MS);
    const lt = '<div class="info">' + '<'.repeat(BIG) + '</a>haksang_sajin.jsp?hakbun=1999000';
    expect(timed(() => parseProfile(lt))).toBeLessThan(LIMIT_MS);
  });

  it("inputValue: '<input' 가 2MB (닫는 '>' 없음)", () => {
    const html = '<input'.repeat(Math.floor(BIG / 6));
    expect(timed(() => inputValue(html, 'layout'))).toBeLessThan(LIMIT_MS);
  });

  it("parseSpaces: '<option value=\"1\"' 가 2MB (닫는 '>' 없음) / 빈 이름 옵션이 2MB", () => {
    const unit = '<option value="1"';
    const open = 'id="resveSpceSeq">' + unit.repeat(Math.floor(BIG / unit.length));
    expect(timed(() => parseSpaces(open))).toBeLessThan(LIMIT_MS);
    const unit2 = '<option value="1"></option>';
    const empty = 'id="resveSpceSeq">' + unit2.repeat(Math.floor(BIG / unit2.length));
    expect(timed(() => parseSpaces(empty))).toBeLessThan(LIMIT_MS);
    // '>' 하나가 맨 끝에만 있고 앞에는 시작만 반복 — 시작마다 같은 '>' 를 다시 찾지 않는다
    const lateGt = 'id="resveSpceSeq">' + unit.repeat(Math.floor(BIG / unit.length)) + '>x';
    expect(timed(() => parseSpaces(lateGt))).toBeLessThan(LIMIT_MS);
  });

  it('비정상적으로 긴 값은 잘라서 돌려준다 (이름·학과 100자, 신청내역 칸 200자) — 응답·DB 가 학교가 준 크기만큼 커지지 않는다', () => {
    const junk = '<a'.repeat(BIG / 2);
    const p = parseProfile(`haksang_sajin.jsp?hakbun=1888888 <div class="info">${'가'.repeat(BIG / 4)}<br>${junk}</a>`);
    expect(p).not.toBeNull();
    expect(Array.from(p!.name).length).toBeLessThanOrEqual(PROFILE_FIELD_MAX);
    expect(Array.from(p!.department).length).toBeLessThanOrEqual(PROFILE_FIELD_MAX);
    const cells = ['1', '공간', '2026-10-12', '10:00~12:00', '이름', '학번', '2026-10-08', '상'.repeat(BIG / 4)];
    const html = `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
    const rows = parseMine(html);
    expect(rows).toHaveLength(1);
    expect(Array.from(rows[0].status).length).toBe(CELL_MAX);
    // 정상 길이는 그대로
    expect(parseMine(`<tr>${['1', '소모임실 Challenge', '2026-10-12', '10:00~12:00', 'a', 'b', '2026-10-08', '승인대기'].map((c) => `<td>${c}</td>`).join('')}</tr>`)[0].space).toBe('소모임실 Challenge');
  });

  it('extractAlerts / parseServerCheck: 긴 입력도 빠르다', () => {
    expect(timed(() => extractAlerts("alert('".repeat(BIG / 7)))).toBeLessThan(LIMIT_MS);
    expect(timed(() => parseServerCheck(JSON.stringify([{ a: '<'.repeat(BIG / 2) }])))).toBeLessThan(LIMIT_MS);
  });
});

// 새 선형 스캐너가 예전 정규식과 같은 결과를 내는지: 태그·꺾쇠 조각을 무작위로 이어 붙인 입력으로 대조한다 (고정 시드).
describe('선형 스캐너는 예전 정규식과 같은 결과를 낸다 (무작위 대조)', () => {
  const legacyClean = (x: string): string => unescapeHtml(x.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  const legacyMine = (html: string) => {
    const out: { no: string; space: string; date: string; time: string; applied: string; status: string }[] = [];
    for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      if (tr[1].includes('no-data')) continue;
      const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => legacyClean(c[1]));
      if (cells.length >= 8) out.push({ no: cells[0], space: cells[1], date: cells[2], time: cells[3], applied: cells[6], status: cells[7] });
    }
    return out;
  };
  const legacySpaces = (html: string) => {
    const i = html.indexOf('id="resveSpceSeq"');
    if (i < 0) return null;
    const end = html.indexOf('</select>', i);
    const sel = html.slice(i, end < 0 ? undefined : end);
    return [...sel.matchAll(/<option value="(\d+)"[^>]*>([^<]+)<\/option>/g)].map((m) => ({ id: Number(m[1]), name: unescapeHtml(m[2]).trim() }));
  };
  const legacyInput = (html: string, name: string): string => {
    const needle = `name="${name}"`;
    for (const tag of html.match(/<input[^>]*>/g) ?? []) {
      if (tag.includes(needle)) {
        const m = /value="([^"]*)"/.exec(tag);
        return m ? unescapeHtml(m[1]) : '';
      }
    }
    return '';
  };
  const legacyProfile = (html: string) => {
    const id = /haksang_sajin\.jsp\?hakbun=(\w+)/.exec(html);
    const info = /<div class="info">([\s\S]*?)<\/a>/.exec(html);
    if (!id || !info) return null;
    const parts = info[1].replace(/<a[^>]*>/g, '').split(/<br\s*\/?>/i);
    const name = legacyClean(parts[parts.length - 1] ?? '');
    const department = parts.length > 1 ? legacyClean(parts[parts.length - 2]) : '';
    return name ? { studentId: id[1], name, department } : null;
  };

  // 작은 선형 합동 난수 (재현 가능)
  const rng = (seed: number) => () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const pick = <T,>(r: () => number, items: T[]): T => items[Math.floor(r() * items.length)];

  const TOKENS = [
    '<tr>', '<tr class="a">', '</tr>', '<td>', '<td colspan="2">', '</td>', '<', '>', '<>', '<<', '>>', ' ', '\n', 'x', '한글', '&amp;', '&lt;', 'no-data',
    '<br>', '<br/>', '<a href="#">', '</a>', '<b>', '</b>', '<input name="layout" value="a&amp;b">', '<input', 'name="layout"', 'value="v"',
    '<option value="1">', '<option value="22"', '</option>', '<option value="3">이름</option>', '<div class="info">', 'haksang_sajin.jsp?hakbun=2021204044',
    '<td>1</td>', '<td>a</td><td>b</td><td>c</td><td>d</td><td>e</td><td>f</td><td>g</td><td>h</td>',
  ];

  it('parseMine / parseSpaces / inputValue / parseProfile: 3000개 무작위 입력에서 결과가 같다', () => {
    const r = rng(12345);
    for (let n = 0; n < 3000; n++) {
      const len = 1 + Math.floor(r() * 30);
      let html = '';
      for (let i = 0; i < len; i++) html += pick(r, TOKENS);
      expect(parseMine(html), `parseMine ${JSON.stringify(html)}`).toEqual(legacyMine(html));
      expect(inputValue(html, 'layout'), `inputValue ${JSON.stringify(html)}`).toBe(legacyInput(html, 'layout'));
      expect(parseProfile(html), `parseProfile ${JSON.stringify(html)}`).toEqual(legacyProfile(html));
      const withSelect = 'id="resveSpceSeq">' + html;
      expect(parseSpaces(withSelect), `parseSpaces ${JSON.stringify(html)}`).toEqual(legacySpaces(withSelect));
    }
  });

  it('실제 모양 fixture 도 그대로 읽는다 (회귀)', () => {
    const table = `<table><tbody><tr><td>501</td><td>소모임실 Challenge</td><td>2026-10-12</td><td>10:00~12:00</td><td>박민재</td><td>2021204044</td><td>2026-10-08</td><td>승인대기</td></tr></tbody></table>`;
    expect(parseMine(table)).toEqual(legacyMine(table));
    expect(parseMine(table)).toHaveLength(1);
    expect(parseMine(`<tr class="no-data"><td colspan="8">없음</td></tr>`)).toEqual([]);
  });
});
