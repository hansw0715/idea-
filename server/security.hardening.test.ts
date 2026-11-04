/**
 * 2026-10-30 보안 점검(cloudflare/security-audit-skill)에서 나온 항목을 고친 부분의 시험.
 * DB 없이 도는 순수 규칙만 모았다. (관리자 아이디 예약·관리자 증표 재확인은 app.http.db.test.ts,
 * 가입 전 학생 인증 상한은 auth.signup.db.test.ts 에 있다)
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { trustProxySetting } from './app.js';
import { createRateLimiter } from './rateLimit.js';
import { isPushServiceEndpoint, parseSubscription } from './lounge/services/push.js';
import { isCampusMonthInRange } from './campusSchedule.js';

describe("'trust proxy' — 프록시 없이 열린 서버는 X-Forwarded-For 를 믿지 않는다", () => {
  it('알려진 프록시 플랫폼에서만 1, 그 밖에는 false', () => {
    expect(trustProxySetting({ VERCEL: '1' })).toBe(1);
    expect(trustProxySetting({ FLY_APP_NAME: 'sangsang' })).toBe(1);
    expect(trustProxySetting({ NETLIFY: 'true' })).toBe(1);
    expect(trustProxySetting({})).toBe(false);
  });
  it('TRUST_PROXY 로 직접 정할 수 있다 (홉 수 또는 false)', () => {
    expect(trustProxySetting({ TRUST_PROXY: '2' })).toBe(2);
    expect(trustProxySetting({ TRUST_PROXY: 'false', VERCEL: '1' })).toBe(false);
    expect(trustProxySetting({ TRUST_PROXY: '0' })).toBe(false);
  });
});

describe('요청 제한 장치는 기억하는 키 수에 상한이 있다', () => {
  it('서로 다른 키를 아무리 많이 넣어도 상한을 넘지 않는다', () => {
    const limiter = createRateLimiter(10, 60_000, 100);
    for (let i = 0; i < 5_000; i++) limiter.hit(`ip:${'x'.repeat(50)}${i}`);
    expect(limiter.size()).toBeLessThanOrEqual(100);
  });
  it('상한 안에서는 제한이 그대로 동작한다', () => {
    const limiter = createRateLimiter(2, 60_000, 100);
    expect(limiter.hit('a')).toBe(true);
    expect(limiter.hit('a')).toBe(true);
    expect(limiter.hit('a')).toBe(false);
  });
});

describe('웹푸시 구독 주소는 브라우저 푸시 서비스만 받는다 (서버가 임의·내부 주소로 요청하지 않게)', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc:def',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QGx',
    'https://wns2-bl2p.notify.windows.com/w/?token=abc',
  ])('허용: %s', (url) => {
    expect(isPushServiceEndpoint(url)).toBe(true);
  });
  it.each([
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/x',
    'https://10.0.0.5/x',
    'https://evil.example.com/push',
    'https://fcm.googleapis.com.evil.com/x',
    'https://fcm.googleapis.com:8443/x',
    'https://user:pw@fcm.googleapis.com/x',
    'http://fcm.googleapis.com/x',
  ])('거절: %s', (url) => {
    expect(isPushServiceEndpoint(url)).toBe(false);
  });
  it('구독 본문 검사도 같은 규칙을 쓴다', () => {
    const keys = { p256dh: 'BOr' + 'a'.repeat(80), auth: 'abcdefghijklmnop' };
    expect(parseSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys })).not.toBeNull();
    expect(parseSubscription({ endpoint: 'https://internal.service.local/hook', keys })).toBeNull();
  });
});

describe('학교 예약 현황은 정해진 달 안에서만 학교 서버에 묻는다', () => {
  const now = new Date('2026-11-04T12:00:00+09:00').getTime();
  it('지난달 ~ 6개월 뒤', () => {
    expect(isCampusMonthInRange(2026, 10, now)).toBe(true);
    expect(isCampusMonthInRange(2026, 11, now)).toBe(true);
    expect(isCampusMonthInRange(2027, 5, now)).toBe(true);
  });
  it('그 밖의 달·잘못된 값은 묻지 않는다', () => {
    expect(isCampusMonthInRange(2026, 9, now)).toBe(false);
    expect(isCampusMonthInRange(2027, 6, now)).toBe(false);
    expect(isCampusMonthInRange(9999, 1, now)).toBe(false);
    expect(isCampusMonthInRange(2026, 13, now)).toBe(false);
  });
});

describe('Docker 이미지에 비밀 파일이 들어가지 않는다', () => {
  it('.dockerignore 가 .env*·.vercel 을 뺀다', () => {
    const lines = fs.readFileSync(path.resolve(process.cwd(), '.dockerignore'), 'utf8').split(/\r?\n/);
    for (const p of ['.env', '.env.*', '.vercel']) expect(lines).toContain(p);
  });
});
