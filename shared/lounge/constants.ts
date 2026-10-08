/**
 * 라운지 상수·프리셋·표시용 순수 함수. 서버와 클라이언트가 같은 값을 쓴다.
 * (규칙을 두 군데에 적으면 반드시 어긋난다 — 한 곳에서만 정한다)
 */
import type { ReviewMark, SlotSpec } from './gathering.js';

// ───────────── 프로필 ─────────────

/** 한성대 단과대 */
export const COLLEGES = [
  '크리에이티브인문예술대학',
  '사회과학대학',
  'IT공과대학',
  '디자인대학',
  '미래융합사회과학대학',
] as const;
export type College = (typeof COLLEGES)[number];

/** 아바타 얼굴. 키는 DB 에 저장되고, 화면은 같은 키로 이모지를 그린다. */
export const AVATARS = [
  { key: 'bear', emoji: '🐻', label: '곰' },
  { key: 'rabbit', emoji: '🐰', label: '토끼' },
  { key: 'fox', emoji: '🦊', label: '여우' },
  { key: 'cat', emoji: '🐱', label: '고양이' },
  { key: 'dog', emoji: '🐶', label: '강아지' },
  { key: 'panda', emoji: '🐼', label: '판다' },
  { key: 'lion', emoji: '🦁', label: '사자' },
  { key: 'frog', emoji: '🐸', label: '개구리' },
  { key: 'penguin', emoji: '🐧', label: '펭귄' },
  { key: 'owl', emoji: '🦉', label: '부엉이' },
  { key: 'tiger', emoji: '🐯', label: '호랑이' },
  { key: 'koala', emoji: '🐨', label: '코알라' },
] as const;
export type AvatarKey = (typeof AVATARS)[number]['key'];

/** 아바타 색. 키 m1~m8 은 CSS 변수 --m-1 ~ --m-8 (tokens.css 의 범주 색)에 대응한다. */
export const AVATAR_COLORS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 8;
export const ADMISSION_YEAR_MIN = 2015;

/** 말풍선 이모트 (몇 초 뒤 사라진다) */
export const EMOTES = [
  { key: 'wave', emoji: '👋', label: '인사' },
  { key: 'smile', emoji: '😄', label: '웃음' },
  { key: 'thanks', emoji: '🙏', label: '감사' },
  { key: 'heart', emoji: '❤️', label: '하트' },
] as const;
export type EmoteKey = (typeof EMOTES)[number]['key'];
export const EMOTE_TTL_MS = 5000;

// ───────────── 월드 (라운지 지도) ─────────────

/** 라운지 안에서 내가 있는 구역. 서버는 값만 저장하고, 화면이 지도 위치로 해석한다. */
export const ZONES = ['plaza', 'meetup', 'meal'] as const;
export type Zone = (typeof ZONES)[number];

/** 이 시간 안에 위치가 갱신되지 않은 사람은 라운지에서 나간 것으로 본다. */
export const PRESENCE_TTL_SEC = 45;
/** 클라이언트가 위치를 폴링하는 간격 */
export const PRESENCE_POLL_MS = 3000;

// ───────────── 미팅 프리셋 ─────────────

export const MEETUP_HOST_SLOT = 'host';
export const MEETUP_GUEST_SLOT = 'guest';

export type MeetupSize = '1:1' | '2:2' | '3:3' | '4:4';

const meetup = (n: number): { slots: SlotSpec[] } => ({
  slots: [
    { key: MEETUP_HOST_SLOT, label: '우리 쪽', capacity: n },
    { key: MEETUP_GUEST_SLOT, label: '상대 쪽', capacity: n },
  ],
});

export const MEETUP_PRESETS: Record<MeetupSize, { slots: SlotSpec[] }> = {
  '1:1': meetup(1),
  '2:2': meetup(2),
  '3:3': meetup(3),
  '4:4': meetup(4),
};
export const MEETUP_SIZES = Object.keys(MEETUP_PRESETS) as MeetupSize[];
/** 미팅은 선착순이라 누르는 즉시 확정된다. */
export const MEETUP_JOIN_POLICY = 'auto' as const;

// ───────────── 밥약 프리셋 ─────────────

export const MEAL_SLOT = 'table';
export const MEAL_PRESET = (capacity: number): { slots: SlotSpec[] } => ({
  slots: [{ key: MEAL_SLOT, label: '같이 먹을 사람', capacity }],
});
/** 밥약은 주최자 승인제. */
export const MEAL_JOIN_POLICY = 'approval' as const;
export const MEAL_CAPACITY_OPTIONS = [2, 3, 4] as const;

export const PLACE_TYPES = ['학식', '학교 주변', '기타'] as const;
export type PlaceType = (typeof PLACE_TYPES)[number];

export const MENU_CATEGORIES = ['상관없음', '한식', '중식', '일식', '양식', '분식', '아시안', '카페'] as const;

/** 분위기 태그. 밥약은 "누구랑 어떻게 먹느냐"가 중요해서 태그로 미리 맞춰둔다. */
export const MEAL_TAGS = ['선후배 밥약', '동기끼리', '조용히 먹기', '수다 환영', '같은 과만', '빨리 먹고 가기'] as const;
export type MealTag = (typeof MEAL_TAGS)[number];

/** 빠른 매칭의 "가능한 시간" 구간. 분 단위로 고르면 겹치는 사람이 거의 안 나와서 구간으로 묶었다. */
export const TIME_BANDS = [
  { key: 'b11', label: '11시~12시', startMin: 11 * 60 },
  { key: 'b12', label: '12시~13시', startMin: 12 * 60 },
  { key: 'b13', label: '13시~14시', startMin: 13 * 60 },
  { key: 'b17', label: '17시~18시', startMin: 17 * 60 },
  { key: 'b18', label: '18시~19시', startMin: 18 * 60 },
  { key: 'b19', label: '19시~20시', startMin: 19 * 60 },
] as const;
export type TimeBandKey = (typeof TIME_BANDS)[number]['key'];
export const timeBand = (key: string) => TIME_BANDS.find((b) => b.key === key);
export const BAND_KEYS: string[] = TIME_BANDS.map((b) => b.key);

/** 빠른 매칭 후보 방이 유지되는 시간(분). 이 안에 전원이 수락하지 않으면 깨진다. */
export const QUICK_ROOM_TTL_MIN = 30;

// ───────────── 평판 (매너온도) ─────────────

export const REVIEW_LABEL: Record<ReviewMark, string> = {
  good: '좋았어요',
  soso: '보통이에요',
  noshow: '안 왔어요',
};

export const DEFAULT_TEMPERATURE = 36.5;
export const MIN_TEMPERATURE = 0;
export const MAX_TEMPERATURE = 99;
/** 좋았어요 한 번에 오르는 온도 */
export const GOOD_DELTA = 0.4;
/** 노쇼 확정 시 떨어지는 온도 */
export const NOSHOW_DELTA = -5;
/** 이 횟수만큼 노쇼가 확정되면 이용 정지 */
export const WARNINGS_TO_BAN = 2;
/**
 * 노쇼 경고가 아닌 이유로 이용이 정지됐을 때의 안내. 신고 누적 자동 제한과 관리자 직접 정지는 둘 다 `warnings < WARNINGS_TO_BAN`
 * 이고 정지 사유를 따로 저장하지 않아 서로 가릴 수 없다 — 그래서 어느 쪽에도 맞는 문장만 쓴다 ("신고 누적" 으로 단정하지 않는다).
 */
export const BAN_NOTICE_GENERIC = '이용이 정지됐어요. 신고가 쌓였거나 관리자가 정지한 경우예요. 관리자 확인 후 풀립니다.';

/** 화면 표시용: 온도에 따른 얼굴과 단계. 색만이 아니라 글자(label)와 함께 보여 준다. */
export function temperatureFace(temperature: number): {
  emoji: string;
  tone: 'danger' | 'neutral' | 'primary' | 'success';
  label: string;
} {
  if (temperature < 30) return { emoji: '😰', tone: 'danger', label: '낮음' };
  if (temperature < 36.5) return { emoji: '😐', tone: 'neutral', label: '보통 이하' };
  if (temperature < 42) return { emoji: '🙂', tone: 'primary', label: '좋음' };
  return { emoji: '😄', tone: 'success', label: '매우 좋음' };
}

// ───────────── 안전 (차단·신고) ─────────────

export const REPORT_REASONS = [
  '약속 불이행(노쇼)',
  '불쾌한 언행 · 성희롱',
  '허위 정보 · 사칭',
  '외부 홍보 · 영업',
  '기타',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export type ReportStatus = 'open' | 'resolved' | 'dismissed';

/** 서로 다른 신고자가 이 수를 넘기면 관리자가 처리할 때까지 자동 제한 */
export const AUTO_RESTRICT_REPORTS = 3;
export const REPORT_DETAIL_MAX = 500;

// ───────────── 단톡방 ─────────────

export const MAX_MESSAGE_LENGTH = 500;
export const CHAT_POLL_MS = 3000;
export const SYSTEM_OPEN_MESSAGE = '자리가 다 찼어요! 여기서 만날 시간과 장소를 정해 보세요. 연락처는 공개되지 않아요.';
