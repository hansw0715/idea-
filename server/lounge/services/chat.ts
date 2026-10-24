/**
 * 단톡방 서비스. 방 id = 모임 id. 정원이 차면 열리고, 참여자만 읽고 쓸 수 있다.
 * 지금은 3초마다 새 메시지를 받아오는 폴링이다 — 서버리스에서는 소켓을 유지할 수 없어서 일부러 이렇게 한다.
 */
import { randomUUID } from 'node:crypto';
import { fail, ok } from '../../../shared/lounge/types.js';
import type { Result } from '../../../shared/lounge/types.js';
import { SYSTEM_OPEN_MESSAGE } from '../../../shared/lounge/constants.js';
import type { ChatMessageView, RoomView, RoomSummary } from '../../../shared/lounge/view.js';
import { loadUsers, toPublicUser, unknownUser } from '../users.js';
import type { LoungeUser } from '../users.js';
import { currentStatus, isFull, memberIds } from '../domain/gathering.js';
import { canRead, checkSend, hideBlocked, messagesAfter } from '../domain/chat.js';
import type { Message, RoomAccess } from '../domain/chat.js';
import type { Gathering } from '../../../shared/lounge/gathering.js';
import { findGathering, listRoomGatherings } from '../repo/gatherings.js';
import { insertMessage, insertSystemMessageIfEmpty, listMessages, latestRoomActivity } from '../repo/messages.js';
import { hiddenFor } from './safety.js';

const nowISO = () => new Date().toISOString();

/** 방에 처음 들어온 사람에게 최근 몇 개를 보여 줄지 */
const RECENT_LIMIT = 200;

type Loaded = { gathering: Gathering; access: RoomAccess };

/** 기존 방 읽기 권한과 같은 기준. 신청자·탈퇴한 참여자는 포함하지 않는다. */
export async function roomSummaries(viewer: LoungeUser): Promise<RoomSummary[]> {
  const rows = await listRoomGatherings(viewer.id);
  const activity = await latestRoomActivity(viewer.id);
  const now = nowISO();
  return rows.flatMap((g) => {
    const status = currentStatus(g, now);
    const members = memberIds(g);
    if (!canRead({ memberIds: members, opened: isFull(g) || status === 'done', readOnly: true }, viewer.id)) return [];
    return [{ id: g.id, title: g.title, kind: g.kind, meetAt: g.meetAt, place: g.place, lastActivityAt: activity.get(g.id) ?? null,
      memberCount: members.length, readOnly: status === 'done' || status === 'cancelled' }];
  });
}

async function accessOf(roomId: string): Promise<Result<Loaded>> {
  const gathering = await findGathering(roomId);
  if (!gathering) return fail('NOT_FOUND', '없는 방이에요.');

  const status = currentStatus(gathering, nowISO());
  return ok({
    gathering,
    access: {
      memberIds: memberIds(gathering),
      // 자리가 다 차면 방이 열린다. 끝난 모임도 기록을 볼 수 있게 열어 둔다.
      opened: isFull(gathering) || status === 'done',
      readOnly: status === 'cancelled' || status === 'done',
    },
  });
}

/**
 * 말풍선에 붙일 보낸 사람 이름.
 *  - 시스템 안내와 차단으로 가려진 말풍선(이 경로에서는 kind 가 system 으로 바뀐다)에는 이름이 없다.
 *  - 글(kind text)인데 보낸 사람이 없으면 탈퇴한 사람이다 — 메시지 테이블은 탈퇴 시 user_id 를 NULL 로 바꾼다(ON DELETE SET NULL).
 *    이름 없는 말풍선이 되지 않게 좌석 목록과 같은 '(탈퇴한 사용자)' 로 보인다.
 */
function senderNickname(m: Message, masked: boolean, users: Map<string, LoungeUser>, showName: boolean): string {
  if (masked || m.kind === 'system') return '';
  if (m.userId === null) return unknownUser('').nickname;
  const u = users.get(m.userId);
  if (!u) return unknownUser(m.userId).nickname;
  return showName ? u.name : u.nickname;
}

/**
 * 방 보기. `after`(ISO) 가 있으면 그 이후 메시지만(폴링). 차단한 사람의 말풍선은 가린다.
 * 열리지 않은 방은 NOT_OPEN, 참여자가 아니면 FORBIDDEN.
 */
export async function roomView(viewer: LoungeUser, roomId: string, after: string | null = null): Promise<Result<RoomView>> {
  const loaded = await accessOf(roomId);
  if (!loaded.ok) return loaded;

  const { access, gathering } = loaded.value;
  if (!access.opened) return fail('NOT_OPEN', '아직 자리가 다 안 찼어요. 인원이 모이면 방이 열려요.');
  if (!canRead(access, viewer.id)) return fail('FORBIDDEN', '참여자만 들어올 수 있어요.');

  const [raw, hidden] = await Promise.all([listMessages(roomId, { after, limit: RECENT_LIMIT }), hiddenFor(viewer.id)]);
  const users = await loadUsers([...access.memberIds, ...raw.flatMap((m) => (m.userId ? [m.userId] : []))]);
  // 가린 이름(박○재)은 미팅 방에서만. 밥약 같은 다른 방에서는 함께 만나는 사람끼리 실명을 보여 준다
  const showName = gathering.kind !== 'meetup';

  // 가려진 말풍선은 보낸 사람 정보도 같이 지운다 — 누가 썼는지 알아내는 통로가 되지 않게.
  const messages: ChatMessageView[] = hideBlocked(messagesAfter(raw, after), hidden).map((m) => {
    const masked = m.userId !== null && hidden.has(m.userId);
    return {
      id: m.id,
      roomId: m.roomId,
      userId: masked ? null : m.userId,
      kind: m.kind,
      text: m.text,
      at: m.at,
      nickname: senderNickname(m, masked, users, showName),
      mine: m.userId === viewer.id,
    };
  });

  return ok({
    id: roomId,
    title: gathering.title,
    kind: gathering.kind,
    meetAt: gathering.meetAt,
    place: gathering.place,
    readOnly: access.readOnly,
    members: access.memberIds.map((id) => {
      const u = users.get(id);
      if (!u) return unknownUser(id);
      return showName ? { ...toPublicUser(u), nickname: u.name } : toPublicUser(u);
    }),
    messages,
  });
}

/** 메시지 보내기. 정지된 사용자는 BANNED, 읽기 전용(취소·종료)이면 막는다. 저장까지 이 요청 안에서 끝낸다. */
export async function sendMessage(sender: LoungeUser, roomId: string, text: string): Promise<Result<Message>> {
  const loaded = await accessOf(roomId);
  if (!loaded.ok) return loaded;
  const { access } = loaded.value;

  if (sender.banned && canRead(access, sender.id)) {
    return fail('BANNED', '이용이 정지된 계정은 메시지를 보낼 수 없어요.');
  }
  const checked = checkSend(access, sender.id, text);
  if (!checked.ok) return checked;

  const message: Message = {
    id: randomUUID(),
    roomId,
    userId: sender.id,
    kind: 'text',
    text: checked.value,
    at: nowISO(),
  };
  await insertMessage(message);
  return ok(message);
}

/**
 * 방을 열면서 안내 한 줄을 남긴다. 빈 화면만 뜨면 뭘 해야 할지 모르니까.
 * 멱등: 방에 메시지가 하나라도 있으면 아무 일도 하지 않는다 (정원이 다시 찼다 비었다 해도, 동시에 불려도 한 줄뿐).
 * 빠른 매칭이 확정된 밥약을 만든 뒤에도 이 함수를 부른다.
 */
export async function openRoomIfNeeded(roomId: string): Promise<void> {
  await insertSystemMessageIfEmpty(roomId, SYSTEM_OPEN_MESSAGE, nowISO());
}
