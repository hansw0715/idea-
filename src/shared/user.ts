/** 사용자 모델. (담당: 공용) — 로그인/인증은 팀빌딩 담당자가 붙일 예정, 지금은 목업. */
import type { ISODateTime, UserId } from './types';

/** 한성대 단과대 (공모전 '다양한 단과대학 팀 구성 시 가산점' 항목과 맞춰둠) */
export const COLLEGES = [
  '크리에이티브인문예술대학',
  '사회과학대학',
  'IT공과대학',
  '디자인대학',
  '미래융합사회과학대학',
] as const;
export type College = (typeof COLLEGES)[number];

export type User = {
  id: UserId;
  /** 학번 뒷자리 등으로 만든 표시용 이름. 미팅 특성상 실명 노출은 최소화한다. */
  nickname: string;
  college: College;
  /** 학번 앞 4자리 = 입학년도. 미팅/밥약 필터에 씀. */
  admissionYear: number;
  /** @hansung.ac.kr 메일 인증 여부. 외부인 유입 차단이 미팅 서비스의 생명이다. */
  verified: boolean;
  /**
   * 노쇼 신뢰도 0~100. 이 숫자를 계산하고 갱신하는 건 팀빌딩(노쇼 관리) 담당 모듈이고,
   * 미팅/밥약은 읽기만 한다. 갱신 트리거는 shared/events.ts의 도메인 이벤트.
   */
  trustScore: number;
  createdAt: ISODateTime;
};

/** 신뢰도가 이 밑이면 참여 차단. 팀빌딩 쪽 정책과 같은 상수를 쓰려고 여기 둠. */
export const MIN_TRUST_TO_JOIN = 40;
