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
import { releaseLoungeForWithdrawal } from './lounge/services/withdraw.js';
import { schoolProfileValues } from './lounge/services/schoolProfile.js';
import { ApiInputError, errorResponseOf } from './school/http.js';
import {
  cipherLooksLikePlaintext,
  createSchoolService,
  isUniqueViolation,
  parseCredentials,
  parseSealedBox,
} from './school/service.js';
import type { SchoolService } from './school/service.js';
import { normalizeUsername, passwordError, usernameError } from '../shared/auth.js';
import type { AuthUser } from '../shared/auth.js';
import type { SchoolSignupRequest, SchoolVerifyResponse } from '../shared/school/types.js';

/**
 * 학교 메일(@hansung.ac.kr) 인증코드 가입은 지금 쓰지 않는다. 코드는 지우지 않고 이 스위치(EMAIL_SIGNUP_ENABLED=1)로만 켠다.
 * 새 가입은 학교 계정 학생 인증(school-verify) + 플랫폼 아이디·비밀번호(signup)다.
 */
export const EMAIL_SIGNUP_ENABLED = process.env.EMAIL_SIGNUP_ENABLED === '1';

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
    const payload = jwt.verify(token, jwtSecret()) as { uid?: unknown };
    // 같은 비밀로 서명한 다른 증표(학교 인증 ticket 등)를 로그인 쿠키 자리에 넣어도 통과하지 못하게 uid 가 정수인지 본다.
    if (typeof payload.uid !== 'number' || !Number.isInteger(payload.uid)) throw new Error('uid 없음');
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
  username: string | null;
  email: string | null;
  name: string;
  password_hash: string;
  is_admin: boolean;
}

/** 클라이언트로 내보낼 사용자 정보(shared/auth.ts 의 AuthUser). 비밀번호 해시는 절대 포함하지 않는다. */
function publicUser(row: Pick<UserRow, 'id' | 'username' | 'email' | 'name' | 'is_admin'>): AuthUser {
  return {
    id: row.id,
    // 아이디가 비어 있는 행(백필에서 건너뛴 드문 경우)도 응답 모양은 지킨다
    username: row.username ?? row.email?.split('@')[0] ?? '',
    name: row.name,
    isAdmin: Boolean(row.is_admin),
    email: row.email ?? null,
  };
}

// 한성대 구성원만 가입할 수 있도록 학교 메일 주소만 받는다. (학교 메일 가입을 켰을 때만 쓰인다)
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

// ── 학교 인증 확인표(ticket) ─────────────────────────────────────────

const TICKET_PURPOSE = 'school-signup';
const TICKET_TTL = '15m';
const TICKET_INVALID_MESSAGE = '학교 인증이 만료됐어요. 처음부터 다시 인증해 주세요.';

/**
 * ticket 은 로그인 쿠키와 같은 서버 비밀로 만들되, 쿠키로 쓰일 수 없도록 용도별 키를 따로 파생해 서명한다
 * (로그인 토큰을 ticket 자리에, ticket 을 로그인 쿠키 자리에 넣어도 서명 검증에서 걸린다).
 */
function ticketKey(): string {
  return crypto.createHmac('sha256', jwtSecret()).update('school-signup-ticket').digest('hex');
}

type TicketClaims = {
  /** 학번 HMAC(studentLinkHash) — 학번 원문이 아니다 */
  sh: string;
  name: string;
  department: string;
  admissionYear: number | null;
  hint: string;
  /** 포털에서 읽은 성별 (못 읽으면 없음) */
  gender?: 'male' | 'female';
};

function signTicket(c: TicketClaims): string {
  return jwt.sign({ purpose: TICKET_PURPOSE, ...c }, ticketKey(), { algorithm: 'HS256', expiresIn: TICKET_TTL });
}

/** 서명·만료·용도를 확인하고 내용을 돌려준다. 하나라도 틀리면 null */
function readTicket(value: unknown): TicketClaims | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null;
  try {
    const p = jwt.verify(value, ticketKey(), { algorithms: ['HS256'] }) as Record<string, unknown>;
    if (p.purpose !== TICKET_PURPOSE) return null;
    if (typeof p.sh !== 'string' || !/^[0-9a-f]{64}$/.test(p.sh)) return null;
    if (typeof p.name !== 'string' || typeof p.department !== 'string' || typeof p.hint !== 'string') return null;
    const ay = p.admissionYear;
    if (ay !== null && !(typeof ay === 'number' && Number.isInteger(ay))) return null;
    const gender = p.gender === 'male' || p.gender === 'female' ? p.gender : undefined;
    return { sh: p.sh, name: p.name, department: p.department, admissionYear: ay as number | null, hint: p.hint, ...(gender ? { gender } : {}) };
  } catch {
    return null;
  }
}

/** 어느 유니크 제약에 걸렸는지 (pg 는 constraint, PGlite 는 메시지에 이름이 있다) */
function uniqueKind(err: unknown): 'username' | 'school' | 'email' | 'other' {
  if (!isUniqueViolation(err)) return 'other';
  const e = err as { constraint?: string; message?: string };
  const text = `${e.constraint ?? ''} ${e.message ?? ''}`;
  if (/username/.test(text)) return 'username';
  if (/school_student_hash/.test(text)) return 'school';
  if (/email/.test(text)) return 'email';
  return 'other';
}

const USERNAME_TAKEN_MESSAGE = '이미 쓰고 있는 아이디예요.';
const taken = (): ApiInputError => new ApiInputError('USERNAME_TAKEN', USERNAME_TAKEN_MESSAGE, undefined, 'username');
const invalid = (message: string, field: string): ApiInputError => new ApiInputError('INVALID', message, undefined, field);

/** 없는 아이디여도 같은 시간이 걸리도록 비교할 가짜 해시(cost 12, 처음 한 번만 만든다) */
let dummyHash: Promise<string> | null = null;
const getDummyHash = (): Promise<string> => (dummyHash ??= bcrypt.hash(crypto.randomBytes(16).toString('hex'), 12));

export type AuthRouterDeps = {
  /** 학교 로그인에 쓰는 서비스. 테스트가 가짜 학교를 끼운다. 기본은 운영 설정(createSchoolService()) */
  school?: SchoolService;
  /** 학교 메일 가입 사용 여부. 기본은 환경변수(EMAIL_SIGNUP_ENABLED=1) */
  emailSignupEnabled?: boolean;
};

export function createAuthRouter(deps: AuthRouterDeps = {}): Router {
  const school = deps.school ?? createSchoolService();
  const emailSignupEnabled = deps.emailSignupEnabled ?? EMAIL_SIGNUP_ENABLED;
  const router = Router();

  // 제한 장치는 라우터마다 따로 둔다(테스트가 서로 영향을 주지 않게)
  const codeRequestLimiter = createRateLimiter(10, 10 * 60 * 1000); // 인증 메일 요청: IP 기준 10분에 10회
  const verifyLimiter = createRateLimiter(10, 10 * 60 * 1000); // 학교 인증: IP 기준 10분에 10회
  const signupLimiter = createRateLimiter(10, 10 * 60 * 1000); // 가입: IP 기준 10분에 10회
  const availableLimiter = createRateLimiter(60, 10 * 60 * 1000); // 아이디 중복 확인: IP 기준 10분에 60회
  const loginLimiter = createRateLimiter(10, 10 * 60 * 1000); // 온라인 무차별 대입 방지: IP+아이디 기준 10분에 10회

  /** 학교 오류·입력 오류는 학교 라우터와 같은 모양(`{error, code}`)으로, 그 밖은 전역 오류 처리기로 */
  const route = (handler: (req: Request, res: Response) => Promise<void>): RequestHandler => (req, res, next) => {
    handler(req, res).catch((err: unknown) => {
      const out = errorResponseOf(err);
      if (!out) {
        next(err);
        return;
      }
      if (out.retryAfter !== undefined) res.setHeader('Retry-After', String(out.retryAfter));
      res.status(out.status).json(out.body);
    });
  };

  const requireEmailSignup: RequestHandler = (_req, res, next) => {
    if (emailSignupEnabled) {
      next();
      return;
    }
    res.status(404).json({ error: '학교 메일 가입은 지금 쓰지 않아요.', code: 'DISABLED' });
  };

  // ── 가입 ① 학교 계정 학생 인증 ───────────────────────────────────────

  /**
   * 학교 계정(학번·포털 비밀번호)으로 학교에 한 번 로그인해 보고, 성공하면 15분짜리 인증 확인표(ticket)를 준다.
   * 평문 학번·비밀번호는 이 요청 본문에만 있고 저장·로그 어디에도 남기지 않는다(응답에는 학교가 알려 준 내 정보만).
   * 사용자 id 가 아직 없어 link() 의 사용자별 "남의 학번 시도 예산"은 쓸 수 없으므로, IP 기준 제한(10분 10회)과
   * 학번별 DB 가드(연속 5회 실패 30분 잠금, 8회 멈춤)가 그 역할을 한다.
   */
  router.post(
    '/school-verify',
    route(async (req, res) => {
      const creds = parseCredentials(req.body);
      if (!verifyLimiter.hit(String(req.ip))) {
        throw new ApiInputError('RATE_LIMITED', '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
      }
      const { profile, hint, linkHash } = await school.verifyStudent(creds);
      const response: SchoolVerifyResponse = {
        ticket: signTicket({
          sh: linkHash,
          name: profile.name,
          department: profile.department,
          admissionYear: profile.admissionYear,
          hint,
          ...(profile.gender ? { gender: profile.gender } : {}),
        }),
        hint,
        profile,
      };
      res.json(response);
    }),
  );

  // ── 가입 ② 플랫폼 아이디·비밀번호 + 연동 ──────────────────────────────

  /**
   * ticket 이 유효하면 계정을 만들고 브라우저가 봉인한 암호문(v:2)을 함께 저장한다 = 가입과 동시에 학교 연동 완료.
   * 이 요청에는 학교 평문이 없다. 같은 ticket 으로 둘째 계정은 학번 유니크 인덱스가 막는다.
   */
  router.post(
    '/signup',
    route(async (req, res) => {
      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Partial<Record<keyof SchoolSignupRequest, unknown>>;

      // ① 형식 검사 (항목별 문장)
      const nameError = usernameError(body.username);
      if (nameError) throw invalid(nameError, 'username');
      const pwError = passwordError(body.password);
      if (pwError) throw invalid(pwError, 'password');
      const username = normalizeUsername(body.username);
      const password = body.password as string;
      const cipher = parseSealedBox(body.cipher);
      // 암호문 자리에 평문이 들어오지 않았는지: 플랫폼 비밀번호가 그대로 보이면 거절한다(학교 평문은 이 요청에 없다)
      if (!cipher || cipherLooksLikePlaintext(cipher, [password])) throw invalid('암호문 형식이 올바르지 않아요.', 'cipher');

      if (!signupLimiter.hit(String(req.ip))) {
        throw new ApiInputError('RATE_LIMITED', '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
      }

      // ② ticket 서명·만료·용도
      const ticket = readTicket(body.ticket);
      if (!ticket) throw new ApiInputError('TICKET_INVALID', TICKET_INVALID_MESSAGE);

      // ③ 아이디 중복
      if (await get('SELECT 1 AS x FROM users WHERE username = ?', [username])) throw taken();

      // ④ 계정 만들기. 동시에 같은 아이디·학번으로 들어온 요청은 유니크 인덱스가 한 건만 통과시키고 나머지는 409 로 바꾼다.
      const hash = await bcrypt.hash(password, 12);
      const realName = ticket.name.trim().slice(0, 30) || username;
      const profile = schoolProfileValues({ name: realName, department: ticket.department, admissionYear: ticket.admissionYear });
      let id: number;
      try {
        id = await insert(
          `INSERT INTO users (username, name, password_hash, school_cipher, school_hint, school_student_hash,
                              school_linked_at, school_department, school_admission_year, school_gender,
                              nickname, college, department, admission_year, profile_done)
           VALUES (?, ?, ?, ?, ?, ?, now(), ?, ?, ?, ?, '', ?, ?, TRUE) RETURNING id`,
          [
            username,
            realName,
            hash,
            JSON.stringify({ v: cipher.v, iv: cipher.iv, ct: cipher.ct }),
            ticket.hint,
            ticket.sh,
            ticket.department,
            ticket.admissionYear,
            ticket.gender ?? null,
            // 라운지 프로필 = 학교 계정 정보 (실명을 가린 닉네임·학과·입학년도)
            profile.nickname,
            profile.department,
            profile.admissionYear,
          ],
        );
      } catch (err) {
        const kind = uniqueKind(err);
        if (kind === 'username') throw taken();
        if (kind === 'school') throw new ApiInputError('SCHOOL_ALREADY_REGISTERED', '이미 가입된 학번이에요. 로그인해 주세요.');
        throw err;
      }

      issueToken(res, id);
      res.status(201).json({
        ...publicUser({ id, username, email: null, name: realName, is_admin: false }),
        school: { hint: ticket.hint, department: ticket.department, admissionYear: ticket.admissionYear },
      });
    }),
  );

  router.get(
    '/username-available',
    wrap(async (req, res) => {
      if (!availableLimiter.hit(String(req.ip))) {
        res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.', code: 'RATE_LIMITED' });
        return;
      }
      const raw = req.query.username;
      const reason = usernameError(typeof raw === 'string' ? raw : '');
      if (reason) {
        res.json({ available: false, reason });
        return;
      }
      const exists = await get('SELECT 1 AS x FROM users WHERE username = ?', [normalizeUsername(raw)]);
      res.json(exists ? { available: false, reason: USERNAME_TAKEN_MESSAGE } : { available: true });
    }),
  );

  // ── 학교 메일 가입 (EMAIL_SIGNUP_ENABLED=1 일 때만) ───────────────────

  router.post(
    '/request-code',
    requireEmailSignup,
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

  router.post(
    '/signup-email',
    requireEmailSignup,
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
      // 로그인 아이디는 이메일의 앞부분. 이미 그 아이디를 쓰는 계정이 있으면 코드를 쓰기 전에 거절한다.
      const username = normalizedEmail.split('@')[0];
      if (await get('SELECT 1 AS x FROM users WHERE username = ?', [username])) {
        res.status(409).json({ error: USERNAME_TAKEN_MESSAGE, code: 'USERNAME_TAKEN' });
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
      let id: number;
      try {
        id = await insert(
          'INSERT INTO users (email, username, name, password_hash) VALUES (?, ?, ?, ?) RETURNING id',
          [normalizedEmail, username, name.trim(), hash],
        );
      } catch (err) {
        // 동시 가입: 같은 이메일·아이디로 먼저 들어온 요청이 있다
        const kind = uniqueKind(err);
        if (kind === 'username') {
          res.status(409).json({ error: USERNAME_TAKEN_MESSAGE, code: 'USERNAME_TAKEN' });
          return;
        }
        if (kind === 'email') {
          res.status(409).json({ error: '이미 가입된 이메일입니다. 로그인해 주세요.' });
          return;
        }
        throw err;
      }
      issueToken(res, id);
      res.status(201).json(publicUser({ id, username, email: normalizedEmail, name: name.trim(), is_admin: false }));
    }),
  );

  // ── 로그인 · 로그아웃 · 내 정보 · 탈퇴 ────────────────────────────────

  const BAD_LOGIN = '아이디 또는 비밀번호가 올바르지 않습니다.';

  router.post(
    '/login',
    wrap(async (req, res) => {
      // 옛 클라이언트·스크립트는 email 칸으로 보낸다. normalizeUsername 이 학교 메일 꼴이면 앞부분만 쓴다.
      const { username: rawUsername, email, password } = (req.body ?? {}) as Record<string, unknown>;
      const username = normalizeUsername(typeof rawUsername === 'string' ? rawUsername : email);
      if (username.length === 0 || typeof password !== 'string' || password.length === 0 || password.length > 1024) {
        res.status(400).json({ error: '아이디와 비밀번호를 입력해 주세요.' });
        return;
      }
      const limiterKey = `${req.ip}:${username}`;
      if (!loginLimiter.hit(limiterKey)) {
        res.status(429).json({ error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
        return;
      }
      const row = await get<UserRow>(
        'SELECT id, username, email, name, password_hash, is_admin FROM users WHERE username = ?',
        [username],
      );
      // 없는 아이디여도 가짜 해시와 비교해 응답 시간으로 아이디 존재 여부를 알 수 없게 한다.
      const ok = await bcrypt.compare(password, row ? row.password_hash : await getDummyHash());
      if (!row || !ok) {
        res.status(401).json({ error: BAD_LOGIN });
        return;
      }
      loginLimiter.clear(limiterKey);
      issueToken(res, row.id);
      res.json(publicUser(row));
    }),
  );

  router.post('/logout', (_req, res) => {
    res.clearCookie('token');
    res.json({ ok: true });
  });

  router.get(
    '/me',
    requireAuth,
    wrap(async (_req, res) => {
      const row = await get<Omit<UserRow, 'password_hash'>>(
        'SELECT id, username, email, name, is_admin FROM users WHERE id = ?',
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
   * 라운지는 CASCADE 에 맡기지 않는다: 주최 중인 모임이 다른 참여자의 약속과 단톡방까지 함께 사라지고 메시지가 고아로 남기 때문에,
   * 사용자 행을 지우기 전에 releaseLoungeForWithdrawal 이 주최를 넘기거나 정리한다.
   * 운영용 관리자 계정은 이 경로로 지울 수 없다.
   */
  router.delete(
    '/me',
    requireAuth,
    wrap(async (req, res) => {
      const password = (req.body as Record<string, unknown>)?.password;
      const id = userId(res);
      const row = await get<UserRow>(
        'SELECT id, username, email, name, password_hash, is_admin FROM users WHERE id = ?',
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
      if (typeof password !== 'string' || !(await bcrypt.compare(password, row.password_hash))) {
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
      // 라운지 정리가 끝내 실패하면 예외로 끝나 사용자 행은 그대로 남는다 (탈퇴를 다시 시도할 수 있다).
      await releaseLoungeForWithdrawal(String(id));
      await run('DELETE FROM users WHERE id = ?', [id]);
      // 같은 주소로 다시 가입할 수 있도록 남은 인증 기록도 정리한다. (학교 메일로 가입한 옛 계정만 이메일이 있다)
      if (row.email) await run('DELETE FROM email_verifications WHERE email = ?', [row.email]);

      res.clearCookie('token');
      res.json({ ok: true });
    }),
  );

  return router;
}

export const authRouter = createAuthRouter();
