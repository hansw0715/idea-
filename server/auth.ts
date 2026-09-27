import { Router } from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { get, run, insert, isServerless, resolveDataDir } from './db.js';
import { createRateLimiter } from './rateLimit.js';
import { sendVerificationCode } from './mailer.js';

function loadSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (isServerless) {
    // 서버리스에서는 인스턴스마다 파일이 달라 세션이 무작위로 끊기므로 환경 변수를 강제한다.
    throw new Error(
      'JWT_SECRET 환경 변수가 필요합니다. 배포 환경 설정에 임의의 긴 문자열을 등록해 주세요.',
    );
  }
  const dir = resolveDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const secretFile = path.join(dir, 'jwt-secret');
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretFile, secret);
  return secret;
}

let cachedSecret: string | null = null;
function jwtSecret(): string {
  if (cachedSecret === null) cachedSecret = loadSecret();
  return cachedSecret;
}

const TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = (req as Request & { cookies?: Record<string, string> }).cookies?.token;
  if (!token) {
    res.status(401).json({ error: '로그인이 필요합니다.' });
    return;
  }
  try {
    const payload = jwt.verify(token, jwtSecret()) as { uid: number };
    res.locals.userId = payload.uid;
    next();
  } catch {
    res.status(401).json({ error: '세션이 만료되었습니다. 다시 로그인해 주세요.' });
  }
}

export function userId(res: Response): number {
  return res.locals.userId as number;
}

/** async 핸들러의 거부(rejection)를 Express 에러 처리로 넘겨준다. */
export function wrap(
  handler: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

function issueToken(res: Response, uid: number): void {
  const token = jwt.sign({ uid }, jwtSecret(), { expiresIn: '7d' });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    // 서버리스 플랫폼은 항상 HTTPS로 서빙되므로 NODE_ENV 설정 여부와 무관하게 Secure를 켠다.
    // (브라우저는 http://localhost 는 예외로 허용하므로 로컬 테스트도 그대로 된다.)
    secure: process.env.NODE_ENV === 'production' || isServerless,
    maxAge: TOKEN_MAX_AGE_MS,
  });
}

interface UserRow {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  is_admin: boolean;
}

/** 클라이언트로 내보낼 사용자 정보. 비밀번호 해시는 절대 포함하지 않는다. */
function publicUser(row: Pick<UserRow, 'id' | 'email' | 'name' | 'is_admin'>) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    isAdmin: Boolean(row.is_admin),
  };
}

// 한성대 구성원만 가입할 수 있도록 학교 메일 주소만 받는다.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@hansung\.ac\.kr$/;
export const ALLOWED_EMAIL_DOMAIN = 'hansung.ac.kr';

const CODE_TTL_MS = 10 * 60 * 1000; // 인증코드 유효 10분
const MAX_CODE_ATTEMPTS = 5; // 코드 입력 시도 한도
const MAX_SENDS_PER_HOUR = 3; // 같은 주소로 재발송 한도

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return EMAIL_RE.test(email) ? email : null;
}

function generateCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export const authRouter = Router();

// 인증 메일 요청: IP 기준 10분에 10회
const codeRequestLimiter = createRateLimiter(10, 10 * 60 * 1000);

authRouter.post(
  '/request-code',
  wrap(async (req, res) => {
    const email = normalizeEmail((req.body as Record<string, unknown>)?.email);
    if (!email) {
      res.status(400).json({
        error: `학교 이메일(@${ALLOWED_EMAIL_DOMAIN})로만 가입할 수 있습니다.`,
      });
      return;
    }
    if (!codeRequestLimiter.hit(String(req.ip))) {
      res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
      return;
    }

    const existing = await get<{ id: number }>('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      res.status(409).json({ error: '이미 가입된 이메일입니다. 로그인해 주세요.' });
      return;
    }

    // 같은 주소로 너무 자주 보내지 않도록 1시간 기준으로 제한한다.
    const prior = await get<{ sendCount: number; firstSentAt: string }>(
      `SELECT send_count AS "sendCount", first_sent_at AS "firstSentAt"
       FROM email_verifications
       WHERE email = ? AND first_sent_at > now() - interval '1 hour'`,
      [email],
    );
    if (prior && Number(prior.sendCount) >= MAX_SENDS_PER_HOUR) {
      res.status(429).json({
        error: `인증 메일은 1시간에 ${MAX_SENDS_PER_HOUR}번까지 보낼 수 있습니다. 잠시 후 다시 시도해 주세요.`,
      });
      return;
    }

    const code = generateCode();
    const codeHash = bcrypt.hashSync(code, 10);
    await run(
      `INSERT INTO email_verifications (email, code_hash, expires_at, attempts, send_count, first_sent_at)
       VALUES (?, ?, now() + interval '10 minutes', 0, 1, now())
       ON CONFLICT (email) DO UPDATE SET
         code_hash = EXCLUDED.code_hash,
         expires_at = EXCLUDED.expires_at,
         attempts = 0,
         send_count = CASE
           WHEN email_verifications.first_sent_at > now() - interval '1 hour'
           THEN email_verifications.send_count + 1 ELSE 1 END,
         first_sent_at = CASE
           WHEN email_verifications.first_sent_at > now() - interval '1 hour'
           THEN email_verifications.first_sent_at ELSE now() END`,
      [email, codeHash],
    );

    try {
      await sendVerificationCode(email, code);
    } catch (err) {
      console.error('[auth] 인증 메일 발송 실패:', err);
      // 메일이 나가지 않았으므로 재발송 한도를 깎지 않는다.
      // 전달되지 않은 코드도 쓸 수 없게 함께 만료시킨다.
      await run(
        `UPDATE email_verifications
            SET send_count = GREATEST(send_count - 1, 0), expires_at = now()
          WHERE email = ?`,
        [email],
      ).catch(() => undefined);
      res.status(503).json({ error: '인증 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.' });
      return;
    }

    res.json({ ok: true, expiresInMinutes: CODE_TTL_MS / 60000 });
  }),
);

authRouter.post(
  '/signup',
  wrap(async (req, res) => {
    const { email, name, password, code } = (req.body ?? {}) as Record<string, unknown>;
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      res.status(400).json({
        error: `학교 이메일(@${ALLOWED_EMAIL_DOMAIN})로만 가입할 수 있습니다.`,
      });
      return;
    }
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 20) {
      res.status(400).json({ error: '이름은 2자 이상 20자 이하로 입력해 주세요.' });
      return;
    }
    if (typeof password !== 'string' || password.length < 8) {
      res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다.' });
      return;
    }
    if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
      res.status(400).json({ error: '메일로 받은 6자리 숫자를 입력해 주세요.' });
      return;
    }
    const existing = await get<{ id: number }>('SELECT id FROM users WHERE email = ?', [
      normalizedEmail,
    ]);
    if (existing) {
      res.status(409).json({ error: '이미 가입된 이메일입니다. 로그인해 주세요.' });
      return;
    }

    // ── 인증코드 확인 ──────────────────────────────────────────
    const record = await get<{ codeHash: string; attempts: number; expired: boolean }>(
      `SELECT code_hash AS "codeHash", attempts, (expires_at < now()) AS expired
       FROM email_verifications WHERE email = ?`,
      [normalizedEmail],
    );
    if (!record) {
      res.status(400).json({ error: '인증 메일을 먼저 요청해 주세요.' });
      return;
    }
    if (record.expired) {
      await run('DELETE FROM email_verifications WHERE email = ?', [normalizedEmail]);
      res.status(400).json({ error: '인증코드가 만료되었습니다. 다시 요청해 주세요.' });
      return;
    }
    if (Number(record.attempts) >= MAX_CODE_ATTEMPTS) {
      await run('DELETE FROM email_verifications WHERE email = ?', [normalizedEmail]);
      res.status(429).json({
        error: `인증코드를 ${MAX_CODE_ATTEMPTS}번 틀렸습니다. 인증 메일을 다시 요청해 주세요.`,
      });
      return;
    }
    if (!bcrypt.compareSync(code.trim(), record.codeHash)) {
      await run('UPDATE email_verifications SET attempts = attempts + 1 WHERE email = ?', [
        normalizedEmail,
      ]);
      const left = MAX_CODE_ATTEMPTS - Number(record.attempts) - 1;
      res.status(400).json({
        error: `인증코드가 올바르지 않습니다. ${left}번 더 시도할 수 있습니다.`,
      });
      return;
    }
    await run('DELETE FROM email_verifications WHERE email = ?', [normalizedEmail]);
    const hash = bcrypt.hashSync(password, 10);
    const id = await insert(
      'INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?) RETURNING id',
      [normalizedEmail, name.trim(), hash],
    );
    issueToken(res, id);
    res.status(201).json({
      id,
      email: normalizedEmail,
      name: name.trim(),
      isAdmin: false,
    });
  }),
);

// 온라인 무차별 대입 방지: IP+이메일 기준 10분에 10회
const loginLimiter = createRateLimiter(10, 10 * 60 * 1000);

authRouter.post(
  '/login',
  wrap(async (req, res) => {
    const { email, password } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: '이메일과 비밀번호를 입력해 주세요.' });
      return;
    }
    // 이메일 칸에 아이디만 적어도 되도록 도메인이 없으면 학교 도메인을 붙인다.
    const typed = email.trim().toLowerCase();
    const normalizedEmail = typed.includes('@') ? typed : `${typed}@${ALLOWED_EMAIL_DOMAIN}`;
    const limiterKey = `${req.ip}:${normalizedEmail}`;
    if (!loginLimiter.hit(limiterKey)) {
      res.status(429).json({ error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
      return;
    }
    const row = await get<UserRow>(
      'SELECT id, email, name, password_hash, is_admin FROM users WHERE email = ?',
      [normalizedEmail],
    );
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
      return;
    }
    loginLimiter.clear(limiterKey);
    issueToken(res, row.id);
    res.json(publicUser(row));
  }),
);

authRouter.post('/logout', (_req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

authRouter.get(
  '/me',
  requireAuth,
  wrap(async (_req, res) => {
    const row = await get<Omit<UserRow, 'password_hash'>>(
      'SELECT id, email, name, is_admin FROM users WHERE id = ?',
      [userId(res)],
    );
    if (!row) {
      res.status(401).json({ error: '로그인이 필요합니다.' });
      return;
    }
    res.json(publicUser(row));
  }),
);

/**
 * 회원 탈퇴. 비밀번호를 한 번 더 확인하고 계정과 딸린 자료를 모두 지운다.
 * (시간표·예약·회의 참여는 외래키 CASCADE로 함께 사라진다)
 * 운영용 관리자 계정은 이 경로로 지울 수 없다.
 */
authRouter.delete(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    const password = (req.body as Record<string, unknown>)?.password;
    const id = userId(res);
    const row = await get<UserRow>(
      'SELECT id, email, name, password_hash, is_admin FROM users WHERE id = ?',
      [id],
    );
    if (!row) {
      res.status(401).json({ error: '로그인이 필요합니다.' });
      return;
    }
    if (row.is_admin) {
      res.status(403).json({ error: '관리자 계정은 탈퇴할 수 없습니다.' });
      return;
    }
    if (typeof password !== 'string' || !bcrypt.compareSync(password, row.password_hash)) {
      res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
      return;
    }

    // 내가 만든 회의에 남는 사람이 있으면 회의가 통째로 사라지지 않도록
    // 가장 먼저 들어온 다른 참여자에게 방장을 넘긴다.
    await run(
      `UPDATE meetings m SET owner_id = (
         SELECT mm.user_id FROM meeting_members mm
          WHERE mm.meeting_id = m.id AND mm.user_id <> ?
          ORDER BY mm.joined_at, mm.user_id LIMIT 1)
       WHERE m.owner_id = ?
         AND EXISTS (
           SELECT 1 FROM meeting_members mm2
            WHERE mm2.meeting_id = m.id AND mm2.user_id <> ?)`,
      [id, id, id],
    );
    await run('DELETE FROM users WHERE id = ?', [id]);
    // 같은 주소로 다시 가입할 수 있도록 남은 인증 기록도 정리한다.
    await run('DELETE FROM email_verifications WHERE email = ?', [row.email]);

    res.clearCookie('token');
    res.json({ ok: true });
  }),
);
