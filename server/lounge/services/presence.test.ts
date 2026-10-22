import { describe, expect, it } from 'vitest';
import { EMOTE_TTL_MS } from '../../../shared/lounge/constants.js';
import type { PresenceRow } from '../repo/presence.js';
import { toPresenceUser, validatePresenceInput, visibleEmote } from './presence.js';

const ok = { x: 0.5, y: 0.25, zone: 'plaza' };

describe('validatePresenceInput', () => {
  it('x,y 는 0~1 (양 끝 포함), zone 은 목록에 있는 값', () => {
    expect(validatePresenceInput(ok)).toEqual({ ok: true, value: ok });
    expect(validatePresenceInput({ x: 0, y: 1, zone: 'meal' }).ok).toBe(true);
    for (const zone of ['plaza', 'meetup', 'meal']) {
      expect(validatePresenceInput({ ...ok, zone }).ok).toBe(true);
    }
  });

  it('범위 밖·숫자가 아닌 좌표는 INVALID', () => {
    for (const bad of [-0.001, 1.001, 2, -1, Number.NaN, Infinity, -Infinity, '0.5', null, undefined, [0.5], {}]) {
      const r = validatePresenceInput({ ...ok, x: bad });
      expect(r.ok, `x=${String(bad)}`).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('INVALID');
      expect(validatePresenceInput({ ...ok, y: bad }).ok, `y=${String(bad)}`).toBe(false);
    }
  });

  it('알 수 없는 구역은 INVALID', () => {
    for (const zone of ['lobby', 'bus', '', 'PLAZA', null, undefined, 1, ['plaza']]) {
      expect(validatePresenceInput({ ...ok, zone }).ok, String(zone)).toBe(false);
    }
  });

  it('이모트는 생략하거나 목록의 key 만', () => {
    expect(validatePresenceInput({ ...ok, emote: 'wave' })).toEqual({ ok: true, value: { ...ok, emote: 'wave' } });
    for (const key of ['wave', 'smile', 'thanks', 'heart']) {
      expect(validatePresenceInput({ ...ok, emote: key }).ok).toBe(true);
    }
    expect(validatePresenceInput({ ...ok, emote: null }).ok).toBe(true); // null 은 "없음"
    const noEmote = validatePresenceInput({ ...ok, emote: null });
    if (noEmote.ok) expect('emote' in noEmote.value).toBe(false);
    for (const bad of ['👋', 'angry', '', 1, ['wave'], {}]) {
      const r = validatePresenceInput({ ...ok, emote: bad });
      expect(r.ok, String(bad)).toBe(false);
    }
  });

  it('본문이 객체가 아니면 INVALID, 알 수 없는 필드는 버린다', () => {
    for (const bad of [undefined, null, 'x', 1, []]) expect(validatePresenceInput(bad).ok).toBe(false);
    const r = validatePresenceInput({ ...ok, userId: '1', admin: true });
    expect(r).toEqual({ ok: true, value: ok });
  });
});

describe('visibleEmote — 이모트는 EMOTE_TTL_MS 안에서만', () => {
  const now = new Date('2026-10-08T05:00:00Z');
  const at = (msAgo: number) => new Date(now.getTime() - msAgo);

  it('TTL 안이면 보이고, 지나면 감춘다 (경계는 포함)', () => {
    expect(visibleEmote({ emote: 'wave', emoteAt: at(0) }, now)).toBe('wave');
    expect(visibleEmote({ emote: 'heart', emoteAt: at(EMOTE_TTL_MS) }, now)).toBe('heart');
    expect(visibleEmote({ emote: 'heart', emoteAt: at(EMOTE_TTL_MS + 1) }, now)).toBeNull();
  });

  it('이모트나 시각이 없거나 알 수 없는 값이면 null', () => {
    expect(visibleEmote({ emote: null, emoteAt: at(0) }, now)).toBeNull();
    expect(visibleEmote({ emote: 'wave', emoteAt: null }, now)).toBeNull();
    expect(visibleEmote({ emote: 'unknown', emoteAt: at(0) }, now)).toBeNull();
  });
});

describe('toPresenceUser', () => {
  const now = new Date('2026-10-08T05:00:00Z');
  const row: PresenceRow = {
    userId: '12',
    x: 0.3,
    y: 0.7,
    zone: 'meetup',
    emote: 'smile',
    emoteAt: new Date(now.getTime() - 1000),
    seenAt: new Date(now.getTime() - 2000),
    nickname: '하늘',
    college: 'IT공과대학',
    department: '컴퓨터공학부',
    admissionYear: 2024,
    gender: 'female',
    avatar: 'cat-think',
    avatarColor: 'm3',
    temperature: 37.2,
  };

  it('공개 프로필 필드만 담는다 (실명·이메일은 없고, 학과·입학년도는 학교 계정에서 읽은 사실이라 있다)', () => {
    const u = toPresenceUser(row, now);
    expect(u).toEqual({
      user: { id: '12', nickname: '하늘', college: 'IT공과대학', department: '컴퓨터공학부', admissionYear: 2024, gender: 'female', avatar: 'cat-think', avatarColor: 'm3', temperature: 37.2 },
      x: 0.3,
      y: 0.7,
      zone: 'meetup',
      emote: 'smile',
      seenAt: '2026-10-08T04:59:58.000Z',
    });
    expect(Object.keys(u.user).sort()).toEqual(
      ['admissionYear', 'avatar', 'avatarColor', 'college', 'department', 'gender', 'id', 'nickname', 'temperature'].sort(),
    );
  });

  it('DB 에 이상한 아바타·색이 들어 있어도 기본값으로 안전하게 내려보낸다', () => {
    const u = toPresenceUser({ ...row, avatar: 'alien', avatarColor: 'zzz' }, now);
    expect(u.user.avatar).toBe('turtle-smile');
    expect(u.user.avatarColor).toBe('m1');
    expect(toPresenceUser({ ...row, avatar: null, avatarColor: null }, now).user.avatar).toBe('turtle-smile');
  });

  it('TTL 이 지난 이모트는 null', () => {
    const old = toPresenceUser({ ...row, emoteAt: new Date(now.getTime() - EMOTE_TTL_MS - 1) }, now);
    expect(old.emote).toBeNull();
  });
});
