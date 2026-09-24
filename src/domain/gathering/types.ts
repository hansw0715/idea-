/**
 * Gathering — 미팅 / 밥약 / 팀빌딩을 하나로 묶은 도메인 모델. (담당: 한승원)
 *
 * 셋 다 "누가 글을 올리고, 정원이 있고, 사람들이 들어온다"로 같다.
 * 다른 건 두 가지뿐이라 필드로 뺐다.
 *   1) joinPolicy — 선착순 자동(미팅) vs 주최자 승인(밥약/팀빌딩)
 *   2) slots      — 자리 구성. 미팅은 [우리팀 2, 상대팀 2], 밥약은 [참여자 4]
 * 그래서 화면과 프리셋만 다르고 참여/취소/노쇼 로직은 한 벌만 존재한다.
 */
import type { ReviewMark } from '@/domain/reputation/reputation';
import type { GatheringId, ISODateTime, UserId } from '@/shared/types';

export type { ReviewMark };

export type GatheringKind = 'meetup' | 'meal' | 'team';

/** auto = 누르면 바로 확정(선착순) / approval = 신청 후 주최자가 승인 */
export type JoinPolicy = 'auto' | 'approval';

export type GatheringStatus = 'open' | 'full' | 'cancelled' | 'done';

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

/**
 * 모임이 끝난 뒤 참여자끼리 남기는 평가. 주최자 혼자가 아니라 같이 만난 사람 모두가 남긴다.
 * 노쇼는 나머지 전원이 '안 왔어요'를 눌러야 확정된다 — 한 명의 오해로 경고가 찍히면 안 되니까.
 */
export type Review = {
  by: UserId;
  target: UserId;
  mark: ReviewMark;
  at: ISODateTime;
};

/**
 * 기능별 부가 정보. 밥약은 장소 종류·메뉴·태그를 쓰고, 미팅/팀빌딩은 자기 필드를 넣는다.
 * 도메인 규칙(정원, 마감, 평가)은 이 값을 보지 않는다 — 화면과 필터에서만 쓴다.
 */
export type GatheringMeta = {
  /** 밥약: 학식 / 학교 주변 / 기타 */
  placeType?: string;
  /** 밥약: 메뉴 카테고리 */
  menu?: string;
  /** 태그 (예: 선후배 밥약, 조용히 먹기) */
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
  /** 모임 후 참여자끼리 남긴 평가. 여기서 노쇼가 확정되면 경고 이벤트가 나간다. */
  reviews: Review[];
  meta: GatheringMeta;
  createdAt: ISODateTime;
};

export type SlotSpec = { key: string; label: string; capacity: number };

export type CreateGatheringInput = {
  id: GatheringId;
  kind: GatheringKind;
  hostId: UserId;
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
