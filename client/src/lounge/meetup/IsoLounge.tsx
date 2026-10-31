import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, Ref } from 'react';
import { AVATARS, normalizeAvatar } from '../../../../shared/lounge';
import type { GatheringView, PublicUser } from '../../../../shared/lounge';
import { KIND_LABEL, STATUS_BADGE, relationBadge, seatCount, shortMeetAt } from '../parts/GatheringListItem';
import {
  BigTable,
  SquareTable,
  CafePair,
  Bookshelf,
  Box,
  CafeCounter,
  Face,
  FloorLamp,
  LoungeSet,
  Plant,
  SOFA_SEAT_Z,
  WallArt,
  SofaBooth,
  WindowDesks,
  Windows,
  loungeRug,
  sofaInner,
  sofaSeatY,
} from './furniture';
import { iso, isoRect, pts, ISO_C } from './iso';

/* 방 치수 (바닥 평면 단위 = 화면 1px)
   뒤 벽 쪽: 창가 바 / 왼쪽 벽 쪽: 전광판·책장·책상 / 가운데: 모임 탁자 칸 / 오른쪽: 카페·소파 / 앞쪽: 소파 라운지
   방 밖으로도 바닥이 이어지고 꾸밈 가구가 놓여, 어디를 봐도 빈 곳이 없다. */
const SLOT_X = 240; // 탁자 한 개가 차지하는 바닥 칸 (탁자 긴 쪽 방향)
const SLOT_Y = 210; // (탁자 짧은 쪽 방향)
const BACK = 140; // 뒤 벽 ~ 첫 탁자 칸: 창가 바 자리
const SIDE = 120; // 왼쪽 벽 ~ 첫 탁자 칸: 책장 자리
const RIGHT = 290; // 마지막 열 오른쪽: 카페 카운터와 소파
const FRONT = 300; // 마지막 줄 앞: 소파 라운지
const WALL_H = 170; // 창문·간판을 맞추는 높이
const WALL_T = 10;
const SLAB = 26; // 떠 있는 바닥 판의 두께 (방의 경계가 또렷이 보이게)
const EDGE = 60; // 방 둘레로 더 둘러볼 수 있는 여유 (화면 px)
const MAX_ZOOM = 2.5;

const TABLE_D = 56;
const PITCH = 38; // 자리 간격
const STOOL = 24;
const STOOL_H = 16;
const TOP_Z = 24;
const TOP_T = 8;
const HEAD_R = 21; // 앉은·서 있는 사람 얼굴 반지름
const SOFA_W = 170;

const avatarSrc = (key: string) => AVATARS.find((a) => a.key === normalizeAvatar(key))?.src ?? AVATARS[0].src;

/** 한 자리: 위치와 앉는 높이, 앉은 사람(없으면 빈자리) */
/** 한 자리: 위치와 앉는 높이, 앉은 사람(없으면 빈자리) */
type Seat = { x: number; y: number; z: number; member: PublicUser | undefined; slotKey: string };

/**
 * 모임 자리. kind 마다 놓이는 구역과 가구가 다르다:
 *  - long   : 미팅 — 맨 아래 긴 탁자 (의자 대신 둥근 등받이 없는 자리가 마주 본다)
 *  - square : 밥약(3~4명) — 가운데 4인 탁자
 *  - booth  : 밥약(2명) — 가운데 작은 소파 자리
 */
type Table = {
  kind: 'long' | 'square' | 'booth';
  g: GatheringView;
  cx: number;
  cy: number;
  len: number;
  back: Seat[];
  front: Seat[];
};

type Row = { members: PublicUser[]; cap: number; key: string };

/** 미팅은 두 줄(남·여)이 마주 앉는다. 두 줄이 아니면(밥약·N명 미팅) 정원을 반씩 나눈다. */
function seatRows(g: GatheringView): [Row, Row] {
  if (g.slots.length === 2) {
    const [a, b] = g.slots;
    return [
      { members: a.members, cap: a.capacity, key: a.key },
      { members: b.members, cap: b.capacity, key: b.key },
    ];
  }
  const key = g.slots[0]?.key ?? '';
  const { capacity } = seatCount(g);
  const members = g.slots.flatMap((s) => s.members);
  const back = Math.ceil(capacity / 2);
  return [
    { members: members.slice(0, back), cap: back, key },
    { members: members.slice(back), cap: capacity - back, key },
  ];
}

/** 미팅: 긴 탁자에 정원만큼 자리가 마주 본다 */
function layoutLong(g: GatheringView, cx: number, cy: number): Table {
  const [b, f] = seatRows(g);
  const n = Math.max(1, b.cap, f.cap);
  const len = n * PITCH + 20;
  const row = (r: Row, y: number): Seat[] =>
    Array.from({ length: r.cap }, (_, i) => ({ x: cx - (r.cap * PITCH) / 2 + PITCH / 2 + i * PITCH, y, z: STOOL_H, member: r.members[i], slotKey: r.key }));
  return { kind: 'long', g, cx, cy, len, back: row(b, cy - TABLE_D / 2 - 20), front: row(f, cy + TABLE_D / 2 + 20) };
}

/** 4인 탁자 의자 자리 (뒤·왼쪽이 먼저, 오른쪽·앞이 나중) */
const SQUARE_SEATS = [
  [0, -46],
  [-46, 0],
  [46, 0],
  [0, 46],
] as const;
const CHAIR_Z = 24;

/** 밥약(3~4명): 4인 탁자의 의자에 정원만큼 앉는다 */
function layoutSquare(g: GatheringView, cx: number, cy: number): Table {
  const key = g.slots[0]?.key ?? '';
  const members = g.slots.flatMap((s) => s.members);
  const cap = Math.min(4, seatCount(g).capacity);
  const seats: Seat[] = SQUARE_SEATS.slice(0, cap).map(([dx, dy], i) => ({ x: cx + dx, y: cy + dy, z: CHAIR_Z, member: members[i], slotKey: key }));
  return { kind: 'square', g, cx, cy, len: 60, back: seats.slice(0, 2), front: seats.slice(2) };
}

/** 밥약(2명): 작은 소파 자리에 마주 앉는다 */
function layoutBooth(g: GatheringView, cx: number, cy: number): Table {
  const key = g.slots[0]?.key ?? '';
  const members = g.slots.flatMap((s) => s.members);
  return {
    kind: 'booth',
    g,
    cx,
    cy,
    len: 64,
    back: [{ x: cx, y: cy - 30, z: SOFA_SEAT_Z + 4, member: members[0], slotKey: key }],
    front: [{ x: cx, y: cy + 30, z: SOFA_SEAT_Z + 4, member: members[1], slotKey: key }],
  };
}

/** 앉은 사람의 얼굴 (자기 색 테두리, 나는 파란 테두리) */
function Face3({ x, y, z, m, mineId, i }: { x: number; y: number; z: number; m: PublicUser; mineId: string; i: number }) {
  const base = iso(x, y, z);
  return (
    <g
      className={`iso-av${m.id === mineId ? ' is-me' : ''}`}
      style={{ '--av': `var(--m-${m.avatarColor.replace('m', '')})`, animationDelay: `${(i % 5) * -0.7}s` } as CSSProperties}
    >
      <circle cx={base.x} cy={base.y - HEAD_R - 2} r={HEAD_R + 3} className="iso-av__ring" />
      <image
        href={avatarSrc(m.avatar)}
        x={base.x - HEAD_R}
        y={base.y - HEAD_R * 2 - 2}
        width={HEAD_R * 2}
        height={HEAD_R * 2}
        clipPath="url(#iso-head)"
        preserveAspectRatio="xMidYMid slice"
      />
    </g>
  );
}

/**
 * 한 자리: 긴 탁자는 자리(낮은 상자)를 그리고, 의자·소파 자리는 가구가 이미 있으니 빈자리 표시만 얹는다.
 * 앉은 사람은 그 위에 얼굴로 떠 있다. 빈자리를 누르면 그 자리에 앉는 창이 열린다 (onSeat).
 */
function SeatArt({ s, i, mineId, stool, onSeat }: { s: Seat; i: number; mineId: string; stool: boolean; onSeat?: (slotKey: string) => void }) {
  const m = s.member;
  const tone = m ? 'iso-stool is-taken' : 'iso-stool';
  const pick =
    !m && onSeat
      ? (e: ReactMouseEvent) => {
          e.stopPropagation();
          onSeat(s.slotKey);
        }
      : undefined;
  return (
    <g className={pick ? 'iso-seat-free' : undefined} onClick={pick}>
      {stool ? (
        <Box x={s.x - STOOL / 2} y={s.y - STOOL / 2} w={STOOL} d={STOOL} h={STOOL_H} tone={tone} />
      ) : (
        <Box x={s.x - 10} y={s.y - 10} w={20} d={20} h={2} z={s.z} tone={tone} />
      )}
    </g>
  );
}

function TableArt({ t, mineId, onOpen }: { t: Table; mineId: string; onOpen: (slotKey?: string) => void }) {
  const closed = t.g.status !== 'open';
  const mine = !!relationBadge(t.g);
  // 모집 중이고 아직 안 앉은 모임만 빈자리를 바로 고를 수 있다
  const onSeat = !closed && !mine ? (key: string) => onOpen(key) : undefined;
  const cls = `iso-table${t.g.kind === 'meal' ? ' is-meal' : ''}${closed ? ' is-closed' : ''}${mine ? ' is-mine' : ''}`;
  const seats = (list: Seat[], offset: number) =>
    list.map((s, i) => <SeatArt key={`${offset}-${i}`} s={s} i={i + offset} mineId={mineId} stool={t.kind === 'long'} onSeat={onSeat} />);
  if (t.kind === 'square' || t.kind === 'booth') {
    // 가구를 먼저 그리고, 자리 표시와 얼굴은 위에 얹는다 (얼굴이 탁자에 가리지 않게)
    return (
      <g className={cls} onClick={() => onOpen()} aria-hidden="true">
        {t.kind === 'square' ? <SquareTable cx={t.cx} cy={t.cy} /> : <SofaBooth cx={t.cx} cy={t.cy} />}
        {seats(t.back, 0)}
        {seats(t.front, 2)}
      </g>
    );
  }
  const x0 = t.cx - t.len / 2;
  const y0 = t.cy - TABLE_D / 2;
  return (
    <g className={cls} onClick={() => onOpen()} aria-hidden="true">
      <g className="iso-table__lift">
        {seats(t.back, 0)}
        <Box x={x0 + 14} y={t.cy - 14} w={t.len - 28} d={28} h={TOP_Z} tone="iso-leg" />
        <Box x={x0} y={y0} w={t.len} d={TABLE_D} h={TOP_T} z={TOP_Z} tone="iso-top" />
        {seats(t.front, 3)}
      </g>
    </g>
  );
}

/** 아직 아무도 쓰지 않는 미팅 탁자 (3:3 자리) */
function EmptyLongTable({ cx, cy }: { cx: number; cy: number }) {
  const len = 3 * PITCH + 20;
  const xs = [-PITCH, 0, PITCH];
  return (
    <g aria-hidden="true">
      {xs.map((dx) => (
        <Box key={`b${dx}`} x={cx + dx - STOOL / 2} y={cy - TABLE_D / 2 - 20 - STOOL / 2} w={STOOL} d={STOOL} h={STOOL_H} tone="iso-stool" />
      ))}
      <Box x={cx - len / 2 + 14} y={cy - 14} w={len - 28} d={28} h={TOP_Z} tone="iso-leg" />
      <Box x={cx - len / 2} y={cy - TABLE_D / 2} w={len} d={TABLE_D} h={TOP_T} z={TOP_Z} tone="iso-top" />
      {xs.map((dx) => (
        <Box key={`f${dx}`} x={cx + dx - STOOL / 2} y={cy + TABLE_D / 2 + 20 - STOOL / 2} w={STOOL} d={STOOL} h={STOOL_H} tone="iso-stool" />
      ))}
    </g>
  );
}

/** 회의 참여자: 라운지 프로필이 없으니 이름 첫 글자를 자기 색 동그라미에 */
function InitialToken({ x, y, z, name, n }: { x: number; y: number; z: number; name: string; n: number }) {
  const b = iso(x, y, z);
  const cy = b.y - HEAD_R - 2;
  return (
    <g className="iso-initial" style={{ '--av': `var(--m-${(n % 8) + 1})` } as CSSProperties}>
      <title>{name}</title>
      <circle cx={b.x} cy={cy} r={HEAD_R + 1} className="iso-initial__disc" />
      <text x={b.x} y={cy + 6.5} textAnchor="middle" className="iso-initial__text">
        {name.trim().slice(0, 1) || '?'}
      </text>
    </g>
  );
}

/** 라운지에 들어와 있는 사람 (방 바닥에 서 있다) */
export type LoungePerson = Pick<PublicUser, 'id' | 'nickname' | 'avatar' | 'avatarColor'> & {
  /** 밥약을 찾는 중이면 머리 위에 작은 말풍선을 띄운다 */
  seeking?: boolean;
};

const NO_PEOPLE: LoungePerson[] = [];

/** 사람마다 늘 같은 자리를 고르도록 id 로 만든 수 */
const hashId = (id: string) => {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** 서 있는 사람: 발밑 그림자, 자기 색 몸통, 동그란 얼굴. 나는 파란 테두리. */
function StandingPerson({ x, y, p, me, i }: { x: number; y: number; p: LoungePerson; me: boolean; i: number }) {
  const b = iso(x, y, 0);
  const color = `var(--m-${p.avatarColor.replace('m', '')})`;
  return (
    <g className={`iso-person${me ? ' is-me' : ''}`} style={{ '--av': color } as CSSProperties}>
      <title>{me ? `${p.nickname} (나)` : p.nickname}</title>
      <ellipse cx={b.x} cy={b.y} rx={14} ry={6} className="iso-person__shadow" />
      <g className="iso-av" style={{ animationDelay: `${(i % 6) * -0.6}s` } as CSSProperties}>
        <rect x={b.x - 10} y={b.y - 26} width={20} height={26} rx={10} className="iso-person__body" />
        <circle cx={b.x} cy={b.y - 26 - HEAD_R + 2} r={HEAD_R + 3} className="iso-av__ring" />
        <image
          href={avatarSrc(p.avatar)}
          x={b.x - HEAD_R}
          y={b.y - 26 - HEAD_R * 2 + 2}
          width={HEAD_R * 2}
          height={HEAD_R * 2}
          clipPath="url(#iso-head)"
          preserveAspectRatio="xMidYMid slice"
        />
      </g>
      {p.seeking && <SeekBubble x={b.x} y={b.y - 26 - HEAD_R * 2 - 8} />}
    </g>
  );
}

/** 밥약 찾는 중: 머리 위 아주 작은 말풍선 */
function SeekBubble({ x, y }: { x: number; y: number }) {
  // 회의·모임 이름표와 같은 글자 크기 (이름표 12px ÷ 휴대폰 배율 0.76 ≈ 16)
  const w = 150;
  const h = 28;
  return (
    <g className="iso-seek" aria-hidden="true">
      <rect x={x - w / 2} y={y - h} width={w} height={h} rx={8} className="iso-seek__box" />
      <path d={`M${x - 6} ${y - 0.5} l6 6.5 l6 -6.5 z`} className="iso-seek__box" />
      <text x={x} y={y - 8.6} textAnchor="middle" className="iso-seek__text">
        같이 밥 먹을 사람!
      </text>
    </g>
  );
}

/** 탁자는 늘 두 줄: 컴퓨터·태블릿에서도 휴대폰과 같은 방을 보여 준다 */
const COLS = 2;
/** 기본 배율: 휴대폰에서 보던 가구 크기 그대로 (큰 화면이라고 키우지 않는다) */
const PHONE_SCALE = 0.76;

/**
 * 라운지의 아이소메트릭 방. 모임마다 자리(긴 탁자 또는 소파 라운지)가 하나 놓이고, 정원만큼 자리가 마주 보고,
 * 앉은 사람은 자리 위에 얼굴로 떠 있다. 손가락으로 밀어 둘러보고, 벌리고 오므려 확대·축소한다.
 * 방(조금의 여유 포함) 밖으로는 밀려 나가지 않고, 가장 작게 줄이면 방 전체가 한 화면에 들어온다.
 */
/** 내 팀 회의: 큰 회의 탁자로 놓이고 이름표를 누르면 그 회의 화면으로 간다 */
export type LoungeMeeting = { id: number; name: string; memberCount?: number; members?: { id: number; name: string; user?: PublicUser }[] };
const NO_MEETINGS: LoungeMeeting[] = [];

/** 바깥에서 방의 시점을 옮길 때 쓴다 */
export type IsoLoungeHandle = {
  /** 방 전체가 한눈에 들어오게 줄인다 */
  showAll: () => void;
  /** 그 모임 자리를 가운데에 두고 확대한다 */
  focusOn: (gatheringId: string) => void;
};

/** 내 자리를 처음 보여 줄 때의 확대 배율 */
const FOCUS_ZOOM = 1.35;
/** 라운지 탭에 들어왔을 때의 배율: 조금 줄인 상태로 시작한다 */
const START_ZOOM = 0.7;

export default function IsoLounge({
  gatherings,
  mineId,
  onOpen,
  children,
  full = false,
  fill = false,
  focusId = null,
  people = NO_PEOPLE,
  meId = '',
  meetings = NO_MEETINGS,
  onOpenMeeting,
  ref,
}: {
  gatherings: GatheringView[];
  mineId: string;
  /** 모임 자리를 눌렀다. 빈자리를 눌렀으면 그 자리 키가 함께 온다 */
  onOpen: (g: GatheringView, slotKey?: string) => void;
  /** 방 위에 떠 있는 조작 (나가기·만들기 등) */
  children?: ReactNode;
  /** 화면 전체를 쓴다 (가장자리에 아주 조금만 남긴다) */
  full?: boolean;
  /** 부모 상자를 꽉 채운다 (개인 화면의 가운데 방) */
  fill?: boolean;
  /** 처음에 이 모임 자리(내 자리)를 가운데에 두고 확대해서 보여 준다 */
  focusId?: string | null;
  /** 지금 라운지에 들어와 있는 사람들 (나 포함). 방의 빈 바닥 곳곳에 서 있다 */
  people?: LoungePerson[];
  /** 내 id (서 있는 사람 중 나를 표시) */
  meId?: string;
  /** 내 팀 회의 (탁자 칸에 회의 탁자로 놓인다) */
  meetings?: LoungeMeeting[];
  onOpenMeeting?: (id: number) => void;
  ref?: Ref<IsoLoungeHandle>;
}) {
  const cols = COLS;

  const scene = useMemo(() => {
    const w = SIDE + cols * SLOT_X + RIGHT;
    // 세로 줄: 탁자 칸 가운데들 + 오른쪽 구역 가운데. 가운데 밥약 자리와 맨 아래 미팅 탁자도 이 줄에 맞춘다
    const colXs = [...Array.from({ length: cols }, (_, c) => SIDE + c * SLOT_X + SLOT_X / 2), w - RIGHT / 2];
    const midXs = colXs.slice(0, -1).map((x, i) => (x + colXs[i + 1]) / 2);

    // 모임 종류마다 구역: 회의는 위 탁자 칸, 밥약은 가운데, 미팅은 맨 아래
    const meetups = gatherings.filter((g) => g.kind === 'meetup');
    const meals = gatherings.filter((g) => g.kind !== 'meetup');
    const mealBooths = meals.filter((g) => seatCount(g).capacity <= 2);
    const mealSquares = meals.filter((g) => seatCount(g).capacity > 2);

    const meetingRows = Math.max(2, Math.ceil(meetings.length / cols));
    const mealRows = Math.max(2, Math.ceil(mealSquares.length / colXs.length), Math.ceil(mealBooths.length / Math.max(1, midXs.length)));
    const meetupRows = Math.max(1, Math.ceil(meetups.length / colXs.length));
    const MEAL_ROW = 230; // 밥약 줄 간격 (작은 2인 자리끼리 넉넉히 떨어지게)
    const midTop = BACK + meetingRows * SLOT_Y;
    const MID = mealRows * MEAL_ROW + 20;
    const frontTop = midTop + MID;
    const FRONT_H = meetupRows * SLOT_Y + 70;
    const d = frontTop + FRONT_H;
    const fx = w / 2;
    const fy = midTop + MID / 2;
    const mealY = (r: number) => midTop + 10 + MEAL_ROW / 2 + r * MEAL_ROW;
    const meetupY = (r: number) => frontTop + 30 + SLOT_Y / 2 + r * SLOT_Y;

    const tables: Table[] = [];
    const props: { key: string; depth: number; node: ReactNode }[] = [];
    const rugs: { key: string; points: ReturnType<typeof isoRect>; tone: string }[] = [];
    const put = (key: string, depth: number, node: ReactNode) => props.push({ key, depth, node });
    const sofaDecor = (key: string, cx: number, cy: number) => {
      rugs.push({ key, points: loungeRug(cx, cy, SOFA_W), tone: 'iso-rug-lounge' });
      put(key, cx + cy, <LoungeSet key={key} cx={cx} cy={cy} w={SOFA_W} />);
    };

    // ① 회의: 위 탁자 칸에 큰 탁자 줄과 큰 소파 줄을 번갈아. 빈 칸도 같은 가구로 채워 구역이 보이게
    const meetingSpots: { m: LoungeMeeting; cx: number; cy: number; sofa: boolean }[] = [];
    const meetingSeats: { m: LoungeMeeting; seats: { x: number; y: number; z: number }[] }[] = [];
    for (let i = 0; i < meetingRows * cols; i++) {
      const cx = SIDE + (i % cols) * SLOT_X + SLOT_X / 2;
      const cy = BACK + Math.floor(i / cols) * SLOT_Y + SLOT_Y / 2;
      // 같은 줄은 같은 가구: 큰 탁자 줄과 큰 소파 줄을 번갈아
      const sofa = Math.floor(i / cols) % 2 === 1;
      const m = meetings[i];
      if (sofa) sofaDecor(`cell-${i}`, cx, cy);
      else {
        // 큰 탁자 밑에는 회의가 없어도 같은 매트를 깐다 (줄이 가지런해 보이게)
        rugs.push({ key: `cell-${i}`, points: isoRect(cx - 100, cy - 70, 200, 140), tone: 'iso-rug' });
        put(`cell-${i}`, cx + cy, <BigTable key={`cell-${i}`} cx={cx} cy={cy} />);
      }
      if (m) {
        meetingSpots.push({ m, cx, cy, sofa });
        // 회의 참여자: 자리마다 이름 첫 글자 (큰 탁자는 의자, 큰 소파는 방석 위)
        const inner = sofaInner(SOFA_W);
        const ys = sofaSeatY(cy);
        const seats = sofa
          ? [0, 1, 2, 0, 1, 2].map((k, j) => ({ x: cx - inner / 2 + (inner * (k + 0.5)) / 3, y: j < 3 ? ys.back : ys.front, z: SOFA_SEAT_Z + 4 }))
          : [-45, 0, 45, -45, 0, 45].map((dx, j) => ({ x: cx + dx, y: j < 3 ? cy - 47 : cy + 47, z: CHAIR_Z }));
        meetingSeats.push({ m, seats });
      }
    }
    // 오른쪽 구역: 카페 앞 소파 한 벌, 그 아래 카페 테이블, 조명
    sofaDecor('right', w - RIGHT / 2, BACK + 230);
    for (let y = BACK + 470, i = 0; y < midTop - 40; y += 230, i++) put(`right-${i}`, w - RIGHT / 2 + y, <CafePair key={`right-${i}`} cx={w - RIGHT / 2} cy={y} />);
    put('lamp-r', w - 40 + BACK + 120, <FloorLamp key="lamp-r" x={w - 36} y={BACK + 120} />);
    // 두 책장 사이 조명: 벽에서 조금 앞으로 나와 선다
    put('lamp-shelf', 64 + BACK + 500, <FloorLamp key="lamp-shelf" x={64} y={BACK + 500} />);

    // ② 밥약: 가운데 띠에 4인 탁자(세로 줄)와 작은 소파 자리(줄 사이)를 줄 맞춰
    let sq = 0;
    let bo = 0;
    for (let r = 0; r < mealRows; r++) {
      const y = mealY(r);
      for (const x of colXs) {
        const g = mealSquares[sq++];
        if (g) tables.push(layoutSquare(g, x, y));
        else put(`quad-${x}-${y}`, x + y, <SquareTable key={`quad-${x}-${y}`} cx={x} cy={y} />);
      }
      for (const x of midXs) {
        const g = mealBooths[bo++];
        if (g) tables.push(layoutBooth(g, x, y));
        else put(`booth-${x}-${y}`, x + y, <SofaBooth key={`booth-${x}-${y}`} cx={x} cy={y} />);
      }
    }

    // ③ 미팅: 맨 아래 긴 탁자. 빈 자리에도 탁자를 놓아 둔다
    for (let r = 0; r < meetupRows; r++) {
      colXs.forEach((x, c) => {
        const g = meetups[r * colXs.length + c];
        const y = meetupY(r);
        if (g) {
          tables.push(layoutLong(g, x, y));
          rugs.push({ key: `rug-${g.id}`, points: isoRect(x - 90, y - TABLE_D / 2 - 44, 180, TABLE_D + 88), tone: `iso-rug${g.status === 'open' ? '' : ' is-closed'}` });
        } else {
          // 빈 미팅 탁자 밑에도 같은 매트
          rugs.push({ key: `long-${x}-${y}`, points: isoRect(x - 90, y - TABLE_D / 2 - 44, 180, TABLE_D + 88), tone: 'iso-rug' });
          put(`long-${x}-${y}`, x + y, <EmptyLongTable key={`long-${x}-${y}`} cx={x} cy={y} />);
        }
      });
    }

    for (const [x, y, tall] of [
      [26, BACK + 10, true],
      [26, d - 40, false],
      [w - 30, d - 40, true],
    ] as const) {
      put(`plant-${x}-${y}`, x + y, <Plant key={`plant-${x}-${y}`} x={x} y={y} tall={tall} />);
    }
    for (const t of tables) put(t.g.id, t.cx + t.cy, null);

    // 모임을 여러 개 하면 그 자리마다 다 앉아 있다. 어딘가 앉은 사람은 서 있는 얼굴로는 따로 두지 않는다.
    const shown = new Set<string>();
    for (const t of tables) for (const seat of [...t.back, ...t.front]) if (seat.member) shown.add(seat.member.id);

    // 앉은 사람 얼굴은 가구를 다 그린 뒤 맨 위 층에 따로 그린다 → 의자·탁자에 가리지 않고 자리에 앉은 것처럼 보인다
    const faces: { depth: number; node: ReactNode }[] = [];
    // 회의 참여자: 라운지 프로필이 있으면 그 얼굴, 없으면 이름 첫 글자
    for (const { m, seats } of meetingSeats) {
      const members = (m.members ?? []).slice(0, seats.length);
      members.forEach((mem) => shown.add(String(mem.id)));
      members.forEach((mem, j) => {
        const st = seats[j];
        faces.push({
          depth: st.x + st.y,
          node: mem.user ? (
            <Face3 key={`mf-${m.id}-${mem.id}`} x={st.x} y={st.y} z={st.z} m={mem.user} mineId={meId} i={j} />
          ) : (
            <InitialToken key={`mf-${m.id}-${mem.id}`} x={st.x} y={st.y} z={st.z} name={mem.name} n={mem.id} />
          ),
        });
      });
    }
    // 모임 자리에 앉은 사람 (얼굴 층)
    for (const t of tables) {
      [...t.back, ...t.front].forEach((st, j) => {
        if (st.member) faces.push({ depth: st.x + st.y, node: <Face3 key={`gf-${t.g.id}-${j}`} x={st.x} y={st.y} z={st.z + (t.kind === 'long' ? 0 : 2)} m={st.member} mineId={meId} i={j} /> });
      });
    }
    faces.sort((a, b) => a.depth - b.depth);

    // 서 있는 사람: 가구가 없는 바닥(밥약 줄 사이 통로, 회의 칸 사이 통로, 창가 앞) 중에서 사람마다 늘 같은 자리
    const spots: { x: number; y: number }[] = [];
    for (let r = 0; r < mealRows - 1; r++) {
      const y = mealY(r) + MEAL_ROW / 2;
      for (const x of [...colXs, ...midXs]) spots.push({ x, y });
    }
    for (let r = 1; r < meetingRows; r++) for (let c = 0; c <= cols; c++) spots.push({ x: SIDE + c * SLOT_X, y: BACK + r * SLOT_Y });
    for (let c = 0; c <= cols; c++) spots.push({ x: SIDE + c * SLOT_X, y: BACK + 8 });
    const taken = new Set<number>();
    people.forEach((person, i) => {
      if (shown.has(person.id)) return; // 이미 자리에 앉아 있다
      if (taken.size >= spots.length) return;
      let k = hashId(person.id) % spots.length;
      while (taken.has(k)) k = (k + 1) % spots.length;
      taken.add(k);
      const sp = spots[k];
      put(`person-${person.id}`, sp.x + sp.y + 1, <StandingPerson key={`person-${person.id}`} x={sp.x} y={sp.y} p={person} me={person.id === meId} i={i} />);
    });
    // 앞뒤 순서: 뒤(x+y 가 작은 쪽)부터
    props.sort((p, q) => p.depth - q.depth);

    // 둘러볼 수 있는 범위: 방(벽 꼭대기 ~ 바닥 판 아래 모서리, 왼쪽 끝 ~ 오른쪽 끝)과 둘레의 조금. 방 끝의 경계가 그대로 보인다.
    const rect = {
      x0: -(d + WALL_T) * ISO_C - EDGE,
      x1: (w + WALL_T) * ISO_C + EDGE,
      y0: -WALL_H - WALL_T / 2 - EDGE,
      y1: (w + d) / 2 + SLAB + EDGE,
    };
    // 처음 보여 줄 곳: 방 가운데 (밥약 띠)
    const focus = iso(fx, fy, 70);
    return { w, d, fx, fy, tables, meetingSpots, props, faces, rugs, rect, vw: rect.x1 - rect.x0, vh: rect.y1 - rect.y0, focus };
  }, [gatherings, cols, people, meId, meetings]);

  const { w, d, rect, vw, vh } = scene;

  // 틀(화면 상자) 크기
  const rootRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const read = () => setFrame({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const cover = frame.w ? Math.max(frame.w / vw, frame.h / vh) : PHONE_SCALE;
  // 배율은 화면 크기와 상관없이 휴대폰과 같다 → 큰 화면에서도 가구 크기·처음 보이는 모습이 같다
  const fit = PHONE_SCALE;
  // 가장 작게: 둘러볼 범위가 틀을 꽉 채우는 것보다 조금 더. 큰 화면에서도 휴대폰의 처음 배율까지는 줄일 수 있다
  const minZoom = Math.min(START_ZOOM, (cover * 0.75) / fit);
  const [zoomWanted, setZoom] = useState(START_ZOOM);
  const zoom = Math.min(MAX_ZOOM, Math.max(minZoom, zoomWanted));
  const scale = fit * zoom;

  // 그림 크기: 방이 틀보다 작아지면 틀만큼 넓혀 방 밖을 함께 그린다 (가운데 정렬)
  const worldW = Math.max(vw * scale, frame.w);
  const worldH = Math.max(vh * scale, frame.h);
  const vbW = worldW / scale;
  const vbH = worldH / scale;
  const vbX = rect.x0 - (vbW - vw) / 2;
  const vbY = rect.y0 - (vbH - vh) / 2;

  // 처음엔 모임 자리들이 모인 곳을 가운데에 둔다
  const scrollRef = useRef<HTMLDivElement>(null);
  const { focus } = scene;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = (focus.x - vbX) * scale - el.clientWidth / 2;
    el.scrollTop = (focus.y - vbY) * scale - el.clientHeight / 2;
    // 자리 수·화면 폭이 바뀔 때만 다시 맞춘다 (새로 불러온 목록·확대·축소마다 시선을 뺏지 않게)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vw, vh, fit]);

  /* ── 확대·축소: 두 손가락 벌리기·오므리기, Ctrl+휠(노트북 터치패드 핀치) ──
     손가락 아래의 지점이 그 자리에 머물도록 스크롤을 함께 옮긴다. */
  const live = useRef({ zoom, scale, fit, minZoom, vbX, vbY });
  live.current = { zoom, scale, fit, minZoom, vbX, vbY };
  const anchor = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null);
  const zoomAt = useCallback((next: number, cx: number, cy: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const { scale: s0, fit: f, minZoom: lo, vbX: bx, vbY: by } = live.current;
    const z = Math.min(MAX_ZOOM, Math.max(lo, next));
    if (Math.abs(f * z - s0) < 1e-4) return;
    anchor.current = { sx: bx + (el.scrollLeft + cx) / s0, sy: by + (el.scrollTop + cy) / s0, cx, cy };
    live.current.zoom = z;
    setZoom(z);
  }, []);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    el.scrollLeft = (a.sx - vbX) * scale - a.cx;
    el.scrollTop = (a.sy - vbY) * scale - a.cy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  /* ── 바깥에서 시점 옮기기: 한 지점(svg 좌표)을 가운데에 두고 배율을 바꾼다 ── */
  const pending = useRef<{ sx: number; sy: number; smooth: boolean } | null>(null);
  const [moveTick, setMoveTick] = useState(0);
  const centerOn = useCallback((sx: number, sy: number, z: number) => {
    const { minZoom: lo, zoom: z0 } = live.current;
    const next = Math.min(MAX_ZOOM, Math.max(lo, z));
    pending.current = { sx, sy, smooth: Math.abs(next - z0) < 1e-3 };
    live.current.zoom = next;
    setZoom(next);
    setMoveTick((t) => t + 1);
  }, []);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const p = pending.current;
    if (!el || !p) return;
    pending.current = null;
    const left = (p.sx - vbX) * scale - el.clientWidth / 2;
    const top = (p.sy - vbY) * scale - el.clientHeight / 2;
    // 배율이 그대로면 부드럽게 미끄러지고, 배율이 바뀌면 바로 옮긴다
    if (p.smooth) el.scrollTo({ left, top, behavior: 'smooth' });
    else {
      el.scrollLeft = left;
      el.scrollTop = top;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveTick, scale]);

  const tablesRef = useRef(scene.tables);
  tablesRef.current = scene.tables;
  const focusTable = useCallback(
    (id: string, z: number) => {
      const t = tablesRef.current.find((x) => x.g.id === id);
      if (!t) return false;
      const p = iso(t.cx, t.cy, TOP_Z + 30);
      centerOn(p.x, p.y, z);
      return true;
    },
    [centerOn],
  );
  useImperativeHandle(
    ref,
    () => ({
      showAll: () => centerOn(rect.x0 + vw / 2, rect.y0 + vh / 2, 0),
      focusOn: (id) => {
        focusTable(id, Math.max(live.current.zoom, FOCUS_ZOOM));
      },
    }),
    [centerOn, focusTable, rect.x0, rect.y0, vw, vh],
  );

  // 처음 한 번: 내 자리가 있으면 그 자리를 가운데에 두고 확대한다 (틀 크기를 잰 뒤)
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (focusedOnce.current || !focusId || !frame.w) return;
    if (focusTable(focusId, START_ZOOM)) focusedOnce.current = true;
  }, [focusId, frame.w, scene, focusTable]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const local = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      return { x: x - r.left, y: y - r.top };
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // 그냥 휠은 둘러보기(스크롤)
      e.preventDefault();
      const p = local(e.clientX, e.clientY);
      zoomAt(live.current.zoom * Math.exp(-e.deltaY * 0.01), p.x, p.y);
    };
    let pinch: { dist: number; zoom: number } | null = null;
    const two = (t: TouchList) => ({
      dist: Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY),
      mid: local((t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2),
    });
    // 한 손가락으로 밀 때는 브라우저 스크롤을 그대로 쓰고(관성 포함), 두 손가락일 때만 손가락 움직임을 직접 받는다
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2 && !pinch) {
        pinch = { dist: two(e.touches).dist, zoom: live.current.zoom };
        el.addEventListener('touchmove', onTouchMove, { passive: false });
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const { dist, mid } = two(e.touches);
      if (pinch.dist > 0) zoomAt((pinch.zoom * dist) / pinch.dist, mid.x, mid.y);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2 && pinch) {
        pinch = null;
        el.removeEventListener('touchmove', onTouchMove);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [zoomAt]);

  // 마우스로 끌어서 둘러보기 (손가락은 기본 스크롤)
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const el = e.currentTarget;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = drag.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.moved && Math.hypot(dx, dy) < 5) return;
    if (!s.moved) e.currentTarget.setPointerCapture(e.pointerId);
    s.moved = true;
    e.currentTarget.scrollLeft = s.left - dx;
    e.currentTarget.scrollTop = s.top - dy;
  };
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.moved) {
      // 끌고 난 뒤의 클릭은 자리를 열지 않는다
      const stop = (ev: MouseEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      e.currentTarget.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => e.currentTarget?.removeEventListener('click', stop, { capture: true }), 0);
    }
    drag.current = null;
  };

  // 방 그림은 확대·축소 때 다시 만들지 않는다 (배율은 svg 크기만 바꾼다)
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const art = useMemo(() => {
    return (
      <>
        <defs>
          <clipPath id="iso-head" clipPathUnits="objectBoundingBox">
            <circle cx="0.5" cy="0.5" r="0.5" />
          </clipPath>
          {/* 체크무늬 바닥: 60 칸 두 색을 바닥 평면에 눕힌 무늬 한 장 (아무리 넓게 깔아도 가볍다) */}
          <pattern id="iso-checker" width={120} height={120} patternUnits="userSpaceOnUse" patternTransform={`matrix(${ISO_C} 0.5 ${-ISO_C} 0.5 0 0)`}>
            <rect width={120} height={120} className="iso-tile" />
            <rect x={60} width={60} height={60} className="iso-tile is-alt" />
            <rect y={60} width={60} height={60} className="iso-tile is-alt" />
          </pattern>
        </defs>

        {/* 바닥과 뒤쪽 두 벽 (화면 밖까지 길게) */}
        {/* 떠 있는 바닥 판: 앞쪽 두 옆면이 방의 경계다 */}
        <Box x={-WALL_T} y={-WALL_T} w={w + WALL_T} d={d + WALL_T} h={SLAB} z={-SLAB} tone="iso-slab" />
        <polygon points={pts(isoRect(0, 0, w, d))} fill="url(#iso-checker)" />
        <Box x={-WALL_T} y={-WALL_T} w={w + WALL_T} d={WALL_T} h={WALL_H} tone="iso-wall-back" />
        <Box x={-WALL_T} y={0} w={WALL_T} d={d} h={WALL_H} tone="iso-wall-side" />
        <Windows x0={30} x1={w - RIGHT - 10} h={WALL_H} />
        {/* 벽 액자: 왼쪽 벽 앞쪽 */}
        {Array.from({ length: Math.max(0, Math.floor((FRONT - 100) / 140)) }, (_, i) => {
          const a = d - FRONT + 60 + i * 140;
          return <WallArt key={`art-s-${i}`} plane="side" a={a} b={a + 90} z0={70} z1={140} n={(i % 4) + 1} />;
        })}

        {/* 바닥 깔개: 회의·미팅 자리와 소파 자리 */}
        {scene.rugs.map((r) => (
          <Face key={`rug-${r.key}`} points={r.points} className={r.tone} />
        ))}

        {/* 벽에 붙은 가구는 언제나 맨 뒤 */}
        <WindowDesks x0={40} x1={w - RIGHT - 30} />
        <CafeCounter x0={w - RIGHT + 20} x1={w - 24} />
        {/* 책장 두 개: 사이를 넉넉히 띄우고 그 사이에 조명 */}
        <Bookshelf y0={BACK + 230} y1={BACK + 420} />
        <Bookshelf y0={BACK + 580} y1={BACK + 770} />

        {scene.props.map((p) => {
          if (p.node) return p.node;
          const i = scene.tables.findIndex((t) => t.g.id === p.key);
          const t = scene.tables[i];
          return (
            <g key={t.g.id} className="iso-enter" style={{ animationDelay: `${i * 70}ms` }}>
              <TableArt t={t} mineId={mineId} onOpen={(slot) => onOpenRef.current(t.g, slot)} />
            </g>
          );
        })}
        {/* 앉은 사람 얼굴 (맨 위 층) */}
        <g className="iso-faces">{scene.faces.map((f) => f.node)}</g>
      </>
    );
  }, [gatherings, scene, mineId, w, d]);

  const px = (v: number) => `${(v * scale).toFixed(1)}px`;

  return (
    <div ref={rootRef} className={`iso-lounge${full ? ' iso-lounge--full' : ''}${fill ? ' iso-lounge--fill' : ''}`}>
      <div
        ref={scrollRef}
        className="iso-lounge__scroll"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className="iso-lounge__world"
          // 줄이면 이름표도 함께 작아진다 (겹쳐서 방을 가리지 않게)
          style={{ width: `${worldW.toFixed(1)}px`, height: `${worldH.toFixed(1)}px`, '--ps': Math.min(1, Math.max(0.5, zoom)).toFixed(3) } as CSSProperties}
        >
          <svg
            className="iso-lounge__svg"
            viewBox={`${vbX.toFixed(1)} ${vbY.toFixed(1)} ${vbW.toFixed(1)} ${vbH.toFixed(1)}`}
            width={worldW.toFixed(1)}
            height={worldH.toFixed(1)}
            aria-hidden="true"
            focusable="false"
          >
            {art}
          </svg>

          {/* 자리 위 이름표 = 그 모임을 여는 버튼 */}
          {scene.tables.map((t, i) => {
            const anchor =
              t.kind === 'square'
                ? iso(t.cx, t.cy - 46, CHAIR_Z + HEAD_R * 2 + 18)
                : t.kind === 'booth'
                  ? iso(t.cx, t.cy - 30, SOFA_SEAT_Z + HEAD_R * 2 + 30)
                  : iso(t.cx, t.cy - TABLE_D / 2 - 20, STOOL_H + HEAD_R * 2 + 14);
            const status = STATUS_BADGE[t.g.status];
            const relation = relationBadge(t.g);
            const { taken, capacity } = seatCount(t.g);
            const when = shortMeetAt(t.g.meetAt);
            const label = [`${KIND_LABEL[t.g.kind]}, ${t.g.title}`, `${when}, ${t.g.place}`, `${capacity}명 중 ${taken}명 참여`, status.label, relation?.label]
              .filter(Boolean)
              .join(', ');
            const chip = relation?.label ?? (t.g.status === 'open' ? (t.g.kind === 'meal' ? KIND_LABEL.meal : null) : status.label);
            return (
              <button
                key={t.g.id}
                type="button"
                className={`iso-plate${t.g.status === 'open' ? '' : ' is-closed'}${relation ? ' is-mine' : ''}`}
                style={{ left: px(anchor.x - vbX), top: px(anchor.y - vbY), animationDelay: `${i * 70 + 120}ms` }}
                aria-label={label}
                onClick={() => onOpen(t.g)}
                onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' })}
              >
                <span className="iso-plate__title">
                  {chip && <span className="iso-plate__chip">{chip}</span>}
                  <span className="iso-plate__name">{t.g.title}</span>
                </span>
                <span className="iso-plate__meta">{when}</span>
              </button>
            );
          })}
          {/* 회의 탁자 이름표 = 그 회의 화면으로 가는 버튼 */}
          {scene.meetingSpots.map(({ m, cx, cy, sofa }) => {
            const a = sofa ? iso(cx, sofaSeatY(cy).back, SOFA_SEAT_Z + HEAD_R * 2 + 34) : iso(cx, cy - 47, CHAIR_Z + HEAD_R * 2 + 18);
            return (
              <button
                key={`meeting-${m.id}`}
                type="button"
                className="iso-plate is-meeting"
                style={{ left: px(a.x - vbX), top: px(a.y - vbY) }}
                aria-label={`회의, ${m.name}`}
                onClick={() => onOpenMeeting?.(m.id)}
              >
                <span className="iso-plate__title">
                  <span className="iso-plate__chip">회의</span>
                  <span className="iso-plate__name">{m.name}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {children}
    </div>
  );
}
