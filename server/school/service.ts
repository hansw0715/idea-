/**
 * 학교 계정 연동 흐름: link / timetable preview·import / reservations / book preview·submit.
 * 설계: docs/school/00-design.md
 *
 * 평문(학번·비밀번호)은 요청 본문으로 들어와 이 파일의 함수 인자로만 흘러가고, 학교 로그인에 쓰이고 버려진다.
 * DB·로그·오류 메시지·응답 어디에도 넣지 않는다 (오류는 http.ts 의 고정 문장만 쓴다).
 *
 * 한 요청 = 사이트당 로그인 최대 1회, 실패 뒤 자동 재시도 없음 (guardedLogin 과 ResveClient 가 구조로 보장).
 */
import crypto from 'node:crypto';
import { get, insert, run } from '../db.js';
import { ensureSchoolProfile } from '../lounge/services/schoolProfile.js';
import { isStudentId, studentIdHint } from '../../shared/school/types.js';
import type {
  BookCancelResult,
  BookPreview,
  BookResult,
  BookSubmitRequest,
  LinkResponse,
  LinkStatus,
  MyReservationsResult,
  SchoolCredentials,
  SchoolProfile,
  SchoolReservation,
  SealedBox,
  TimetableImportResult,
  TimetablePreview,
} from '../../shared/school/types.js';
import {
  assertLinkProbeBudget,
  clearLinkProbe,
  guardedLogin,
  hitLimiter,
  isSiteBackedOff,
  linkLimiter,
  recordLinkProbeFailure,
  schoolCallLimiter,
  setSiteBackoff,
  studentLinkHash,
} from './guard.js';
import { systemForFacility, findSpace, RESERVE_SYSTEMS, sitesOf } from './facilityMap.js';
import type { ReserveSystem } from './facilityMap.js';
import {
  ApiInputError,
  SchoolAuthFailed,
  SchoolError,
  SchoolHttp,
  SchoolLocked,
  SchoolNotLinked,
  SchoolRejected,
  SchoolUnavailable,
  resolveOrigins,
  sessionGone,
} from './http.js';
import type { FetchLike, SchoolOrigins } from './http.js';
import { fetchProfile, fetchTimetable, loginInfo } from './info.js';
import { createEclassFlow } from './eclass.js';
import type { EclassSnapshot } from '../../shared/school/eclass.js';
import {
  admissionYearOf,
  buildPayload,
  expandSlots,
  fmtHm,
  formatWhen,
  identityNames,
  isRealDate,
  kstDate,
  slotStates,
  toBookItems,
  toGrid,
  toSchoolReservation,
} from './parse.js';
import type { BookingContext, MineRow, ParsedProfile, ResveInfo, ResveItem, ResveSetup, Space } from './parse.js';
import { ResveClient } from './resve.js';
import type { Registration } from './resve.js';

// ── 입력 검증 (오류는 ApiInputError → 400) ──────────────────────────

const invalid = (message: string): ApiInputError => new ApiInputError('INVALID', message);

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** base64 문자열을 풀어 바이트 수가 [min, max] 안인지 확인한다. 정규형(다시 인코딩하면 같은 문자열)이어야 한다 */
function decodeBase64(value: unknown, min: number, max: number): Buffer | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return null;
  if (value.length % 4 !== 0 || !BASE64.test(value)) return null;
  const buf = Buffer.from(value, 'base64');
  if (buf.toString('base64') !== value) return null;
  return buf.length >= min && buf.length <= max ? buf : null;
}

function parseSealedBoxOf(value: unknown, versions: readonly (1 | 2)[]): SealedBox | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  if (o.v !== 1 && o.v !== 2) return null;
  if (!versions.includes(o.v)) return null;
  if (!decodeBase64(o.iv, 12, 12) || !decodeBase64(o.ct, 17, 2048)) return null;
  return { v: o.v, iv: o.iv as string, ct: o.ct as string };
}

/**
 * **새로 받는** 암호문 형식 검사: `{ v:2, iv(base64 12바이트), ct(base64 17~2048바이트) }`. 서버는 풀 수 없다.
 * v:1(기기마다 무작위 키로 봉인한 옛 방식)은 이제 받지 않는다 — 그 키는 다른 기기에서 쓸 수 없어 새로 연동하게 한다.
 */
export function parseSealedBox(value: unknown): SealedBox | null {
  return parseSealedBoxOf(value, [2]);
}

/** DB 에 이미 저장된 암호문을 읽을 때의 검사. 옛 v:1 도 통과한다(화면이 "다시 연동"으로 안내한다) */
export function parseStoredSealedBox(value: unknown): SealedBox | null {
  return parseSealedBoxOf(value, [1, 2]);
}

/**
 * 암호문 자리에 평문이 들어오지 않았는지 본다 (방어 심층 — 서버는 키가 없어 풀어 볼 수 없으니 겉모습으로만 판단한다).
 * 클라이언트 버그나 변조로 `base64('학번:비밀번호')` 같은 것이 `ct` 로 오면 그대로 DB 에 저장되므로, 저장 전에 거절한다.
 *  1) 모든 바이트가 눈에 보이는 ASCII 글자(0x20~0x7e)면 암호문이 아니다. 진짜 AES-GCM 출력(최소 16바이트 태그 + 평문)이 우연히
 *     전부 글자일 확률은 (95/256)^17 < 1e-7 이다.
 *  2) 같은 요청의 학번·비밀번호 바이트열(UTF-8·UTF-16LE)이 그대로 들어 있으면 평문이다. 너무 짧은 값(4바이트 미만)은
 *     무작위 바이트에도 우연히 들어 있을 수 있어 비교하지 않는다.
 */
export function cipherLooksLikePlaintext(cipher: SealedBox, secrets: SchoolCredentials | readonly string[]): boolean {
  const ct = Buffer.from(cipher.ct, 'base64');
  if (ct.every((b) => b >= 0x20 && b <= 0x7e)) return true;
  // 가입(signup)에는 학교 평문이 없다: 플랫폼 아이디·비밀번호 같은 문자열 목록을 직접 받는다.
  const list = Array.isArray(secrets) ? (secrets as readonly string[]) : [(secrets as SchoolCredentials).studentId, (secrets as SchoolCredentials).password];
  const needles = list.flatMap((v) => [Buffer.from(v, 'utf8'), Buffer.from(v, 'utf16le')]);
  return needles.some((n) => n.length >= 4 && ct.includes(n));
}

/** 학번(숫자 6~10자리)과 비밀번호(1~64자) */
export function parseCredentials(value: unknown): SchoolCredentials {
  const o = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  if (typeof o.studentId !== 'string' || !isStudentId(o.studentId)) {
    throw invalid('학번은 숫자 6~10자리로 입력해 주세요.');
  }
  if (typeof o.password !== 'string' || o.password.length < 1 || o.password.length > 64) {
    throw invalid('비밀번호는 1~64자로 입력해 주세요.');
  }
  return { studentId: o.studentId, password: o.password };
}

const MAX_ITEMS = 30;
const MAX_ITEM_VALUE = 200;

/** `POST /book/submit` 본문 검증 */
export function parseBookSubmit(body: unknown): BookSubmitRequest {
  const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const creds = parseCredentials(o.creds);
  const reservationId = parseReservationId(o.reservationId);
  const items: Record<string, string> = {};
  if (o.items !== undefined) {
    if (!o.items || typeof o.items !== 'object' || Array.isArray(o.items)) throw invalid('추가 항목 형식이 올바르지 않아요.');
    const entries = Object.entries(o.items as Record<string, unknown>);
    if (entries.length > MAX_ITEMS) throw invalid('추가 항목이 너무 많아요.');
    for (const [k, v] of entries) {
      if (typeof v !== 'string' || v.length > MAX_ITEM_VALUE || k.length > 100) {
        throw invalid(`추가 항목은 ${MAX_ITEM_VALUE}자 이하의 글자로 입력해 주세요.`);
      }
      items[k] = v;
    }
  }
  let tel: string | undefined;
  if (o.tel !== undefined) {
    if (typeof o.tel !== 'string' || o.tel.length > 30 || !/^[0-9+\-() ]*$/.test(o.tel)) {
      throw invalid('연락처는 숫자와 -, +, 괄호만 30자 이하로 입력해 주세요.');
    }
    tel = o.tel.trim();
  }
  let email: string | undefined;
  if (o.email !== undefined) {
    if (typeof o.email !== 'string' || o.email.length > 100 || (o.email !== '' && !/^[^\s@]+@[^\s@]+$/.test(o.email))) {
      throw invalid('이메일 형식이 올바르지 않아요.');
    }
    email = o.email.trim();
  }
  return { creds, reservationId, items, tel, email };
}

/** reservations.id 는 SERIAL(int4)이다. 이 범위를 넘는 수를 DB 에 넘기면 22003 오류로 500 이 된다 */
export const MAX_RESERVATION_ID = 2_147_483_647;

export function parseReservationId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > MAX_RESERVATION_ID) {
    throw invalid('예약 번호가 올바르지 않아요.');
  }
  return value;
}

// ── 서비스 ────────────────────────────────────────────────────────

export type SchoolServiceDeps = {
  /** 테스트용 가짜 fetch. 없으면 Node 의 fetch */
  fetch?: FetchLike;
  /** 테스트용 학교 주소 (루프백만 허용). 없으면 환경(SCHOOL_MOCK_ORIGIN) → 운영 주소 */
  origins?: () => SchoolOrigins;
  now?: () => number;
};

type UserSchoolRow = {
  cipher: string | null;
  hint: string | null;
  hash: string | null;
  linkedAt: Date | string | null;
  department: string | null;
  admissionYear: number | null;
};

const BOOK_ACTIVE = ['submitted', 'confirmed', 'unknown'];

const ALREADY_SUBMITTED_REASON =
  '이미 이 예약으로 학교에 신청을 보냈어요. 다시 보내지 않으니 학교 사이트의 내 신청내역에서 확인해 주세요.';

/**
 * 신청 흐름이 확인되지 않은 예약 사이트(hsel)에서 로그인이 안 됐을 때 쓰는 문장.
 * 다시 시도하지 않는 시간(24시간)은 DB(school_login_guard 의 사이트별 행)에 둔다 — 인스턴스 메모리에 두면
 * 서버리스에서 인스턴스가 바뀔 때마다 사라져 같은 실패 로그인이 되풀이된다. (guard.isSiteBackedOff / setSiteBackoff)
 */
const UNVERIFIED_SKIP_REASON = '이 예약 시스템은 로그인 방식이 아직 확인되지 않아 불러오지 못했어요. 학교 사이트에서 직접 확인해 주세요.';

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return e?.code === '23505' || /duplicate key|unique constraint/i.test(String(e?.message ?? ''));
}

/** 학번 하나당 계정 하나 규칙에 걸렸을 때의 오류 (409) */
const alreadyRegistered = (): ApiInputError =>
  new ApiInputError('SCHOOL_ALREADY_REGISTERED', '이미 가입된 학번이에요. 로그인해 주세요.');

/** 이 오류가 사용자에게 보여 줘도 되는 학교 오류인가 */
const safeReason = (err: unknown, fallback: string): string => (err instanceof SchoolError ? err.message : fallback);

export function createSchoolService(deps: SchoolServiceDeps = {}) {
  const now = deps.now ?? Date.now;
  const origins = (): SchoolOrigins => (deps.origins ? deps.origins() : resolveOrigins());
  const newInfoHttp = (): SchoolHttp => new SchoolHttp('info', { fetch: deps.fetch, origins: origins(), now });
  const newEclassHttp = (): SchoolHttp => new SchoolHttp('eclass', { fetch: deps.fetch, origins: origins(), now });
  const newResve = (): ResveClient => new ResveClient(new SchoolHttp('resve', { fetch: deps.fetch, origins: origins(), now }));

  const toProfile = (p: ParsedProfile): SchoolProfile => ({
    studentId: p.studentId,
    name: p.name,
    department: p.department,
    admissionYear: admissionYearOf(p.studentId, Number(kstDate(now()).slice(0, 4))),
    // 포털에서 성별을 읽었을 때만 붙인다 (못 읽으면 응답에 없다)
    ...(p.gender ? { gender: p.gender } : {}),
  });

  type LinkRow = { hint: string | null; hash: string | null };

  /**
   * 이 사용자의 연동 정보. users 행이 없으면(탈퇴한 사용자의 남은 로그인 토큰) 401 — 학교에 아무것도 보내기 전에 막는다.
   * `hint`(끝 3자리)는 화면 표시용이고, "이 사용자의 학번이 맞는가"는 `hash`(학번 HMAC)로만 판단한다.
   */
  async function loadLinkRow(uid: number): Promise<LinkRow> {
    const row = await get<LinkRow>('SELECT school_hint AS hint, school_student_hash AS hash FROM users WHERE id = ?', [uid]);
    if (!row) throw sessionGone();
    return row;
  }

  /**
   * 연동한 학번과 **정확히** 같은 학번인지 확인한다 (이 서비스가 아무 학번이나 대신 로그인해 주는 창구가 되지 않게).
   * 끝 3자리 힌트로 비교하면 같은 끝자리의 다른 학번(최대 10^7개)이 통과해, 그 학번의 학교 계정에 비밀번호를 대입하고
   * 그 학번의 공유 가드를 소진시킬 수 있다 → 연동할 때 저장한 학번 HMAC 과 비교한다.
   * 해시가 없는 옛 연동(이 규칙 이전에 만들어진 행)은 학번을 확인할 수 없으므로 다시 연동하게 한다.
   */
  async function requireLinked(uid: number, creds: SchoolCredentials): Promise<void> {
    const row = await loadLinkRow(uid);
    if (!row.hint) throw new SchoolNotLinked();
    if (!row.hash) throw new SchoolNotLinked('학교 계정 연동 방식이 바뀌었어요. 학교 계정을 다시 연동해 주세요.');
    if (row.hash !== studentLinkHash(creds.studentId)) {
      throw new SchoolNotLinked('연동한 학번과 달라요. 학교 계정을 다시 연동해 주세요.');
    }
  }

  // ── 연동 ─────────────────────────────────────────────────────

  async function getLink(uid: number): Promise<LinkStatus> {
    const row = await get<UserSchoolRow>(
      `SELECT school_cipher AS cipher, school_hint AS hint, school_student_hash AS hash, school_linked_at AS "linkedAt",
              school_department AS department, school_admission_year AS "admissionYear"
         FROM users WHERE id = ?`,
      [uid],
    );
    let cipher: SealedBox | null = null;
    if (row?.cipher) {
      try {
        cipher = parseStoredSealedBox(JSON.parse(row.cipher));
      } catch {
        cipher = null;
      }
    }
    // 암호문이 없거나 깨졌다면, 또는 학번 해시가 없는 옛 연동이라면 연동되지 않은 것으로 본다 (다시 연동하면 된다)
    if (!row || !cipher || !row.hint || !row.hash) {
      return { linked: false, hint: null, linkedAt: null, cipher: null, profileHint: null };
    }
    return {
      linked: true,
      hint: row.hint,
      linkedAt: row.linkedAt ? new Date(row.linkedAt).toISOString() : null,
      cipher,
      profileHint: { department: row.department ?? '', admissionYear: row.admissionYear ?? null },
    };
  }

  /**
   * 학교에 한 번 로그인해 보고(검증), 성공하면 브라우저가 만든 암호문과 학번 HMAC 만 저장한다.
   *
   * 이 요청은 서버가 "아직 확인되지 않은 학번"으로 학교에 로그인을 시도하는 유일한 길이다. 그래서
   *  - 계정이 없는(탈퇴한) 사용자는 학교에 가기 전에 401 로 막는다.
   *  - 이 사용자가 이미 연동한(학교 로그인으로 확인된) 학번이면 "주인"이다: 상한 없이 다시 연동할 수 있고, 안전선(8회 실패)에
   *    걸려 멈춘 학번이라도 새 비밀번호로 **한 번** 시도할 수 있다 (guard.ts 머리 주석).
   *  - 그 밖의 학번이면 남의 학번일 수 있다: (사용자, 학번)별·사용자별·학번별 하루 실패 상한을 두고, 안전선에 걸린 학번은 건드리지 않는다.
   */
  async function link(uid: number, body: unknown): Promise<LinkResponse> {
    const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const creds = parseCredentials(o.creds);
    const cipher = parseSealedBox(o.cipher);
    if (!cipher || cipherLooksLikePlaintext(cipher, creds)) throw invalid('암호문 형식이 올바르지 않아요.');
    hitLimiter(linkLimiter, uid);

    const row = await loadLinkRow(uid);
    const linkHash = studentLinkHash(creds.studentId);
    const owner = row.hash === linkHash;
    if (!owner) await assertLinkProbeBudget(uid, linkHash, now());

    const http = newInfoHttp();
    try {
      await guardedLogin(creds.studentId, () => loginInfo(http, creds), now, { relink: owner });
    } catch (err) {
      if (!owner && err instanceof SchoolAuthFailed) {
        // 기록하다 실패해도(예: 그 사이 계정이 지워짐) 학교의 답을 가리지 않는다
        await recordLinkProbeFailure(uid, linkHash, now()).catch((e: unknown) =>
          console.warn('[school] 연동 시도 기록을 남기지 못했어요:', (e as Error)?.name),
        );
      }
      throw err;
    }
    const profile = toProfile(await fetchProfile(http));

    const hint = studentIdHint(creds.studentId);
    let saved: { changes: number };
    try {
      saved = await run(
        `UPDATE users
            SET school_cipher = ?, school_hint = ?, school_student_hash = ?, school_linked_at = now(),
                school_department = ?, school_admission_year = ?, school_gender = COALESCE(?, school_gender)
          WHERE id = ?`,
        [JSON.stringify({ v: cipher.v, iv: cipher.iv, ct: cipher.ct }), hint, linkHash, profile.department, profile.admissionYear, profile.gender ?? null, uid],
      );
    } catch (err) {
      // 학번 하나당 계정 하나(uq_users_school_student_hash): 학교 인증에 성공한 뒤에만 알려 주므로 남의 학번 여부를 캐내는 데 쓸 수 없다
      if (isUniqueViolation(err)) throw alreadyRegistered();
      throw err;
    }
    // 학교 로그인 중에 계정이 지워졌다면 아무것도 저장되지 않았다 — 성공이라고 알리지 않는다
    if (saved.changes !== 1) throw sessionGone();
    // 라운지 프로필(이름을 가린 닉네임·학과·입학년도)을 학교 계정 정보로 채운다 — 재연동이면 학과·입학년도도 갱신된다
    await ensureSchoolProfile(uid);
    if (!owner) await clearLinkProbe(uid, linkHash).catch(() => undefined);
    return { linked: true, hint, profile };
  }

  /**
   * 가입 ① 학생 인증: 학교에 **한 번** 로그인해 학번·비밀번호가 맞는지 보고 프로필을 읽는다. 아무것도 저장하지 않는다.
   * 로그인은 guardedLogin 을 그대로 거친다(학번당 연속 5회 실패 30분 잠금, 8회 멈춤, 동시 요청 거절).
   * 사용자 id 가 아직 없어 link() 의 "남의 학번 시도 예산"은 쓸 수 없다 — 그 자리는 호출하는 쪽(auth.ts)의 IP 기준 제한이 맡는다.
   * 이미 어느 계정에 연동된 학번이면 학교 인증에 성공한 **뒤에** 409 로 알린다(비밀번호를 모르는 사람이 가입 여부를 알 수 없다).
   */
  async function verifyStudent(creds: SchoolCredentials): Promise<{ profile: SchoolProfile; hint: string; linkHash: string }> {
    const http = newInfoHttp();
    await guardedLogin(creds.studentId, () => loginInfo(http, creds), now, { relink: false });
    const profile = toProfile(await fetchProfile(http));
    const linkHash = studentLinkHash(creds.studentId);
    const taken = await get<{ x: number }>('SELECT 1 AS x FROM users WHERE school_student_hash = ?', [linkHash]);
    if (taken) throw alreadyRegistered();
    return { profile, hint: studentIdHint(creds.studentId), linkHash };
  }

  async function unlink(uid: number): Promise<{ ok: true }> {
    await run(
      `UPDATE users
          SET school_cipher = NULL, school_hint = NULL, school_student_hash = NULL, school_linked_at = NULL,
              school_department = NULL, school_admission_year = NULL, school_gender = NULL,
              profile_done = FALSE
        WHERE id = ?`,
      [uid],
    );
    return { ok: true };
  }

  // ── 시간표 ───────────────────────────────────────────────────

  const MAX_IMPORT = 100;

  async function loadSchoolTimetable(creds: SchoolCredentials) {
    const http = newInfoHttp();
    await guardedLogin(creds.studentId, () => loginInfo(http, creds), now);
    const profile = await fetchProfile(http);
    const parsed = await fetchTimetable(http, profile.studentId);
    const grid = toGrid(parsed.classes);
    let entries = grid.entries;
    const skipped = [...parsed.skipped, ...grid.skipped];
    if (entries.length > MAX_IMPORT) {
      for (const e of entries.slice(MAX_IMPORT)) {
        skipped.push({ subject: e.title, reason: `한 번에 가져올 수 있는 수업 수(${MAX_IMPORT}개)를 넘었어요.` });
      }
      entries = entries.slice(0, MAX_IMPORT);
    }
    return { profile: toProfile(profile), classes: parsed.classes, entries, adjusted: grid.adjusted, skipped };
  }

  async function timetablePreview(uid: number, creds: SchoolCredentials): Promise<TimetablePreview> {
    hitLimiter(schoolCallLimiter, uid);
    await requireLinked(uid, creds);
    const t = await loadSchoolTimetable(creds);
    return { profile: t.profile, classes: t.classes, adjusted: t.adjusted, skipped: t.skipped };
  }

  /**
   * 학교에서 가져온 기존 일정(source='school')을 새 일정으로 바꾼다 (설계 §6).
   * 새 일정을 먼저 임시 표시로 넣고 → 이전 'school' 일정을 지우고 → 임시 표시를 'school' 로 바꾼다.
   * 중간에 실패해도 시간표가 비지 않는다. 직접 입력한 일정(source='manual')은 건드리지 않는다.
   * 학교가 빈 시간표를 줬다면(학기 전 등) 기존 가져온 일정을 지우지 않는다.
   */
  async function timetableImport(uid: number, creds: SchoolCredentials): Promise<TimetableImportResult> {
    hitLimiter(schoolCallLimiter, uid);
    await requireLinked(uid, creds);
    const t = await loadSchoolTimetable(creds);
    if (t.entries.length === 0) return { imported: 0, replaced: 0, adjusted: t.adjusted, skipped: t.skipped };

    // 동시에 두 번 가져와도 서로의 임시 일정을 건드리지 않도록 가져올 때마다 다른 표시를 쓴다
    const tag = `school-new-${crypto.randomBytes(6).toString('hex')}`;
    const placeholders = t.entries.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params = t.entries.flatMap((e) => [uid, e.day, e.startMin, e.endMin, e.title, e.place, 'weekly', null, tag]);
    await run(
      `INSERT INTO timetable_entries (user_id, day, start_min, end_min, title, place, repeat_kind, date, source)
       VALUES ${placeholders}`,
      params,
    );
    try {
      const removed = await run("DELETE FROM timetable_entries WHERE user_id = ? AND source = 'school'", [uid]);
      await run("UPDATE timetable_entries SET source = 'school' WHERE user_id = ? AND source = ?", [uid, tag]);
      return { imported: t.entries.length, replaced: removed.changes, adjusted: t.adjusted, skipped: t.skipped };
    } catch (err) {
      // 중간 실패: 방금 넣은 임시 일정만 치운다 (이전 'school' 일정은 아직 그대로다)
      await run('DELETE FROM timetable_entries WHERE user_id = ? AND source = ?', [uid, tag]).catch(() => undefined);
      throw err;
    }
  }

  // ── 내 학교 예약 ─────────────────────────────────────────────

  /**
   * 예약 사이트에 로그인 한 번. 로그인은 모두 가드(guardedLogin)를 거친다.
   *
   * 신청 흐름이 확인되지 않은 사이트(hsel)는 달리 다룬다: 거기서 로그인이 안 된다고 "비밀번호가 틀렸다"는 뜻이 아니고,
   * 화면을 열 때마다 그 로그인을 되풀이하면 학교 쪽에 실패가 쌓일 수 있다.
   *  - 그 결과를 학번 하나에 공유되는 실패 횟수에 세지 않는다 (verdict:false) — 세면 다른 사이트의 성공이 지우고 지우고 해서
   *    안전선이 엉뚱하게 움직인다.
   *  - 안 되면 24시간 동안 다시 시도하지 않는다. 이 기록은 DB 에 있어 서버리스에서 인스턴스가 바뀌어도 유지된다.
   * 건너뛰거나 실패한 경우는 SchoolUnavailable(고정 문장)로 알린다 — 비밀번호 오류로 알리지 않는다.
   */
  async function loginResve(client: ResveClient, site: string, verified: boolean, creds: SchoolCredentials): Promise<void> {
    if (verified) {
      await guardedLogin(creds.studentId, () => client.login(site, creds), now);
      return;
    }
    if (await isSiteBackedOff(creds.studentId, site, now())) throw new SchoolUnavailable(UNVERIFIED_SKIP_REASON);
    try {
      await guardedLogin(creds.studentId, () => client.login(site, creds), now, { verdict: false });
    } catch (err) {
      if (err instanceof SchoolAuthFailed) {
        await setSiteBackoff(creds.studentId, site, now());
        throw new SchoolUnavailable(UNVERIFIED_SKIP_REASON);
      }
      throw err;
    }
  }

  /**
   * 지원하는 모든 예약 시스템의 내 신청내역. 로그인은 **사이트마다 한 번**(같은 사이트의 시스템 키는 공유)이고,
   * 비밀번호가 틀렸다면 첫 실패에서 바로 중단한다 (다른 사이트로 계속 두드리면 실패가 쌓인다).
   * 로그인을 마친 뒤의 개별 조회 실패는 `failed` 에 담고 나머지는 계속한다.
   */
  async function myReservations(uid: number, creds: SchoolCredentials): Promise<MyReservationsResult> {
    hitLimiter(schoolCallLimiter, uid);
    await requireLinked(uid, creds);

    const failed: MyReservationsResult['failed'] = [];
    const clients = new Map<string, ResveClient>();
    for (const site of sitesOf(RESERVE_SYSTEMS)) {
      const siteSystems = RESERVE_SYSTEMS.filter((x) => x.site === site);
      const verified = siteSystems.some((x) => x.verified);
      const client = newResve();
      try {
        await loginResve(client, site, verified, creds);
        clients.set(site, client);
      } catch (err) {
        // 아직 한 곳도 로그인하지 못했는데 비밀번호가 틀렸거나 잠겼다면 계속하지 않는다
        if (clients.size === 0 && (err instanceof SchoolAuthFailed || err instanceof SchoolLocked)) throw err;
        if (!(err instanceof SchoolError)) throw err;
        for (const s of siteSystems) failed.push({ facility: s.key, reason: err.message });
      }
    }

    const results = await Promise.all(
      RESERVE_SYSTEMS.filter((s) => clients.has(s.site)).map(async (s) => {
        try {
          const rows = await clients.get(s.site)!.mine(s.key);
          return { system: s, rows, error: null as unknown };
        } catch (err) {
          if (!(err instanceof SchoolError)) console.warn('[school] 신청내역 조회 중 예상하지 못한 오류:', (err as Error)?.name);
          return { system: s, rows: [] as MineRow[], error: err };
        }
      }),
    );
    const reservations: SchoolReservation[] = [];
    for (const r of results) {
      if (r.error) failed.push({ facility: r.system.key, reason: safeReason(r.error, '내 신청내역을 읽지 못했어요.') });
      else reservations.push(...r.rows.map((row) => toSchoolReservation(r.system.key, r.system.label, row)));
    }
    return { reservations, failed };
  }

  // ── 바로 신청 ────────────────────────────────────────────────

  type ReservationRow = {
    id: number;
    meetingId: number;
    date: string;
    startMin: number;
    endMin: number;
    schoolStatus: string;
    facilityName: string;
    systemKey: string | null;
    campusName: string | null;
  };

  type Plan = {
    reservation: ReservationRow;
    system: ReserveSystem;
    space: Space;
    setup: ResveSetup;
    info: ResveInfo;
    items: ResveItem[];
    times: string[];
    title: string;
    when: string;
  };

  type PlanResult =
    | { ok: true; plan: Plan }
    | { ok: false; reason: string; title: string; when: string; alreadySubmitted: boolean };

  /**
   * 예약 계획을 학교에 신청할 수 있는지 **학교에 로그인하지 않고** 판단한다 (공개 조회만 쓴다).
   * 소유 확인(그 회의의 멤버) → 시설 매핑 → 지난 날짜 → 이미 신청함 → 공간·설정 → 슬롯 펼치기 → 슬롯 상태.
   * 미리보기와 제출이 둘 다 이 함수를 거친다 (미리보기와 제출 사이에 상태가 바뀔 수 있어 제출에서도 다시 한다).
   */
  async function planBooking(uid: number, reservationId: number): Promise<PlanResult> {
    const r = await get<ReservationRow>(
      `SELECT r.id, r.meeting_id AS "meetingId", r.date, r.start_min AS "startMin", r.end_min AS "endMin",
              r.school_status AS "schoolStatus", f.name AS "facilityName",
              f.system_key AS "systemKey", f.campus_name AS "campusName"
         FROM reservations r JOIN facilities f ON f.id = r.facility_id
        WHERE r.id = ?`,
      [reservationId],
    );
    if (!r) throw new ApiInputError('NOT_FOUND', '예약을 찾을 수 없어요.');
    const member = await get('SELECT 1 AS x FROM meeting_members WHERE meeting_id = ? AND user_id = ?', [r.meetingId, uid]);
    if (!member) throw new ApiInputError('FORBIDDEN', '이 회의의 멤버만 학교에 신청할 수 있어요.');

    const span = `${fmtHm(r.startMin)}~${fmtHm(r.endMin)}`;
    const base = { title: r.facilityName, when: `${r.date} ${span}`, alreadySubmitted: false };
    const stop = (reason: string, extra: Partial<typeof base> = {}): PlanResult => ({ ok: false, reason, ...base, ...extra });

    const prior = await get<{ x: number }>(
      `SELECT 1 AS x FROM school_bookings WHERE reservation_id = ? AND status IN (${BOOK_ACTIVE.map(() => '?').join(',')})`,
      [reservationId, ...BOOK_ACTIVE],
    );
    if (prior) return stop(ALREADY_SUBMITTED_REASON, { alreadySubmitted: true });
    if (r.schoolStatus === 'confirmed') return stop('이미 학교에서 확인된 예약이에요.');

    const system = systemForFacility(r.systemKey);
    if (!system || !r.campusName) return stop('이 시설은 학교 예약 시스템에 연결되어 있지 않아요. 학교 사이트에서 직접 신청해 주세요.');
    if (!isRealDate(r.date)) return stop('예약 날짜를 읽을 수 없어요.');
    if (r.date < kstDate(now())) return stop('이미 지난 날짜의 예약이에요.');

    const client = newResve();
    const spaces = await client.spaces(system.key);
    const space = findSpace(spaces, r.campusName);
    if (!space) return stop(`학교 예약 시스템(${system.label})에서 "${r.campusName}" 공간을 찾지 못했어요.`);
    const withSpace = { title: `${system.label} · ${space.name}` };

    const setup = await client.setup(system.key, space.id);
    if (!setup) return stop('이 공간은 학교에 예약 설정이 없어요.', withSpace);

    const expanded = expandSlots(r.startMin, r.endMin, setup);
    if (!expanded.ok) return stop(expanded.reason, withSpace);
    const when = formatWhen(r.date, expanded.times, setup.termMin);

    const states = slotStates(setup, await client.booked(system.key, space.id, r.date), r.date, now());
    for (const t of expanded.times) {
      const state = states.find((s) => s.start === t)?.state;
      if (state === 'booked') return stop(`${t} 시간은 학교에 이미 예약되어 있어요.`, { ...withSpace, when });
      if (state !== 'available') {
        return stop(`${t} 시간은 지금 신청할 수 없어요. 지난 시간이거나, 운영하는 요일·기간이 아니거나, 신청 가능한 시간 전이에요.`, {
          ...withSpace,
          when,
        });
      }
    }

    const [info, items] = await Promise.all([client.info(system.key, space.id), client.items(system.key, space.id)]);
    return { ok: true, plan: { reservation: r, system, space, setup, info, items, times: expanded.times, title: withSpace.title, when } };
  }

  function contextOf(plan: Plan, reg: Registration): BookingContext {
    return {
      key: plan.system.key,
      site: plan.system.site,
      fn: plan.system.fn,
      space: plan.space,
      day: plan.reservation.date,
      setup: plan.setup,
      info: plan.info,
      identities: identityNames(plan.info.identityCode),
      items: plan.items,
      regUrl: reg.regUrl,
      layout: reg.layout,
      userNm: reg.userNm,
      hakbun: reg.hakbun,
      telno: reg.telno,
      email: reg.email,
    };
  }

  const emptyApplicant = { name: '', studentId: '', tel: '', email: '' };

  async function bookPreview(uid: number, body: unknown): Promise<BookPreview> {
    const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const creds = parseCredentials(o.creds);
    const reservationId = parseReservationId(o.reservationId);
    hitLimiter(schoolCallLimiter, uid);
    await requireLinked(uid, creds);

    const planned = await planBooking(uid, reservationId);
    if (!planned.ok) {
      return {
        reservationId,
        title: planned.title,
        when: planned.when,
        applicant: emptyApplicant,
        identities: [],
        manager: '',
        items: [],
        canBook: false,
        reason: planned.reason,
        alreadySubmitted: planned.alreadySubmitted,
      };
    }
    const { plan } = planned;

    // 신청할 수 있어 보일 때만 로그인한다 (신청 화면의 이름·학번·연락처를 읽으려고)
    const client = newResve();
    await loginResve(client, plan.system.site, plan.system.verified, creds);
    const reg = await client.fetchRegistration(plan.system.key);
    return {
      reservationId,
      title: plan.title,
      when: plan.when,
      applicant: { name: reg.userNm, studentId: reg.hakbun, tel: reg.telno, email: reg.email },
      identities: identityNames(plan.info.identityCode),
      manager: `${plan.info.mngr} ${plan.info.telno}`.trim(),
      items: toBookItems(plan.items),
      canBook: true,
      reason: null,
      alreadySubmitted: false,
    };
  }

  async function setBookingStatus(id: number, status: string): Promise<void> {
    await run('UPDATE school_bookings SET status = ? WHERE id = ?', [status, id]);
  }

  /**
   * 신청 제출. 사용자가 미리보기를 보고 명시적으로 누른 한 번에 한 번만 학교에 보낸다.
   *  1) 미리보기와 같은 검증을 **다시** 한다.
   *  2) school_bookings 에 'submitted' 를 먼저 기록한다 (같은 예약 계획에 submitted/confirmed/unknown 이 있으면 거절 —
   *     부분 유니크 인덱스가 동시 요청도 막는다).
   *  3) 로그인 → 신청 화면 → 서버 검증(AJAX) → 본 제출. 본 제출 **전**의 어떤 실패도 'failed' 로 두고 오류를 돌려준다(보내지 않았으므로 다시 시도 가능).
   *  4) 본 제출을 보낸 뒤에는 어떤 오류도 "보냈을 수 있음"이다 → 자동 재전송 없이 'unknown'.
   *  5) 내 신청내역에서 이번에 새로 생긴 행(날짜·공간 일치)을 찾으면 'confirmed' 와 reservations.school_status='confirmed'.
   */
  async function bookSubmit(uid: number, body: unknown): Promise<BookResult> {
    const req = parseBookSubmit(body);
    hitLimiter(schoolCallLimiter, uid);
    await requireLinked(uid, req.creds);

    const planned = await planBooking(uid, req.reservationId);
    if (!planned.ok) throw new SchoolRejected(planned.reason);
    const { plan } = planned;

    for (const it of plan.items) {
      if (it.mustYn === 'Y' && !(req.items[it.name] ?? '').trim()) {
        throw invalid(`필수 항목을 입력해 주세요: ${it.name}`);
      }
    }

    let bookingId: number;
    try {
      bookingId = await insert(
        "INSERT INTO school_bookings (reservation_id, user_id, status) VALUES (?, ?, 'submitted') RETURNING id",
        [req.reservationId, uid],
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new SchoolRejected(ALREADY_SUBMITTED_REASON);
      throw err;
    }

    const client = newResve();
    const key = plan.system.key;
    let before: Set<string> | null = null;
    let sentAlerts: string[] = [];
    let sent = false;
    try {
      await loginResve(client, plan.system.site, plan.system.verified, req.creds);
      const reg = await client.fetchRegistration(key);
      const ctx = contextOf(plan, reg);
      const payload = buildPayload(ctx, plan.times, req.items, req.tel, req.email);
      // 이번 신청으로 새로 생긴 행을 가려내려고 미리 목록을 받아 둔다 (못 받으면 날짜·공간 일치만으로 판단한다)
      try {
        before = new Set((await client.mine(key)).map((r) => r.no));
      } catch {
        before = null;
      }
      await client.validate(key, reg.regUrl, payload);
      // ── 여기부터는 학교에 신청이 갔을 수 있다 ──
      sent = true;
      sentAlerts = (await client.send(key, reg.regUrl, payload)).alerts;
    } catch (err) {
      if (!sent) {
        await setBookingStatus(bookingId, 'failed').catch(() => undefined);
        throw err;
      }
      await setBookingStatus(bookingId, 'unknown');
      return {
        status: 'unknown',
        message:
          '신청을 보냈지만 결과를 받지 못했어요. 자동으로 다시 보내지 않아요. 학교 사이트의 내 신청내역에서 확인해 주세요.',
        found: [],
      };
    }

    let found: MineRow[] | null = null;
    try {
      const rows = await client.mine(key);
      found = rows.filter(
        (r) => r.date.includes(plan.reservation.date) && r.space.includes(plan.space.name) && !(before?.has(r.no) ?? false),
      );
    } catch {
      found = null;
    }

    if (found && found.length > 0) {
      await setBookingStatus(bookingId, 'confirmed');
      await run("UPDATE reservations SET school_status = 'confirmed' WHERE id = ?", [req.reservationId]).catch((err) =>
        console.warn('[school] 예약 상태를 학교 확인됨으로 바꾸지 못했어요:', (err as Error)?.name),
      );
      return {
        status: 'confirmed',
        message: `학교 예약 시스템의 내 신청내역에서 확인했어요 (상태: ${found[0].status || '확인 중'}).`,
        found: found.map((r) => toSchoolReservation(key, plan.system.label, r)),
      };
    }
    await setBookingStatus(bookingId, 'unknown');
    const alert = sentAlerts.length > 0 ? ` 학교 안내: ${sentAlerts.join(' / ')}` : '';
    return {
      status: 'unknown',
      message: `신청을 보냈지만 내 신청내역에서 확인하지 못했어요. 자동으로 다시 보내지 않아요. 학교 사이트의 내 신청내역에서 직접 확인해 주세요.${alert}`,
      found: [],
    };
  }

  /**
   * 학교에 보낸 신청 취소. 이 예약에 '확인됨/불명' 신청 기록이 없으면 학교에는 아무것도 없으니 그대로 돌려준다.
   * 있으면 학교 로그인 → 신청내역에서 그 신청의 "취소" 컨트롤을 따라간다(resve.cancelMine). 어떤 경우에도 자동 재시도는 없다.
   */
  async function bookCancel(uid: number, body: unknown): Promise<BookCancelResult> {
    const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const creds = parseCredentials(o.creds);
    const reservationId = parseReservationId(o.reservationId);
    hitLimiter(schoolCallLimiter, uid);
    await requireLinked(uid, creds);

    const r = await get<ReservationRow>(
      `SELECT r.id, r.meeting_id AS "meetingId", r.date, r.start_min AS "startMin", r.end_min AS "endMin",
              r.school_status AS "schoolStatus", f.name AS "facilityName",
              f.system_key AS "systemKey", f.campus_name AS "campusName"
         FROM reservations r JOIN facilities f ON f.id = r.facility_id
        WHERE r.id = ?`,
      [reservationId],
    );
    if (!r) throw new ApiInputError('NOT_FOUND', '예약을 찾을 수 없어요.');
    const member = await get('SELECT 1 AS x FROM meeting_members WHERE meeting_id = ? AND user_id = ?', [r.meetingId, uid]);
    if (!member) throw new ApiInputError('FORBIDDEN', '이 회의의 멤버만 학교 신청을 취소할 수 있어요.');

    const booking = await get<{ id: number; status: string }>(
      `SELECT id, status FROM school_bookings WHERE reservation_id = ? AND status IN ('confirmed', 'unknown') ORDER BY id DESC LIMIT 1`,
      [reservationId],
    );
    if (!booking && r.schoolStatus !== 'confirmed') {
      return { status: 'nothing-to-cancel', message: '학교에 보낸 신청이 없어서 앱의 예약만 지우면 돼요.' };
    }

    const system = systemForFacility(r.systemKey);
    if (!system || !r.campusName) {
      throw new SchoolUnavailable('이 시설은 학교 예약 시스템과 연결되어 있지 않아서 앱이 취소할 수 없어요. 학교 사이트에서 직접 취소해 주세요.');
    }
    const client = newResve();
    const spaces = await client.spaces(system.key);
    const space = findSpace(spaces, r.campusName);
    if (!space) throw new SchoolUnavailable('학교 예약 시스템에서 이 공간을 찾지 못해서 앱이 취소할 수 없어요. 학교 사이트에서 직접 취소해 주세요.');

    await loginResve(client, system.site, system.verified, creds);
    const result = await client.cancelMine(system.key, { date: r.date, space: space.name, startHm: fmtHm(r.startMin) });
    if (booking) await setBookingStatus(booking.id, 'cancelled');
    await run("UPDATE reservations SET school_status = 'planned' WHERE id = ?", [reservationId]);
    return result === 'cancelled'
      ? { status: 'cancelled', message: '학교 신청을 취소했어요.' }
      : { status: 'nothing-to-cancel', message: '학교 신청내역에 이 신청이 없어요. 앱의 예약만 지우면 돼요.' };
  }

  // ── e-class (읽기 전용 조회) ──────────────────────────────────

  /**
   * e-class 의 강의·과제·출석 현황. 연동한 학번과 같은 계정으로 요청마다 e-class 에 로그인해 읽고 세션은 버린다.
   * 학교 로그인 가드(연속 5회 실패 30분 잠금)를 같이 쓴다: 잠겨 있으면 e-class 에도 요청하지 않는다.
   */
  async function eclassOverview(uid: number, body: unknown): Promise<EclassSnapshot> {
    const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const creds = parseCredentials(o.creds);
    hitLimiter(schoolCallLimiter, uid);
    await requireLinked(uid, creds);
    const flow = createEclassFlow(newEclassHttp(), { now });
    const budget = await guardedLogin(creds.studentId, () => flow.login(creds), now);
    return flow.snapshot(budget);
  }

  return {
    getLink,
    link,
    verifyStudent,
    unlink,
    timetablePreview,
    timetableImport,
    myReservations,
    bookPreview,
    bookSubmit,
    bookCancel,
    eclassOverview,
  };
}

export type SchoolService = ReturnType<typeof createSchoolService>;
