/** 사용자 모델. (담당: 공용) — 로그인/인증은 팀빌딩 담당자가 붙일 예정, 지금은 목업. */
import type { ReputationState } from '@/domain/reputation/reputation';
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
  /** 학과. '같은 과만'(밥약) / '같은 학과 제외'(미팅) 조건에 쓴다. 화면에는 단과대까지만 노출한다. */
  department: string;
  /** 학번 앞 4자리 = 입학년도. 미팅/밥약 필터에 씀. */
  admissionYear: number;
  /** @hansung.ac.kr 메일 인증 여부. 외부인 유입 차단이 미팅 서비스의 생명이다. */
  verified: boolean;
  /** 매너온도 36.5 시작. 계산 규칙은 domain/reputation. */
  temperature: number;
  /** 확정된 노쇼 횟수 */
  warnings: number;
  /** 경고가 쌓여 이용이 정지된 상태 */
  banned: boolean;
  /** 관리자 대시보드(신고 처리, 버스 데이터 편집) 접근 권한. 없으면 일반 사용자. */
  role?: 'user' | 'admin';
  createdAt: ISODateTime;
};

export const isAdmin = (u: User | null): boolean => u?.role === 'admin';

/** User가 평판 필드를 그대로 갖고 있어서, 평판 함수에 사용자를 그대로 넘길 수 있다. */
export type UserReputation = ReputationState;
