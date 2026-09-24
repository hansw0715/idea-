import { describe, expect, it } from 'vitest';
import {
  applyReview,
  confirmNoshow,
  DEFAULT_TEMPERATURE,
  initialReputation,
  joinBlockReason,
  liftBan,
  MAX_TEMPERATURE,
  MIN_TEMPERATURE,
  WARNINGS_TO_BAN,
} from './reputation';

describe('매너온도', () => {
  it('36.5도에서 시작한다', () => {
    expect(initialReputation()).toEqual({ temperature: DEFAULT_TEMPERATURE, warnings: 0, banned: false });
  });

  it('좋았어요는 온도를 올리고, 보통이에요는 그대로 둔다', () => {
    const good = applyReview(initialReputation(), 'good');
    expect(good.temperature).toBe(36.9);
    expect(applyReview(good, 'soso').temperature).toBe(36.9);
  });

  it('소수점 한 자리로 유지된다', () => {
    let s = initialReputation();
    for (let i = 0; i < 7; i++) s = applyReview(s, 'good');
    expect(s.temperature).toBe(39.3);
  });

  it('온도는 최댓값을 넘지 않는다', () => {
    let s = { temperature: MAX_TEMPERATURE - 0.2, warnings: 0, banned: false };
    s = applyReview(s, 'good');
    expect(s.temperature).toBe(MAX_TEMPERATURE);
  });

  it('온도는 0 밑으로 안 내려간다', () => {
    const s = confirmNoshow({ temperature: 1, warnings: 0, banned: false });
    expect(s.temperature).toBe(MIN_TEMPERATURE);
  });
});

describe('노쇼 경고', () => {
  it('노쇼가 확정되면 경고가 쌓이고 온도가 떨어진다', () => {
    const s = confirmNoshow(initialReputation());
    expect(s.warnings).toBe(1);
    expect(s.temperature).toBe(31.5);
    expect(s.banned).toBe(false);
  });

  it(`경고 ${WARNINGS_TO_BAN}회면 이용이 정지된다`, () => {
    let s = initialReputation();
    for (let i = 0; i < WARNINGS_TO_BAN; i++) s = confirmNoshow(s);
    expect(s.banned).toBe(true);
    expect(joinBlockReason(s)).toContain('정지');
  });

  it('신고 누적으로 정지되면 다른 문구가 나온다', () => {
    expect(joinBlockReason({ temperature: 36.5, warnings: 0, banned: true })).toContain('신고');
  });

  it('경고 1회는 아직 참여할 수 있다', () => {
    expect(joinBlockReason(confirmNoshow(initialReputation()))).toBeNull();
  });

  it('관리자가 정지를 풀면 경고도 초기화된다', () => {
    let s = initialReputation();
    for (let i = 0; i < WARNINGS_TO_BAN; i++) s = confirmNoshow(s);
    const lifted = liftBan(s);
    expect(lifted).toMatchObject({ banned: false, warnings: 0 });
    // 떨어진 온도는 그대로 둔다 — 기록까지 지우지는 않는다.
    expect(lifted.temperature).toBe(s.temperature);
  });
});
