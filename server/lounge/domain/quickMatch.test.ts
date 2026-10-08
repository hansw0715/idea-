import { describe, expect, it } from 'vitest';
import {
  allAccepted,
  answer,
  commonBands,
  confirmedMeetAt,
  createRoom,
  decideBand,
  dropPastBands,
  findGroup,
  futureBands,
  hasBlockedPair,
  isCompatible,
  isExpired,
  isFinishedRoom,
  isRealDate,
  kstDate,
  meetAtOf,
  parseQuickInput,
  toRequestView,
  vote,
  type QuickRequest,
  type QuickRoom,
} from './quickMatch.js';

const NOW = '2026-09-22T01:00:00.000Z';
const never = () => false;

const req = (id: string, over: Partial<QuickRequest> = {}): QuickRequest => ({
  id,
  userId: id,
  date: '2026-09-22',
  placeType: '학식',
  size: 2,
  bands: ['b12', 'b13'],
  tags: [],
  status: 'waiting',
  roomId: null,
  createdAt: NOW,
  ...over,
});

const unwrap = (r: ReturnType<typeof vote>): QuickRoom => {
  if (!r.ok) throw new Error(`${r.error.code} ${r.error.message}`);
  return r.value;
};

// ───────────── ZIP quick-match.test.ts 이식 ─────────────

describe('짝 찾기', () => {
  it('날짜·장소·인원이 같고 시간대가 겹치면 맞는다', () => {
    expect(isCompatible(req('a'), req('b'), never)).toBe(true);
  });

  it('시간대가 하나도 안 겹치면 안 맞는다', () => {
    expect(isCompatible(req('a'), req('b', { bands: ['b18'] }), never)).toBe(false);
  });

  it('인원이 다르면 안 맞는다', () => {
    expect(isCompatible(req('a'), req('b', { size: 4 }), never)).toBe(false);
  });

  it('장소 종류가 다르면 안 맞는다', () => {
    expect(isCompatible(req('a'), req('b', { placeType: '학교 주변' }), never)).toBe(false);
  });

  it('차단한 사이면 안 맞는다', () => {
    expect(isCompatible(req('a'), req('b'), () => true)).toBe(false);
  });

  it("'같은 과만'을 건 쪽과는 학과가 같아야 한다", () => {
    const a = req('a', { tags: ['같은 과만', 'dept:컴공'] });
    expect(isCompatible(a, req('b', { tags: ['dept:컴공'] }), never)).toBe(true);
    expect(isCompatible(a, req('b', { tags: ['dept:패션'] }), never)).toBe(false);
  });

  it('인원이 다 차야 방이 생긴다', () => {
    const target = req('a', { size: 3 });
    const waiting = [req('b', { size: 3 })];
    expect(findGroup(waiting, target, never)).toBeNull();

    const full = findGroup([...waiting, req('c', { size: 3 })], target, never);
    expect(full?.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('오래 기다린 사람이 먼저 들어간다', () => {
    const target = req('a');
    const old = req('old', { createdAt: '2026-09-22T00:00:00.000Z' });
    const fresh = req('fresh', { createdAt: '2026-09-22T00:59:00.000Z' });
    expect(findGroup([fresh, old], target, never)?.map((r) => r.id)).toEqual(['a', 'old']);
  });

  it('셋이 모여도 공통 시간대가 없으면 방이 안 생긴다', () => {
    const target = req('a', { size: 3, bands: ['b12', 'b13'] });
    const group = findGroup(
      [req('b', { size: 3, bands: ['b12'] }), req('c', { size: 3, bands: ['b13'] })],
      target,
      never,
    );
    expect(group).toBeNull();
  });

  it('쌍마다 시간대가 겹쳐도 셋의 공통 시간대가 없으면 방이 안 생긴다 (findGroup 마지막 검사)', () => {
    // a∩b={b12}, a∩c={b11}, b∩c={b13}: 어느 두 사람도 짝이 되지만 셋이 함께 되는 시간대는 없다.
    // 앞의 테스트(b·c 가 서로 안 겹침)는 isCompatible 에서 이미 걸러져 이 검사까지 오지 못한다.
    const a = req('a', { size: 3, bands: ['b11', 'b12'] });
    const b = req('b', { size: 3, bands: ['b12', 'b13'] });
    const c = req('c', { size: 3, bands: ['b11', 'b13'] });
    expect(isCompatible(a, b, never) && isCompatible(a, c, never) && isCompatible(b, c, never)).toBe(true);
    expect(commonBands([a, b, c])).toEqual([]);

    expect(findGroup([b, c], a, never)).toBeNull();
    // 같은 세 사람이라도 모두에게 맞는 시간이 하나 있으면 방이 생긴다
    const c2 = req('c', { size: 3, bands: ['b11', 'b12', 'b13'] });
    expect(findGroup([b, c2], a, never)?.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('공통 시간대를 계산한다', () => {
    expect(commonBands([req('a', { bands: ['b12', 'b13'] }), req('b', { bands: ['b13', 'b17'] })])).toEqual(['b13']);
  });
});

describe('후보 방', () => {
  const room = () => createRoom('room1', [req('a'), req('b')], NOW);

  it('대기표에 적은 시간이 첫 투표로 들어간다', () => {
    const r = room();
    expect(r.bands).toEqual(['b12', 'b13']);
    expect(r.votes['a']).toEqual(['b12', 'b13']);
    expect(r.status).toBe('pending');
  });

  it('방은 QUICK_ROOM_TTL_MIN(30분) 뒤에 만료된다', () => {
    expect(room().expiresAt).toBe('2026-09-22T01:30:00.000Z');
  });

  it('전원이 수락해야 확정된다', () => {
    let r = unwrap(answer(room(), 'a', 'accepted', NOW));
    expect(r.status).toBe('pending');
    expect(allAccepted(r)).toBe(false);

    r = unwrap(answer(r, 'b', 'accepted', NOW));
    expect(r.status).toBe('confirmed');
  });

  it('한 명이 거절하면 방이 깨진다', () => {
    let r = unwrap(answer(room(), 'a', 'accepted', NOW));
    r = unwrap(answer(r, 'b', 'declined', NOW));
    expect(r.status).toBe('cancelled');
  });

  it('참여자가 아니면 답할 수 없다', () => {
    const r = answer(room(), 'stranger', 'accepted', NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN');
  });

  it('시간이 지나면 답할 수 없다', () => {
    const r = answer(room(), 'a', 'accepted', '2026-09-22T02:00:00.000Z');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('DEADLINE_PASSED');
    expect(isExpired(room(), '2026-09-22T02:00:00.000Z')).toBe(true);
  });

  it('방에 없는 시간대는 고를 수 없다', () => {
    const r = vote(room(), 'a', ['b19'], NOW);
    expect(r.ok).toBe(false);
  });
});

describe('시간 결정', () => {
  it('표를 많이 받은 시간대로 정한다', () => {
    let r = createRoom('room1', [req('a'), req('b'), req('c', { size: 3 })], NOW);
    r = unwrap(vote(r, 'a', ['b13'], NOW));
    r = unwrap(vote(r, 'b', ['b13'], NOW));
    expect(decideBand(r)).toBe('b13');
  });

  it('동점이면 이른 시간으로 정한다', () => {
    expect(decideBand(createRoom('room1', [req('a'), req('b')], NOW))).toBe('b12');
  });

  it('한국 시간 기준으로 약속 시각을 만든다', () => {
    // 2026-09-22 12:00 KST = 03:00 UTC
    expect(meetAtOf('2026-09-22', 'b12')).toBe('2026-09-22T03:00:00.000Z');
  });
});

// ───────────── 새로 쓴 것: 보강 규칙 ─────────────

describe('이미 끝난 방은 고칠 수 없다', () => {
  it('확정·취소된 방에는 투표도 수락도 못 한다 (NOT_OPEN)', () => {
    const confirmed: QuickRoom = { ...createRoom('r', [req('a'), req('b')], NOW), status: 'confirmed' };
    const cancelled: QuickRoom = { ...createRoom('r', [req('a'), req('b')], NOW), status: 'cancelled' };
    for (const room of [confirmed, cancelled]) {
      const v = vote(room, 'a', ['b12'], NOW);
      const a = answer(room, 'a', 'accepted', NOW);
      expect(!v.ok && v.error.code).toBe('NOT_OPEN');
      expect(!a.ok && a.error.code).toBe('NOT_OPEN');
    }
  });

  it('투표를 바꾸면 결정되는 시간대가 바뀐다', () => {
    let r = createRoom('r', [req('a'), req('b')], NOW);
    expect(decideBand(r)).toBe('b12');
    r = unwrap(vote(r, 'a', ['b13'], NOW));
    r = unwrap(vote(r, 'b', ['b13'], NOW));
    expect(decideBand(r)).toBe('b13');
    // 확정된 약속 시각도 같은 시간대를 따른다 (13시 KST = 04:00 UTC)
    const done = unwrap(answer(unwrap(answer(r, 'a', 'accepted', NOW)), 'b', 'accepted', NOW));
    expect(done.status).toBe('confirmed');
    expect(confirmedMeetAt(done)).toBe('2026-09-22T04:00:00.000Z');
  });
});

describe('같은 과만 · 차단 (그룹 전체 기준)', () => {
  it('셋 중 한 명이라도 안 맞으면 그 사람은 빠진다', () => {
    const target = req('a', { size: 3, tags: ['같은 과만', 'dept:컴공'] });
    const waiting = [
      req('b', { size: 3, tags: ['dept:패션'], createdAt: '2026-09-22T00:00:00.000Z' }),
      req('c', { size: 3, tags: ['dept:컴공'], createdAt: '2026-09-22T00:10:00.000Z' }),
      req('d', { size: 3, tags: ['dept:컴공'], createdAt: '2026-09-22T00:20:00.000Z' }),
    ];
    // b 는 가장 오래 기다렸지만 과가 달라서 건너뛴다
    expect(findGroup(waiting, target, never)?.map((r) => r.id)).toEqual(['a', 'c', 'd']);
  });

  it('후보끼리 차단 관계면 같이 묶이지 않는다', () => {
    const target = req('a', { size: 3 });
    const waiting = [
      req('b', { size: 3, createdAt: '2026-09-22T00:00:00.000Z' }),
      req('c', { size: 3, createdAt: '2026-09-22T00:10:00.000Z' }),
      req('d', { size: 3, createdAt: '2026-09-22T00:20:00.000Z' }),
    ];
    const hidden = (x: string, y: string) => [x, y].sort().join() === 'b,c';
    // b 와 c 는 서로 차단 → a, b, d 가 된다
    expect(findGroup(waiting, target, hidden)?.map((r) => r.id)).toEqual(['a', 'b', 'd']);
  });

  it('이미 매칭됐거나 취소된 대기표와는 맞지 않는다', () => {
    expect(isCompatible(req('a'), req('b', { status: 'matched' }), never)).toBe(false);
    expect(isCompatible(req('a'), req('b', { status: 'cancelled' }), never)).toBe(false);
    expect(isCompatible(req('a'), req('a'), never)).toBe(false);
  });

  it('방 안에 차단 관계인 두 사람이 있는지 본다', () => {
    const room = createRoom('r', [req('a', { size: 3 }), req('b', { size: 3 }), req('c', { size: 3 })], NOW);
    expect(hasBlockedPair(room, never)).toBe(false);
    expect(hasBlockedPair(room, (x, y) => [x, y].sort().join() === 'a,c')).toBe(true);
  });
});

describe('지난 시간대', () => {
  // 2026-09-22 12:30 KST = 03:30 UTC → 11시·12시 구간은 이미 시작했고 13시부터 남는다
  const LATE = '2026-09-22T03:30:00.000Z';

  it('이미 시작한 시간대는 뺀다', () => {
    expect(futureBands('2026-09-22', ['b11', 'b12', 'b13', 'b17'], LATE)).toEqual(['b13', 'b17']);
    expect(futureBands('2026-09-22', ['b11', 'b12'], LATE)).toEqual([]);
    expect(futureBands('2026-09-23', ['b11'], LATE)).toEqual(['b11']);
  });

  it('방에서 지난 시간대를 빼고, 표가 사라진 사람은 남은 시간대 전부에 표를 준다', () => {
    let room = createRoom('r', [req('a', { bands: ['b12', 'b13'] }), req('b', { bands: ['b12', 'b13'] })], NOW);
    room = unwrap(vote(room, 'a', ['b12'], NOW)); // a 는 12시만 골랐다
    const pruned = dropPastBands(room, LATE);
    expect(pruned?.bands).toEqual(['b13']);
    expect(pruned?.votes['a']).toEqual(['b13']);
    expect(pruned?.votes['b']).toEqual(['b13']);
    // 아무것도 안 지났으면 같은 방을 그대로 돌려준다
    expect(dropPastBands(room, NOW)).toBe(room);
  });

  it('남은 시간대가 없으면 null (방을 깨야 한다)', () => {
    const room = createRoom('r', [req('a', { bands: ['b12'] }), req('b', { bands: ['b12'] })], NOW);
    expect(dropPastBands(room, LATE)).toBeNull();
  });

  it('확정된 약속은 시각이 지나고 3시간 뒤에 끝난 것으로 본다', () => {
    const confirmed: QuickRoom = {
      ...unwrap(answer(unwrap(answer(createRoom('r', [req('a'), req('b')], NOW), 'a', 'accepted', NOW)), 'b', 'accepted', NOW)),
    };
    expect(confirmed.status).toBe('confirmed');
    // 약속 12:00 KST = 03:00 UTC
    expect(isFinishedRoom(confirmed, '2026-09-22T05:59:00.000Z')).toBe(false);
    expect(isFinishedRoom(confirmed, '2026-09-22T06:00:00.000Z')).toBe(true);
    expect(isFinishedRoom({ ...confirmed, status: 'pending' }, '2026-09-23T00:00:00.000Z')).toBe(false);
  });
});

describe('날짜', () => {
  it('실제 달력에 있는 날짜만 받는다', () => {
    expect(isRealDate('2026-09-22')).toBe(true);
    expect(isRealDate('2028-02-29')).toBe(true);
    expect(isRealDate('2026-02-29')).toBe(false);
    expect(isRealDate('2026-02-31')).toBe(false);
    expect(isRealDate('2026-13-01')).toBe(false);
    expect(isRealDate('2026-9-22')).toBe(false);
    expect(isRealDate('abcd-ef-gh')).toBe(false);
  });

  it('한국 날짜는 UTC+9 로 계산한다', () => {
    expect(kstDate('2026-09-22T14:59:59.000Z')).toBe('2026-09-22');
    expect(kstDate('2026-09-22T15:00:00.000Z')).toBe('2026-09-23');
  });
});

describe('신청 본문 검증 (parseQuickInput)', () => {
  const good = { date: '2026-09-22', placeType: '학식', size: 2, bands: ['b12'], tags: ['조용히 먹기'] };
  const code = (raw: unknown) => {
    const r = parseQuickInput(raw);
    return r.ok ? 'OK' : r.error.code;
  };

  it('정상 입력은 그대로 통과한다', () => {
    const r = parseQuickInput(good);
    expect(r.ok && r.value).toEqual(good);
  });

  it('잘못된 모양은 INVALID', () => {
    expect(code(null)).toBe('INVALID');
    expect(code('x')).toBe('INVALID');
    expect(code([])).toBe('INVALID');
    expect(code({ ...good, date: '2026-9-22' })).toBe('INVALID');
    expect(code({ ...good, date: '2026-02-31' })).toBe('INVALID');
    expect(code({ ...good, date: 20260922 })).toBe('INVALID');
    expect(code({ ...good, placeType: '집' })).toBe('INVALID');
    expect(code({ ...good, size: 1 })).toBe('INVALID');
    expect(code({ ...good, size: 5 })).toBe('INVALID');
    expect(code({ ...good, size: 2.5 })).toBe('INVALID');
    expect(code({ ...good, size: '2' })).toBe('INVALID');
    expect(code({ ...good, bands: [] })).toBe('INVALID');
    expect(code({ ...good, bands: ['b99'] })).toBe('INVALID');
    expect(code({ ...good, bands: ['b12', 'b99'] })).toBe('INVALID');
    expect(code({ ...good, bands: 'b12' })).toBe('INVALID');
    expect(code({ ...good, bands: [12] })).toBe('INVALID');
    expect(code({ ...good, tags: 'x' })).toBe('INVALID');
    expect(code({ ...good, tags: [1] })).toBe('INVALID');
    expect(code({ ...good, tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })).toBe('INVALID');
    expect(code({ ...good, tags: ['가'.repeat(21)] })).toBe('INVALID');
  });

  it('인원 2·3·4 와 모든 장소·시간대를 받는다', () => {
    for (const size of [2, 3, 4]) expect(code({ ...good, size })).toBe('OK');
    for (const placeType of ['학식', '학교 주변', '기타']) expect(code({ ...good, placeType })).toBe('OK');
    expect(code({ ...good, bands: ['b11', 'b12', 'b13', 'b17', 'b18', 'b19'] })).toBe('OK');
  });

  it('NUL·짝 없는 서로게이트·제어문자·줄바꿈이 든 태그는 INVALID (jsonb 저장 때 500 이 되지 않게)', () => {
    const unsafe = ['a\u0000b', '\u0000', 'x\ud800', '\udc00y', 'a\u0001b', 'a\u001fb', 'a\u007fb', 'a\nb', 'a\tb', 'a\rb'];
    for (const tag of unsafe) {
      expect(code({ ...good, tags: [tag] }), JSON.stringify(tag)).toBe('INVALID');
      expect(code({ ...good, tags: ['정상', tag] }), JSON.stringify(tag)).toBe('INVALID');
    }
    // 조용히 버려지는 dept: 태그라도 글자가 위험하면 거절한다 (버리기 전에 검사한다)
    expect(code({ ...good, tags: ['dept:a\u0000'] })).toBe('INVALID');
  });

  it('통과한 태그는 JSON 으로 바꿔 DB(jsonb)에 넣어도 안전하다', () => {
    const r = parseQuickInput({ ...good, tags: ['😀 점심', '  조용히  ', '끝줄바꿈\n', '한성대'] });
    expect(r.ok && r.value.tags).toEqual(['😀 점심', '조용히', '끝줄바꿈', '한성대']);
    const json = JSON.stringify(r.ok ? r.value.tags : []);
    expect(json).not.toMatch(/\\u0000|\\ud[89ab]/i);
    expect(JSON.parse(json)).toEqual(['😀 점심', '조용히', '끝줄바꿈', '한성대']);
  });

  it('tags 는 생략해도 되고, 중복은 합치고, 내부 태그(dept:)는 조용히 버린다', () => {
    const { tags: _omit, ...withoutTags } = good;
    const r = parseQuickInput(withoutTags);
    expect(r.ok && r.value.tags).toEqual([]);

    const forged = parseQuickInput({ ...good, tags: ['같은 과만', 'dept:컴퓨터공학부', '같은 과만', ' '], bands: ['b12', 'b12'] });
    expect(forged.ok && forged.value.tags).toEqual(['같은 과만']);
    expect(forged.ok && forged.value.bands).toEqual(['b12']);
  });
});

describe('화면용 대기표', () => {
  it('내부 태그(dept:)와 주인 id 를 내려보내지 않는다', () => {
    const view = toRequestView(req('a', { tags: ['같은 과만', 'dept:컴공'] }));
    expect(view.tags).toEqual(['같은 과만']);
    expect(JSON.stringify(view)).not.toContain('dept:');
    expect('userId' in view).toBe(false);
  });
});
