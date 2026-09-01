/** 도메인 에러 → HTTP 응답. 에러 코드는 shared/types.ts 것을 그대로 쓴다. (담당: 공용) */
import { NextResponse } from 'next/server';
import type { AppError, ErrorCode } from '@/shared/types';

const STATUS: Record<ErrorCode, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  NOT_OPEN: 409,
  DEADLINE_PASSED: 409,
  ALREADY_JOINED: 409,
  NOT_JOINED: 409,
  SLOT_NOT_FOUND: 404,
  SLOT_FULL: 409,
  HOST_CANNOT_LEAVE: 409,
  NOT_APPLICANT: 409,
  TOO_EARLY: 409,
  INVALID: 400,
  LOW_TRUST: 403,
};

export function toErrorResponse(error: AppError) {
  return NextResponse.json({ error }, { status: STATUS[error.code] ?? 400 });
}
