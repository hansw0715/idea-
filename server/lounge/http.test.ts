/**
 * 라운지 공용 오류 계약 시험 (DB 없음).
 *
 * 속도 제한 초과(429 RATE_LIMITED)는 처음에 공용 ErrorCode·ERROR_STATUS 에 없어서, 라우트들이 타입에 없는 문자열을
 * res.status(429).json({ code: 'RATE_LIMITED' }) 로 직접 써서 보냈다. 클라이언트가 code 로 분기하려면 공용 계약에
 * 있어야 하므로, 아래 시험이 (1) 계약 자체와 (2) 라우트가 쓰는 code 문자열이 전부 계약에 있는지를 지킨다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Response } from 'express';
import { ERROR_MESSAGES, ERROR_STATUS, fail } from '../../shared/lounge/types.js';
import type { ErrorCode } from '../../shared/lounge/types.js';
import { sendError, sendResult } from './http.js';

function fakeRes() {
  const sent: { status: number | null; body: unknown } = { status: null, body: undefined };
  const res = {
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

describe('공용 오류 계약', () => {
  const codes = Object.keys(ERROR_MESSAGES) as ErrorCode[];

  it('모든 ErrorCode 에 문장과 HTTP 상태가 있다', () => {
    for (const code of codes) {
      expect(ERROR_MESSAGES[code], code).toMatch(/\S/);
      expect(ERROR_STATUS[code], code).toBeGreaterThanOrEqual(400);
      expect(ERROR_STATUS[code], code).toBeLessThan(600);
    }
    // ERROR_STATUS 에 계약에 없는 코드가 따로 남지 않는다.
    expect(Object.keys(ERROR_STATUS).sort()).toEqual([...codes].sort());
  });

  it('RATE_LIMITED 는 429 — fail() 과 sendError() 가 그대로 쓴다', () => {
    expect(ERROR_STATUS.RATE_LIMITED).toBe(429);
    const { res, sent } = fakeRes();
    const r = fail('RATE_LIMITED', '위치를 너무 자주 보내고 있어요. 잠시 후 다시 시도해 주세요.');
    if (r.ok) throw new Error('fail() 은 실패 결과여야 한다');
    sendError(res, r.error);
    expect(sent.status).toBe(429);
    expect(sent.body).toEqual({ error: '위치를 너무 자주 보내고 있어요. 잠시 후 다시 시도해 주세요.', code: 'RATE_LIMITED' });
  });

  it('문장을 따로 주지 않으면 기본 문장을 쓴다', () => {
    const { res, sent } = fakeRes();
    sendResult(res, fail('RATE_LIMITED'));
    expect(sent.status).toBe(429);
    expect(sent.body).toEqual({ error: ERROR_MESSAGES.RATE_LIMITED, code: 'RATE_LIMITED' });
  });

  it('기본 BANNED 문장은 정지 사유를 노쇼로 단정하지 않는다 (신고 누적·관리자 정지도 같은 코드를 쓴다)', () => {
    expect(ERROR_MESSAGES.BANNED).not.toMatch(/노쇼|신고/);
    expect(ERROR_STATUS.BANNED).toBe(403);
  });
});

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('라우트가 직접 쓰는 code 문자열은 전부 계약에 있다', () => {
  // 서버 라우트·미들웨어에서 `code: 'XXX'` 로 직접 써 보내는 값. fail('XXX') 는 타입이 막아 주지만 이 문자열은 막아 주지 못한다.
  const roots = [path.join(HERE, 'http.ts'), path.join(HERE, 'routes'), path.join(HERE, 'services')];

  function sourceFiles(p: string): string[] {
    if (!fs.existsSync(p)) return [];
    if (fs.statSync(p).isFile()) return [p];
    return fs.readdirSync(p).flatMap((name) => sourceFiles(path.join(p, name)));
  }

  const files = roots.flatMap(sourceFiles).filter((f) => f.endsWith('.ts') && !/\.test\.ts$/.test(f));

  it('시험이 소스를 실제로 찾았다', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("res.….json({ …, code: 'XXX' }) 의 XXX 는 ErrorCode", () => {
    const known = new Set(Object.keys(ERROR_MESSAGES));
    const unknown: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bcode:\s*'([A-Z][A-Z_]*)'/g)) {
        if (!known.has(m[1])) unknown.push(`${path.relative(HERE, file)}: ${m[1]}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('429 로 직접 응답하는 곳은 RATE_LIMITED 코드를 함께 보낸다', () => {
    const bad: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/status\(429\)\.json\(\{([^}]*)\}\)/g)) {
        if (!/code:\s*'RATE_LIMITED'/.test(m[1])) bad.push(path.relative(HERE, file));
      }
    }
    expect(bad).toEqual([]);
  });
});
