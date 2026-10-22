/**
 * users.ts 의 순수 부분 시험 (DB 없음) — 정지 사유 문구.
 *
 * 고치는 문제: 노쇼 경고가 2회 미만인 정지는 모두 "신고가 누적돼 이용이 정지됐어요" 로 표시됐다.
 * 관리자가 신고 없이 직접 정지(ban)한 사용자에게도 그 문구가 나가 사유가 틀렸다. 정지 사유는 저장하지 않으므로
 * (신고 누적 자동 제한과 관리자 직접 정지는 둘 다 warnings < 2) 어느 쪽에도 맞는 문장만 쓴다.
 */
import { describe, expect, it } from 'vitest';
import { BAN_NOTICE_GENERIC, WARNINGS_TO_BAN } from '../../shared/lounge/constants.js';
import { banReason, toProfile, unknownUser } from './users.js';
import type { LoungeUser } from './users.js';

const user = (over: Partial<LoungeUser> = {}): LoungeUser => ({
  id: '7',
  name: '실명',
  nickname: '하늘',
  college: 'IT공과대학',
  department: '컴퓨터공학부',
  admissionYear: 2024,
  gender: null,
  genderFromSchool: false,
  avatar: 'turtle-smile',
  avatarColor: 'm1',
  temperature: 36.5,
  warnings: 0,
  banned: false,
  isAdmin: false,
  profileDone: true,
  ...over,
});

describe('banReason', () => {
  it('정지가 아니면 null', () => {
    expect(banReason({ banned: false, warnings: 0 })).toBeNull();
    expect(banReason({ banned: false, warnings: WARNINGS_TO_BAN })).toBeNull();
  });

  it('노쇼 경고가 기준에 닿아 정지된 경우만 노쇼라고 말한다', () => {
    expect(banReason({ banned: true, warnings: WARNINGS_TO_BAN })).toBe(`노쇼 경고 ${WARNINGS_TO_BAN}회로 이용이 정지됐어요.`);
    expect(banReason({ banned: true, warnings: WARNINGS_TO_BAN + 1 })).toContain('노쇼');
  });

  it('경고가 기준 미만인 정지(신고 누적 자동 제한 · 관리자 직접 정지)는 사유를 단정하지 않는다', () => {
    for (const warnings of [0, 1]) {
      const reason = banReason({ banned: true, warnings });
      expect(reason).toBe(BAN_NOTICE_GENERIC);
      expect(reason).not.toMatch(/^신고가 누적/); // 관리자가 신고 없이 정지한 사용자에게 틀린 사유를 보이지 않는다
      expect(reason).not.toContain('노쇼');
      expect(reason).toContain('관리자'); // 어느 쪽이든 풀려면 관리자 확인이 필요하다는 안내는 맞다
    }
  });
});

describe('toProfile · unknownUser', () => {
  it('프로필에 정지 사유가 실려 본인에게 보인다', () => {
    expect(toProfile(user({ banned: true, warnings: 0 })).banReason).toBe(BAN_NOTICE_GENERIC);
    expect(toProfile(user()).banReason).toBeNull();
  });

  it('프로필(본인용)이든 공개 사용자든 실명과 이메일은 담기지 않는다', () => {
    const p = toProfile(user()) as Record<string, unknown>;
    expect(JSON.stringify(p)).not.toContain('실명');
    expect('name' in p).toBe(false);
    expect('email' in p).toBe(false);
  });

  it('탈퇴한 사용자 자리는 알아볼 수 있는 표시로 남는다', () => {
    expect(unknownUser('9')).toMatchObject({ id: '9', nickname: '(탈퇴한 사용자)' });
  });
});
