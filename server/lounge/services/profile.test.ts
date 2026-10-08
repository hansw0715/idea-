import { describe, expect, it } from 'vitest';
import {
  DEPARTMENT_CHANGE_COOLDOWN_DAYS,
  currentYearKst,
  decideDepartmentChange,
  departmentLockedMessage,
  departmentMustMatchSchoolMessage,
  toMeResponse,
  validateDepartment,
  validateNickname,
  validateProfileInput,
} from './profile.js';
import type { LoungeUser } from '../users.js';

const NOW = new Date('2026-10-08T05:00:00Z'); // KST 2026-10-08 14:00

const valid = {
  nickname: '하늘',
  college: 'IT공과대학',
  department: '컴퓨터공학부',
  admissionYear: 2024,
  avatar: 'bear',
  avatarColor: 'm1',
};

const invalid = (r: ReturnType<typeof validateProfileInput>) => {
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error('unreachable');
  expect(r.error.code).toBe('INVALID');
  return r.error.message;
};

describe('validateNickname — 코드포인트 기준 길이', () => {
  it('한글 2~8자는 통과, 1자·9자는 거절', () => {
    expect(validateNickname('하늘')).toEqual({ ok: true, value: '하늘' });
    expect(validateNickname('가나다라마바사아').ok).toBe(true); // 8자
    expect(validateNickname('가').ok).toBe(false);
    expect(validateNickname('가나다라마바사아자').ok).toBe(false); // 9자
  });

  it('이모지는 UTF-16 길이(2)가 아니라 한 글자로 센다', () => {
    expect(validateNickname('😀😀').ok).toBe(true); // 2글자 (UTF-16 길이로는 4)
    expect(validateNickname('😀😀😀😀😀😀😀😀').ok).toBe(true); // 8글자 (UTF-16 길이 16)
    expect(validateNickname('😀😀😀😀😀😀😀😀😀').ok).toBe(false); // 9글자
    expect(validateNickname('😀').ok).toBe(false); // 1글자
  });

  it('이모지 ZWJ 조합은 허용한다 (보이지 않는 다른 서식 문자는 거절)', () => {
    expect(validateNickname('👩‍💻곰').ok).toBe(true);
    expect(validateNickname('가​나').ok).toBe(false); // 폭 없는 공백
    expect(validateNickname('‮가나').ok).toBe(false); // 오른쪽→왼쪽 덮어쓰기
  });

  it('앞뒤 공백은 지운다', () => {
    expect(validateNickname('  하늘  ')).toEqual({ ok: true, value: '하늘' });
    expect(validateNickname('　하늘 ')).toEqual({ ok: true, value: '하늘' });
  });

  it('조합형(NFD) 한글도 완성형 기준으로 세고 완성형으로 저장한다', () => {
    const nfd = '하늘'.normalize('NFD'); // 자모 6개
    expect(nfd.length).toBeGreaterThan(2);
    expect(validateNickname(nfd)).toEqual({ ok: true, value: '하늘' });
  });

  it('공백 연속 금지 (공백 한 개는 허용)', () => {
    expect(validateNickname('하 늘').ok).toBe(true);
    expect(validateNickname('하  늘').ok).toBe(false);
    expect(validateNickname('하　　늘').ok).toBe(false);
    expect(validateNickname('하  늘').ok).toBe(false);
  });

  it('@ 금지 (전각 ＠ 포함)', () => {
    expect(validateNickname('하늘@').ok).toBe(false);
    expect(validateNickname('@하늘').ok).toBe(false);
    expect(validateNickname('하＠늘').ok).toBe(false);
  });

  it('제어 문자 금지 (줄바꿈·탭·NUL)', () => {
    for (const bad of ['하늘\n', '하\n늘', '하\t늘', '하늘\u0000', '하늘\u007F', '하늘\u0085']) {
      expect(validateNickname(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('문자열이 아니면 INVALID', () => {
    for (const bad of [undefined, null, 123, true, ['하늘'], { nickname: '하늘' }]) {
      const r = validateNickname(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('INVALID');
    }
  });

  it('거절 문장은 무엇이 왜 틀렸는지 알려 준다', () => {
    const msg = (v: unknown) => {
      const r = validateNickname(v);
      return r.ok ? '' : r.error.message;
    };
    expect(msg('가')).toContain('2~8자');
    expect(msg('하@늘')).toContain('@');
    expect(msg('하  늘')).toContain('공백');
    expect(msg('하\n늘')).toContain('제어');
  });
});

describe('validateDepartment', () => {
  it('1~30자, 앞뒤 공백 제거, 안쪽 공백 연속은 하나로 정리', () => {
    expect(validateDepartment('  컴퓨터공학부 ')).toEqual({ ok: true, value: '컴퓨터공학부' });
    expect(validateDepartment('AI   응용  학과')).toEqual({ ok: true, value: 'AI 응용 학과' });
    expect(validateDepartment('가'.repeat(30)).ok).toBe(true);
    expect(validateDepartment('가'.repeat(31)).ok).toBe(false);
    expect(validateDepartment('').ok).toBe(false);
    expect(validateDepartment('   ').ok).toBe(false);
  });

  it('문자열이 아니거나 제어 문자가 있으면 거절', () => {
    for (const bad of [undefined, null, 5, ['a'], '학과\n', '학\u0000과']) {
      expect(validateDepartment(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('조합형 한글을 완성형으로 맞춰서 같은 학과끼리 비교가 어긋나지 않게 한다', () => {
    expect(validateDepartment('경영학부'.normalize('NFD'))).toEqual({ ok: true, value: '경영학부' });
  });
});

describe('decideDepartmentChange — 학과를 바꿔 보며 남의 학과를 알아내는 길 막기', () => {
  const DAY = 86_400_000;
  const T0 = new Date('2026-09-01T03:00:00Z');
  const after = (days: number, from = T0) => new Date(from.getTime() + days * DAY);
  const base = { current: '컴퓨터공학부', changedAt: T0, verified: null as string | null, requested: '경영학부' };

  it('같은 학과로 저장하는 것(닉네임·아바타만 고치는 경우)은 언제나 통과하고 기록을 건드리지 않는다', () => {
    expect(decideDepartmentChange({ ...base, requested: '컴퓨터공학부', now: after(1) })).toEqual({ kind: 'unchanged' });
    // 저장된 값이 조합형(NFD)·공백이 섞여 있어도 같은 학과로 본다
    expect(
      decideDepartmentChange({ ...base, current: ' 컴퓨터공학부 '.normalize('NFD'), requested: '컴퓨터공학부', now: after(1) }),
    ).toEqual({ kind: 'unchanged' });
  });

  it('처음 정하는 것은 자유롭다 (학과가 비어 있는 프로필)', () => {
    expect(decideDepartmentChange({ ...base, current: '', changedAt: null, now: T0 })).toEqual({ kind: 'change', why: 'first' });
    expect(decideDepartmentChange({ ...base, current: '   ', changedAt: null, now: T0 })).toEqual({ kind: 'change', why: 'first' });
  });

  it('정한 뒤 30일 안에는 어떤 학과로도 바꿀 수 없다 — 시도를 몇 번 해도 같다', () => {
    expect(DEPARTMENT_CHANGE_COOLDOWN_DAYS).toBe(30);
    for (const candidate of ['경영학부', 'AI응용학과', '융합행정학부', '패션디자인트랙']) {
      for (const days of [0, 1, 15, 29.99]) {
        const r = decideDepartmentChange({ ...base, requested: candidate, now: after(days) });
        expect(r.kind, `${candidate} +${days}d`).toBe('locked');
        if (r.kind === 'locked') expect(r.until).toEqual(after(30));
      }
    }
  });

  it('30일이 지나면 바꿀 수 있다 (경계: 정확히 30일째부터)', () => {
    expect(decideDepartmentChange({ ...base, now: new Date(after(30).getTime() - 1) }).kind).toBe('locked');
    expect(decideDepartmentChange({ ...base, now: after(30) })).toEqual({ kind: 'change', why: 'cooldown-over' });
    expect(decideDepartmentChange({ ...base, now: after(400) })).toEqual({ kind: 'change', why: 'cooldown-over' });
  });

  it('제한이 생기기 전에 만든 프로필(변경 시각 없음)은 한 번 바꿀 수 있고, 그 변경부터 시각이 남는다', () => {
    expect(decideDepartmentChange({ ...base, changedAt: null, now: T0 })).toEqual({ kind: 'change', why: 'unknown-age' });
  });

  it('학교 계정으로 확인된 학과가 있으면 그 값만 쓸 수 있다 (기간과 무관)', () => {
    const linked = { ...base, verified: 'AI응용학과' };
    // 다른 값은 — 아직 기간이 안 지났든 지났든, 처음이든 — 모두 거절
    for (const requested of ['경영학부', '컴퓨터공학부', 'AI 응용학과']) {
      expect(decideDepartmentChange({ ...linked, requested, now: after(1) })).toEqual({ kind: 'must-match-school', verified: 'AI응용학과' });
      expect(decideDepartmentChange({ ...linked, requested, now: after(100) })).toEqual({ kind: 'must-match-school', verified: 'AI응용학과' });
    }
    expect(decideDepartmentChange({ ...linked, current: '', changedAt: null, requested: '경영학부', now: T0 }).kind).toBe('must-match-school');
    // 확인된 값으로 맞추는 것은 30일 제한이 있어도 바로 된다
    expect(decideDepartmentChange({ ...linked, requested: 'AI응용학과', now: after(1) })).toEqual({ kind: 'change', why: 'school' });
    // 이미 그 값이면 그대로
    expect(decideDepartmentChange({ ...linked, current: 'AI응용학과', requested: 'AI응용학과', now: after(1) })).toEqual({ kind: 'unchanged' });
  });

  it('문장: 날짜는 한국 날짜로, 연동 안내와 확인된 학과가 들어간다', () => {
    // 2026-10-01 20:00Z = KST 10-02 05:00
    const msg = departmentLockedMessage(new Date('2026-10-01T20:00:00Z'));
    expect(msg).toContain('30일');
    expect(msg).toContain('10월 2일');
    expect(msg).toContain('학교 계정을 연동');
    expect(departmentMustMatchSchoolMessage('AI응용학과')).toContain('AI응용학과');
  });
});

describe('currentYearKst — 올해(KST) 계산', () => {
  it('12월 31일 24시(KST) 직전까지는 그 해, 정각부터는 새해', () => {
    expect(currentYearKst(new Date('2025-12-31T14:59:59Z'))).toBe(2025); // KST 23:59:59
    expect(currentYearKst(new Date('2025-12-31T15:00:00Z'))).toBe(2026); // KST 00:00:00
    expect(currentYearKst(new Date('2026-06-15T00:00:00Z'))).toBe(2026);
  });
});

describe('validateProfileInput', () => {
  it('정상 입력은 정규화된 6개 필드만 돌려준다 (평판·권한 필드가 섞여 와도 버린다)', () => {
    const r = validateProfileInput(
      { ...valid, nickname: ' 하늘 ', temperature: 99, warnings: 0, banned: false, isAdmin: true, profile_done: false },
      NOW,
    );
    expect(r).toEqual({ ok: true, value: { ...valid } });
    if (r.ok) expect(Object.keys(r.value).sort()).toEqual(Object.keys(valid).sort());
  });

  it('본문이 객체가 아니면 INVALID', () => {
    for (const bad of [undefined, null, 'x', 5, [], [valid]]) {
      invalid(validateProfileInput(bad, NOW));
    }
  });

  it('단과대는 목록에 있어야 한다', () => {
    expect(invalid(validateProfileInput({ ...valid, college: '없는대학' }, NOW))).toContain('단과대');
    expect(invalid(validateProfileInput({ ...valid, college: undefined }, NOW))).toContain('단과대');
    expect(invalid(validateProfileInput({ ...valid, college: ['IT공과대학'] }, NOW))).toContain('단과대');
  });

  it('입학년도: 정수만, 2015 이상 올해(KST) 이하', () => {
    const year = (y: unknown, now = NOW) => validateProfileInput({ ...valid, admissionYear: y }, now);
    expect(year(2015).ok).toBe(true);
    expect(year(2026).ok).toBe(true);
    expect(invalid(year(2014))).toContain('입학년도');
    expect(invalid(year(2027))).toContain('2026년');
    expect(invalid(year(2024.5))).toContain('입학년도');
    expect(invalid(year('2024'))).toContain('입학년도');
    expect(invalid(year(Number.NaN))).toContain('입학년도');
    expect(invalid(year(Infinity))).toContain('입학년도');
    expect(invalid(year(null))).toContain('입학년도');
    // 해가 바뀌는 경계: UTC 로는 아직 2025-12-31 이어도 KST 로는 2026
    expect(year(2026, new Date('2025-12-31T15:00:00Z')).ok).toBe(true);
    expect(year(2026, new Date('2025-12-31T14:59:59Z')).ok).toBe(false);
  });

  it('아바타·색은 목록에 있어야 한다', () => {
    expect(invalid(validateProfileInput({ ...valid, avatar: 'dragon' }, NOW))).toContain('아바타');
    expect(invalid(validateProfileInput({ ...valid, avatar: 1 }, NOW))).toContain('아바타');
    expect(invalid(validateProfileInput({ ...valid, avatarColor: 'm9' }, NOW))).toContain('색');
    expect(invalid(validateProfileInput({ ...valid, avatarColor: '#ff0000' }, NOW))).toContain('색');
  });

  it('닉네임 오류가 있으면 그 문장을 그대로 돌려준다', () => {
    expect(invalid(validateProfileInput({ ...valid, nickname: '가' }, NOW))).toContain('닉네임');
    expect(invalid(validateProfileInput({ ...valid, nickname: 42 }, NOW))).toContain('닉네임');
  });

  it('프로토타입 키로 오염된 객체도 필드 검증만 본다', () => {
    const polluted = JSON.parse('{"__proto__":{"admin":true},"nickname":"하늘","college":"IT공과대학","department":"컴공","admissionYear":2024,"avatar":"bear","avatarColor":"m1"}');
    const r = validateProfileInput(polluted, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect('admin' in r.value).toBe(false);
  });
});

describe('toMeResponse', () => {
  const user: LoungeUser = {
    id: '7',
    name: '실명입니다',
    nickname: '하늘',
    college: 'IT공과대학',
    department: '컴퓨터공학부',
    admissionYear: 2024,
    avatar: 'bear',
    avatarColor: 'm1',
    temperature: 36.5,
    warnings: 1,
    banned: false,
    isAdmin: false,
    profileDone: true,
  };

  it('프로필이 있으면 profile, 없으면 null + needsProfile', () => {
    const done = toMeResponse(user);
    expect(done.needsProfile).toBe(false);
    expect(done.profile?.nickname).toBe('하늘');
    expect(done.profile?.warnings).toBe(1);

    const none = toMeResponse({ ...user, profileDone: false, nickname: '' });
    expect(none).toEqual({ profile: null, needsProfile: true, isAdmin: false });
  });

  it('isAdmin 을 그대로 전달하고 실명을 응답에 넣지 않는다', () => {
    const r = toMeResponse({ ...user, isAdmin: true });
    expect(r.isAdmin).toBe(true);
    expect(JSON.stringify(r)).not.toContain('실명입니다');
  });
});
