/**
 * Gathering — 미팅 / 밥약 / 팀빌딩을 하나로 묶은 도메인 모델 (타입만).
 *
 * 셋 다 "글을 올리고, 정원이 있고, 사람이 들어온다"로 같다. 다른 건 두 가지뿐이라 필드로 뺐다.
 *   1) joinPolicy — 선착순 자동(미팅) vs 주최자 승인(밥약/팀빌딩)
 *   2) slots      — 자리 구성. 미팅은 [우리 쪽 N, 상대 쪽 N], 밥약은 [같이 먹을 사람 N]
 * 그래서 화면과 프리셋만 다르고 참여/취소/노쇼 로직은 한 벌만 존재한다.
 * 규칙(함수)은 서버 `server/lounge/domain/gathering.ts` 에 있다.
 */
import type { GatheringId, ISODateTime, UserId } from './types.js';

export type GatheringKind = 'meetup' | 'meal' | 'team';

/** auto = 누르면 바로 확정(선착순) / approval = 신청 후 주최자가 승인 */
export type JoinPolicy = 'auto' | 'approval';

export type GatheringStatus = 'open' | 'full' | 'cancelled' | 'done';

/** 저장 상태 + 시간으로만 계산되는 'closed'를 합친 화면용 상태 */
export type GatheringStatusView = 'open' | 'full' | 'closed' | 'cancelled' | 'done';

/** 모임이 끝난 뒤 서로에게 남기는 평가 */
export type ReviewMark = 'good' | 'soso' | 'noshow';

/**
 * 자리. 미팅에서 개인이 아무렇게나 선착순으로 붙으면 2:2 구성이 깨지므로
 * "빈 의자에 앉는다"는 개념을 둬서 팀 구성을 강제한다.
 */
export type Slot = {
  key: string;
  label: string;
  capacity: number;
  memberIds: UserId[];
};

/** approval 정책에서 승인 대기 중인 신청자. 대기 중엔 자리를 차지하지 않는다. */
export type Applicant = {
  userId: UserId;
  slotKey: string;
  message: string;
  appliedAt: ISODateTime;
};

/** 모임 후 참여자끼리 남기는 평가. 노쇼는 나머지 전원이 '안 왔어요'를 눌러야 확정된다. */
export type Review = {
  by: UserId;
  target: UserId;
  mark: ReviewMark;
  at: ISODateTime;
};

/** 기능별 부가 정보. 도메인 규칙(정원·마감·평가)은 이 값을 보지 않는다 — 화면과 필터에서만 쓴다. */
export type GatheringMeta = {
  /** 밥약: 학식 / 학교 주변 / 기타 */
  placeType?: string;
  /** 밥약: 메뉴 카테고리 */
  menu?: string;
  /** 태그 (예: 선후배 밥약, 조용히 먹기, 2:2) */
  tags?: string[];
  /** 미팅: 같은 학과 사람은 못 들어오게 (아는 사람 만나는 걸 막는 안전장치) */
  excludeSameDept?: boolean;
};

export type Gathering = {
  id: GatheringId;
  kind: GatheringKind;
  hostId: UserId;
  title: string;
  body: string;
  place: string;
  /** 실제로 만나는 시각 */
  meetAt: ISODateTime;
  /** 신청 마감. 보통 meetAt 보다 앞. 노쇼를 줄이려고 취소도 이 시각까지만 허용한다. */
  joinDeadline: ISODateTime;
  joinPolicy: JoinPolicy;
  slots: Slot[];
  applicants: Applicant[];
  status: GatheringStatus;
  reviews: Review[];
  meta: GatheringMeta;
  createdAt: ISODateTime;
};

export type SlotSpec = { key: string; label: string; capacity: number };

/** `POST /api/lounge/gatherings` 요청 본문 (hostId·id 는 서버가 채운다) */
export type CreateGatheringBody = {
  kind: GatheringKind;
  title: string;
  body: string;
  place: string;
  meetAt: ISODateTime;
  joinDeadline: ISODateTime;
  joinPolicy: JoinPolicy;
  slots: SlotSpec[];
  /** 주최자가 앉을 자리. 생략하면 첫 번째 자리. */
  hostSlotKey?: string;
  meta?: GatheringMeta;
};
