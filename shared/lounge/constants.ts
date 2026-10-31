/**
 * 라운지 상수·프리셋·표시용 순수 함수. 서버와 클라이언트가 같은 값을 쓴다.
 * (규칙을 두 군데에 적으면 반드시 어긋난다 — 한 곳에서만 정한다)
 */
import type { Gender, ReviewMark, SlotSpec } from './gathering.js';

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

/** 아바타 캐릭터 (같은 캐릭터끼리 이어서 보여 준다) */
export const AVATAR_CHARACTERS = [
  { key: 'bugi', label: '상상부기' },
  { key: 'nyangi', label: '한성냥이' },
  { key: 'sangjji', label: '상찌' },
  { key: 'kkokko', label: '꼬꼬' },
  { key: 'kkukku', label: '꾸꾸' },
] as const;
export type AvatarCharacter = (typeof AVATAR_CHARACTERS)[number]['key'];

/** 저장된 대표 키는 유지하되, 선택 이미지와 캐릭터 이름은 새 마스코트로 교체한다. */
export const AVATARS = [
  { key: 'turtle-smile', character: 'bugi', label: '상상부기', src: '/avatars/bugi.webp' },
  { key: 'cat-think', character: 'nyangi', label: '한성냥이', src: '/avatars/nyangi.webp' },
  { key: 'frog-tongue', character: 'sangjji', label: '상찌', src: '/avatars/sangjji.webp' },
  { key: 'chick-love', character: 'kkokko', label: '꼬꼬', src: '/avatars/kkokko.webp' },
  { key: 'kkukku', character: 'kkukku', label: '꾸꾸', src: '/avatars/kkukku.webp' },
] as const;
export const DEFAULT_AVATAR = AVATARS[0].key;
export type AvatarKey = (typeof AVATARS)[number]['key'];

/** 이전 표정 선택은 같은 캐릭터의 새 이미지로 표시한다. 계정 데이터는 삭제하지 않는다. */
export function normalizeAvatar(value: string | null | undefined): AvatarKey {
  const current = AVATARS.find((a) => a.key === value);
  if (current) return current.key;
  if (value === 'cat' || value?.startsWith('cat-')) return 'cat-think';
  if (value === 'frog' || value?.startsWith('frog-')) return 'frog-tongue';
  if (value?.startsWith('chick-')) return 'chick-love';
  return DEFAULT_AVATAR;
}

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
/** 성별 상관없는 미팅(N명)의 한 줄 자리 */
export const MEETUP_OPEN_SLOT = 'all';

/** N:N 은 남녀가 마주 앉고(성별 확인), N명은 성별 상관없이 누구나 앉는다 */
export type MeetupPairSize = '1:1' | '2:2' | '3:3' | '4:4';
export type MeetupOpenSize = '2명' | '3명' | '4명' | '5명' | '6명';
export type MeetupSize = MeetupPairSize | MeetupOpenSize;

/** 미팅 자리: 위(host) = 남자, 아래(guest) = 여자. 주최자는 자기 성별 쪽에 앉는다 */
const meetup = (n: number): { slots: SlotSpec[] } => ({
  slots: [
    { key: MEETUP_HOST_SLOT, label: '남자', capacity: n, gender: 'male' },
    { key: MEETUP_GUEST_SLOT, label: '여자', capacity: n, gender: 'female' },
  ],
});

/** 성별 상관없는 미팅: 자리 한 줄에 N명 */
const openMeetup = (n: number): { slots: SlotSpec[] } => ({
  slots: [{ key: MEETUP_OPEN_SLOT, label: '누구나', capacity: n }],
});

/** 성별 표시 글자 */
export const GENDER_LABEL: Record<Gender, string> = { male: '남', female: '여' };
export const GENDERS: readonly Gender[] = ['male', 'female'];

export const MEETUP_PRESETS: Record<MeetupSize, { slots: SlotSpec[] }> = {
  '1:1': meetup(1),
  '2:2': meetup(2),
  '3:3': meetup(3),
  '4:4': meetup(4),
  '2명': openMeetup(2),
  '3명': openMeetup(3),
  '4명': openMeetup(4),
  '5명': openMeetup(5),
  '6명': openMeetup(6),
};
export const MEETUP_SIZES = Object.keys(MEETUP_PRESETS) as MeetupSize[];
export const MEETUP_PAIR_SIZES: MeetupPairSize[] = ['1:1', '2:2', '3:3', '4:4'];
export const MEETUP_OPEN_SIZES: MeetupOpenSize[] = ['2명', '3명', '4명', '5명', '6명'];
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
  '성별을 속였어요',
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

// ───────────── 밥약 즉시 매칭 (택시식) ─────────────

/** 이 거리 안에 있는 대기자끼리만 이어 준다 */
export const QUICK_RADIUS_M = 1000;
/** 대기하다가 아무도 없으면 이 시간(분) 뒤에 대기가 끝난다 */
export const QUICK_WAIT_MIN = 10;
/** 즉시 매칭이 확정되면 만들어지는 밥약의 약속 시각 = 확정 시각 + 이 시간(분) */
export const QUICK_MEET_AFTER_MIN = 20;
