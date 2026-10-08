/** 오류 → 문구 변환 단위 테스트. 문구 자체가 지시서의 약속이므로 핵심 문장은 그대로 비교한다. */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api';
import {
  SchoolKeyMissingError,
  SchoolStorageUnavailableError,
  classifySchoolError,
  isAmbiguousSend,
  isCredentialFailure,
  isRetryable,
  needsRelink,
  schoolErrorMessage,
} from './errors';

const api = (status: number, message: string, code?: string, data?: Record<string, unknown>) =>
  new ApiError(status, message, code, data ?? (code ? { code, error: message } : undefined));

describe('학교 오류 문구', () => {
  it('SCHOOL_AUTH_FAILED: 포털에서 먼저 확인하라고 안내한다', () => {
    const err = api(422, '서버 문구', 'SCHOOL_AUTH_FAILED');
    expect(classifySchoolError(err)).toBe('auth-failed');
    expect(schoolErrorMessage(err)).toBe(
      '학번 또는 비밀번호가 맞지 않아요. 다시 시도하기 전에 학교 포털에서 먼저 로그인해 확인해 주세요. 10번 틀리면 계정이 잠겨요.',
    );
  });

  it('SCHOOL_LOCKED: 남은 시간(retryAfterSec)을 분으로 안내한다', () => {
    const err = api(429, '서버 문구', 'SCHOOL_LOCKED', { retryAfterSec: 1800, long: false });
    expect(classifySchoolError(err)).toBe('locked');
    expect(schoolErrorMessage(err)).toBe(
      '학교 계정이 잠기지 않도록 학교 로그인을 잠시 멈췄어요. 30분 뒤에 다시 시도할 수 있어요.',
    );
    expect(schoolErrorMessage(api(429, 'x', 'SCHOOL_LOCKED', { retryAfterSec: 95, long: false }))).toContain('2분 뒤');
    expect(schoolErrorMessage(api(429, 'x', 'SCHOOL_LOCKED', { retryAfterSec: 5, long: false }))).toContain('1분 뒤');
  });

  it('SCHOOL_LOCKED: 시간이 없으면 30분으로 안내한다', () => {
    expect(schoolErrorMessage(api(429, 'x', 'SCHOOL_LOCKED'))).toContain('30분 뒤에 다시 시도할 수 있어요');
  });

  it('SCHOOL_LOCKED long: 학교 포털에서 확인하고 다시 연동하라고 안내하고, 기다리라고 하지 않는다', () => {
    const err = api(429, 'x', 'SCHOOL_LOCKED', { retryAfterSec: 0, long: true });
    expect(classifySchoolError(err)).toBe('locked-long');
    const text = schoolErrorMessage(err);
    expect(text).toContain('학교 포털에서 직접 로그인해 비밀번호를 확인한 뒤 다시 연동해 주세요');
    expect(text).not.toContain('뒤에 다시 시도');
  });

  it('SCHOOL_LOCKED long: 서버가 상황에 맞는 문장을 주면 그것을 쓴다', () => {
    const server = '학교 포털에서 직접 로그인해 계정 상태를 확인하고, 계속 쓰려면 운영자에게 알려 주세요.';
    expect(schoolErrorMessage(api(429, server, 'SCHOOL_LOCKED', { retryAfterSec: 0, long: true }))).toBe(server);
  });

  it('SCHOOL_REJECTED: 학교가 준 문장을 그대로 보여 준다', () => {
    const sentence = '필수 항목을 입력해 주세요: 소속';
    expect(schoolErrorMessage(api(422, sentence, 'SCHOOL_REJECTED'))).toBe(sentence);
  });

  it('SCHOOL_UNAVAILABLE: 학교 사이트가 응답하지 않는다고 안내한다', () => {
    expect(schoolErrorMessage(api(502, 'x', 'SCHOOL_UNAVAILABLE'))).toContain('학교 사이트가 지금 응답하지 않');
  });

  it('키 없음·저장소 불가는 각자의 문구를 그대로 쓴다', () => {
    expect(schoolErrorMessage(new SchoolKeyMissingError())).toContain('다시 연동해 주세요');
    expect(schoolErrorMessage(new SchoolStorageUnavailableError())).toContain(
      '이 브라우저는 저장소를 쓸 수 없어 학교 연동을 쓸 수 없어요',
    );
  });

  it('일반 코드(INVALID·NOT_FOUND·FORBIDDEN·RATE_LIMITED)와 모르는 코드는 서버 문장으로 처리한다', () => {
    expect(classifySchoolError(api(400, '학번은 숫자 6~10자리로 입력해 주세요.', 'INVALID'))).toBe('invalid');
    expect(classifySchoolError(api(404, 'x', 'NOT_FOUND'))).toBe('not-found');
    expect(classifySchoolError(api(403, 'x', 'FORBIDDEN'))).toBe('forbidden');
    expect(classifySchoolError(api(429, 'x', 'RATE_LIMITED'))).toBe('rate-limited');
    expect(schoolErrorMessage(api(429, '학교 계정 요청이 너무 많아요.', 'RATE_LIMITED'))).toBe('학교 계정 요청이 너무 많아요.');
    expect(classifySchoolError(api(429, 'x', 'SOMETHING_NEW'))).toBe('rate-limited');
    expect(classifySchoolError(api(418, 'x', 'SOMETHING_NEW'))).toBe('unknown');
    expect(schoolErrorMessage(api(500, '요청을 처리하지 못했습니다.'))).toBe('요청을 처리하지 못했습니다.');
  });

  it('네트워크 오류(상태 0)는 api.ts 가 만든 문장을 쓰고 network 로 분류한다', () => {
    const err = api(0, '서버에 연결하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.');
    expect(classifySchoolError(err)).toBe('network');
    expect(schoolErrorMessage(err)).toContain('서버에 연결하지 못했습니다');
  });

  it('오류 객체가 아닌 값도 안전하게 처리한다', () => {
    expect(classifySchoolError('boom')).toBe('unknown');
    expect(schoolErrorMessage(undefined)).toContain('요청을 처리하지 못했어요');
  });
});

describe('오류 성격 판별', () => {
  it('다시 연동이 필요한 오류: 인증 실패·장기 잠금·연동 없음·키 없음 (일시 잠금은 아니다)', () => {
    expect(needsRelink(api(422, 'x', 'SCHOOL_AUTH_FAILED'))).toBe(true);
    expect(needsRelink(api(429, 'x', 'SCHOOL_LOCKED', { long: true, retryAfterSec: 0 }))).toBe(true);
    expect(needsRelink(api(409, 'x', 'SCHOOL_NOT_LINKED'))).toBe(true);
    expect(needsRelink(new SchoolKeyMissingError())).toBe(true);
    expect(needsRelink(api(429, 'x', 'SCHOOL_LOCKED', { long: false, retryAfterSec: 600 }))).toBe(false);
    expect(needsRelink(api(502, 'x', 'SCHOOL_UNAVAILABLE'))).toBe(false);
  });

  it('직접 다시 시도해 볼 만한 오류: 학교 응답 없음·네트워크·알 수 없는 오류. 인증 실패·잠금은 아니다', () => {
    expect(isRetryable(api(502, 'x', 'SCHOOL_UNAVAILABLE'))).toBe(true);
    expect(isRetryable(api(0, 'x'))).toBe(true);
    expect(isRetryable(api(500, 'x'))).toBe(true);
    expect(isRetryable(api(422, 'x', 'SCHOOL_AUTH_FAILED'))).toBe(false);
    expect(isRetryable(api(429, 'x', 'SCHOOL_LOCKED'))).toBe(false);
    expect(isRetryable(api(422, 'x', 'SCHOOL_REJECTED'))).toBe(false);
  });

  it('로그인 계열 실패: 인증 실패와 잠금', () => {
    expect(isCredentialFailure(api(422, 'x', 'SCHOOL_AUTH_FAILED'))).toBe(true);
    expect(isCredentialFailure(api(429, 'x', 'SCHOOL_LOCKED'))).toBe(true);
    expect(isCredentialFailure(api(502, 'x', 'SCHOOL_UNAVAILABLE'))).toBe(false);
  });

  it('신청 제출에서 학교에 갔는지 알 수 없는 오류: 연결 끊김과 코드 없는 5xx 뿐', () => {
    expect(isAmbiguousSend(api(0, 'x'))).toBe(true);
    expect(isAmbiguousSend(api(500, 'x'))).toBe(true);
    expect(isAmbiguousSend(api(503, 'x'))).toBe(true);
    // 서버가 제출 전에 멈춘 오류는 확실하다
    expect(isAmbiguousSend(api(422, 'x', 'SCHOOL_REJECTED'))).toBe(false);
    expect(isAmbiguousSend(api(502, 'x', 'SCHOOL_UNAVAILABLE'))).toBe(false);
    expect(isAmbiguousSend(api(400, 'x', 'INVALID'))).toBe(false);
    expect(isAmbiguousSend(new Error('x'))).toBe(false);
  });
});
