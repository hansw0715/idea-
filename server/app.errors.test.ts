/**
 * 전역 오류 처리기(errorHandler) 단위 시험 — DB·네트워크 없이 가짜 응답 객체로 부른다.
 *
 * 지키는 것
 *  - 클라이언트가 만든 오류(깨진 JSON, 큰 본문, 지원하지 않는 charset·encoding, 깨진 퍼센트 인코딩 주소)는
 *    5xx 가 아니라 그 4xx 와 고정 문장으로 돌려준다.
 *  - 응답에도 로그에도 요청 원문(학교 비밀번호 같은 평문)과 오류 메시지·스택이 나가지 않는다.
 *    body-parser 오류 객체는 `body` 에 요청 원문을 실어 나르므로 console.error(err) 로 찍으면 비밀번호가 로그에 남는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { errorHandler } from './app.js';

const SECRET = 'LEAKME-pw-123!';
const STUDENT = '2021204044';

type Sent = { status: number | null; body: unknown; headersSent: boolean };

function fakeRes(headersSent = false): { res: Response; sent: Sent } {
  const sent: Sent = { status: null, body: undefined, headersSent };
  const res = {
    get headersSent() {
      return sent.headersSent;
    },
    status(code: number) {
      sent.status = code;
      return res;
    },
    json(body: unknown) {
      sent.body = body;
      return res;
    },
  } as unknown as Response;
  return { res, sent };
}

/** body-parser(http-errors) 가 만드는 오류와 같은 모양: status·statusCode·type 과 요청 원문(body) */
function bodyParserError(status: number, type: string, message: string, ctor: ErrorConstructor = Error) {
  const e = new ctor(`${message} ${SECRET}`) as Error & Record<string, unknown>;
  e.status = status;
  e.statusCode = status;
  e.type = type;
  e.expose = true;
  e.body = `{"studentId":"${STUDENT}","password":"${SECRET}"`;
  return e;
}

function run(err: unknown, headersSent = false) {
  const { res, sent } = fakeRes(headersSent);
  const next = vi.fn() as unknown as NextFunction;
  errorHandler(err, {} as Request, res, next);
  return { sent, next: next as unknown as ReturnType<typeof vi.fn> };
}

let errorLog: MockInstance<typeof console.error>;
let otherLogs: MockInstance<typeof console.log>[];

beforeEach(() => {
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  otherLogs = [vi.spyOn(console, 'log').mockImplementation(() => undefined), vi.spyOn(console, 'warn').mockImplementation(() => undefined)];
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** 지금까지 콘솔에 나간 모든 인자를 하나의 문자열로 (객체는 속성까지 풀어서) */
function everythingLogged(): string {
  const dump = (v: unknown): string => {
    if (v instanceof Error) {
      return JSON.stringify({ name: v.name, message: v.message, stack: v.stack, ...(v as unknown as Record<string, unknown>) });
    }
    return typeof v === 'string' ? v : JSON.stringify(v);
  };
  return [errorLog, ...otherLogs].flatMap((s) => s.mock.calls.flat()).map(dump).join('\n');
}

describe('클라이언트 잘못은 그 4xx 와 고정 문장으로 — 요청 원문은 응답에도 로그에도 없다', () => {
  const cases: [string, number, string, string][] = [
    ['깨진 JSON', 400, 'entity.parse.failed', '요청 본문 형식이 올바르지 않습니다.'],
    ['너무 큰 본문', 413, 'entity.too.large', '요청 본문이 너무 큽니다.'],
    ['지원하지 않는 charset', 415, 'charset.unsupported', '지원하지 않는 요청 형식입니다.'],
    ['지원하지 않는 content-encoding', 415, 'encoding.unsupported', '지원하지 않는 요청 형식입니다.'],
    ['요청이 중간에 끊김', 400, 'request.aborted', '요청 본문 형식이 올바르지 않습니다.'],
    ['본문 길이가 맞지 않음', 400, 'request.size.invalid', '요청 본문 형식이 올바르지 않습니다.'],
  ];

  it.each(cases)('%s → %i', (_name, status, type, message) => {
    const { sent, next } = run(bodyParserError(status, type, `bad ${type}`, status === 400 ? SyntaxError : Error));
    expect(sent.status).toBe(status);
    expect(sent.body).toEqual({ error: message, code: 'INVALID' });
    expect(JSON.stringify(sent.body)).not.toContain(SECRET);
    expect(JSON.stringify(sent.body)).not.toContain(STUDENT);
    expect(next).not.toHaveBeenCalled();
    // 클라이언트가 만든 오류라서 서버 로그에는 아무것도 남기지 않는다.
    expect(errorLog).not.toHaveBeenCalled();
    expect(everythingLogged()).not.toContain(SECRET);
  });

  it('깨진 퍼센트 인코딩 주소(URIError, status 400)는 500 이 아니라 400', () => {
    const e = new URIError("Failed to decode param '%E0%A4%A'") as URIError & Record<string, unknown>;
    e.status = 400;
    e.statusCode = 400;
    const { sent } = run(e);
    expect(sent.status).toBe(400);
    expect(sent.body).toEqual({ error: '요청 주소가 올바르지 않습니다.', code: 'INVALID' });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('status 가 없고 statusCode 만 있는 4xx 도 같다', () => {
    const e = Object.assign(new Error('nope'), { statusCode: 404 });
    const { sent } = run(e);
    expect(sent.status).toBe(404);
    expect(sent.body).toEqual({ error: '요청을 처리할 수 없습니다.', code: 'INVALID' });
  });

  it('오류 객체의 메시지는 어떤 4xx 에서도 응답으로 나가지 않는다', () => {
    const e = Object.assign(new Error(`SELECT * FROM users WHERE password='${SECRET}'`), { status: 422 });
    const { sent } = run(e);
    expect(sent.status).toBe(422);
    expect(JSON.stringify(sent.body)).not.toMatch(/SELECT|LEAKME/);
  });
});

describe('4xx 가 아닌 것은 500 — 그래도 응답에 내부 정보가 없다', () => {
  it('일반 예외는 500 과 고정 문장, 응답에 메시지·스택이 없다', () => {
    const e = new Error(`relation "users" does not exist; password=${SECRET}`);
    const { sent } = run(e);
    expect(sent.status).toBe(500);
    expect(sent.body).toEqual({ error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
    expect(JSON.stringify(sent.body)).not.toMatch(/relation|LEAKME/);
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it('status 가 숫자가 아니거나 4xx 범위 밖이면 4xx 로 취급하지 않는다', () => {
    for (const status of ['400', 399, 500, 503, 1.5, null, undefined, NaN]) {
      const { sent } = run(Object.assign(new Error('x'), { status }));
      expect(sent.status, `status=${String(status)}`).toBe(500);
    }
  });

  it('body-parser 가 만들었지만 4xx 가 아닌 오류는 이름·종류만 로그에 남기고 원문은 남기지 않는다', () => {
    const e = bodyParserError(500, 'stream.encoding.set', 'stream encoding should not be set');
    const { sent } = run(e);
    expect(sent.status).toBe(500);
    expect(sent.body).toEqual({ error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
    expect(errorLog).toHaveBeenCalledTimes(1);
    // 오류 객체(요청 원문 body 를 든)를 그대로 넘기지 않고 문자열 둘만 넘긴다.
    for (const arg of errorLog.mock.calls[0]) expect(typeof arg).toBe('string');
    expect(everythingLogged()).not.toContain(SECRET);
    expect(everythingLogged()).not.toContain(STUDENT);
  });

  it('DB 연결 실패는 503 과 안내 문장 — 연결 문자열(비밀번호 포함)은 응답에 없다', () => {
    const e = Object.assign(new Error(`connect ECONNREFUSED postgres://app:${SECRET}@db.example.com:5432/x`), {
      code: 'ECONNREFUSED',
    });
    const { sent } = run(e);
    expect(sent.status).toBe(503);
    expect(JSON.stringify(sent.body)).toContain('DATABASE_URL');
    expect(JSON.stringify(sent.body)).not.toContain(SECRET);
    expect(JSON.stringify(sent.body)).not.toContain('db.example.com');
  });
});

describe('이미 응답을 보내기 시작했다면', () => {
  it('또 쓰지 않고 Express 기본 처리에 맡긴다', () => {
    const e = new Error('late');
    const { sent, next } = run(e, true);
    expect(sent.status).toBeNull();
    expect(sent.body).toBeUndefined();
    expect(next).toHaveBeenCalledWith(e);
  });
});
