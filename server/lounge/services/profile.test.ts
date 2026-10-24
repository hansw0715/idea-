import { describe, expect, it } from 'vitest';
import { PROFILE_LOCKED_MESSAGE, currentYearKst, toMeResponse, validateProfileUpdate } from './profile.js';
import type { LoungeUser } from '../users.js';
import { AVATARS, normalizeAvatar } from '../../../shared/lounge/constants.js';

describe('새 마스코트 선택과 이전 표정 호환', () => {
  it('예전 표정은 같은 캐릭터로 표시하고 선택지는 새 다섯 개만 제공한다', () => {
    expect(AVATARS.map((a) => a.label)).toEqual(['상상부기', '한성냥이', '상찌', '꼬꼬', '꾸꾸']);
    expect(normalizeAvatar('turtle-cry')).toBe('turtle-smile');
    expect(normalizeAvatar('cat-surprised')).toBe('cat-think');
    expect(normalizeAvatar('frog-tongue')).toBe('frog-tongue');
    expect(normalizeAvatar('kkukku')).toBe('kkukku');
    expect(normalizeAvatar(null)).toBe('turtle-smile');
  });
  it('새 캐릭터 선택을 저장하고 없어진 표정은 새 선택으로 받지 않는다', () => {
    expect(validateProfileUpdate({ avatar: 'kkukku', avatarColor: 'm1' })).toEqual({ ok: true, value: { avatar: 'kkukku', avatarColor: 'm1' } });
    expect(validateProfileUpdate({ avatar: 'turtle-love', avatarColor: 'm1' }).ok).toBe(false);
  });
});

describe('currentYearKst — 올해(KST) 계산', () => {
  it('12월 31일 24시(KST) 직전까지는 그 해, 정각부터는 새해', () => {
    expect(currentYearKst(new Date('2025-12-31T14:59:59Z'))).toBe(2025); // KST 23:59:59
    expect(currentYearKst(new Date('2025-12-31T15:00:00Z'))).toBe(2026); // KST 00:00:00
    expect(currentYearKst(new Date('2026-06-15T00:00:00Z'))).toBe(2026);
  });
});

describe('validateProfileUpdate — 아바타 색만 받는다', () => {
  it('목록에 있는 색이면 통과, 평판·권한 필드가 섞여 와도 값에는 색만 남는다', () => {
    const r = validateProfileUpdate({ avatarColor: 'm3', temperature: 99, isAdmin: true, banned: false });
    expect(r).toEqual({ ok: true, value: { avatarColor: 'm3' } });
  });

  it('이름·단과대·학과·입학년도·아바타를 보내면 값이 같아도 INVALID', () => {
    for (const k of ['nickname', 'college', 'department', 'admissionYear']) {
      const r = validateProfileUpdate({ avatarColor: 'm1', [k]: undefined });
      expect(r.ok, k).toBe(false);
      if (!r.ok) expect(r.error).toMatchObject({ code: 'INVALID', message: PROFILE_LOCKED_MESSAGE });
    }
  });

  it('객체가 아니거나 색이 없거나 목록 밖이면 INVALID', () => {
    for (const bad of [null, undefined, 'm1', 3, [], {}, { avatarColor: 'm9' }, { avatarColor: '#fff' }, { avatarColor: 1 }, { avatarColor: ['m1'] }]) {
      const r = validateProfileUpdate(bad);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('INVALID');
    }
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
    gender: null,
    genderFromSchool: false,
    avatar: 'turtle-smile',
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
