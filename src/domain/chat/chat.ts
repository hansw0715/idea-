/**
 * 모임 단톡방. (담당: 한승원)
 *
 * 카톡처럼 "인원이 다 차면 그 사람들만의 방"이 열린다. 방은 모임 하나당 하나고, id도 모임 id를 그대로 쓴다.
 * 자리가 다 차기 전에는 라운지(공개 피드)에서 이야기하고, 방은 확정된 사람들만 들어온다.
 *
 * 연락처·실명은 아직 공개하지 않는다 — 개인정보 문제가 있어서, 약속 조율은 이 방 안에서만 한다.
 *
 * 전부 순수 함수. 저장은 server/chat-service가 한다.
 */
import { fail, ok, type ISODateTime, type Result, type UserId } from '@/shared/types';

export type MessageKind = 'text' | 'system';

export type Message = {
  id: string;
  roomId: string;
  /** system 메시지는 보낸 사람이 없다 */
  userId: UserId | null;
  kind: MessageKind;
  text: string;
  at: ISODateTime;
};

export const MAX_MESSAGE_LENGTH = 500;

export type RoomAccess = {
  /** 이 방에 들어갈 수 있는 사람들 (모임 참여자) */
  memberIds: UserId[];
  /** 정원이 차서 방이 열렸는가 */
  opened: boolean;
  /** 취소된 모임이면 읽기만 */
  readOnly: boolean;
};

export function canRead(access: RoomAccess, userId: UserId | null): boolean {
  return !!userId && access.opened && access.memberIds.includes(userId);
}

export function checkSend(access: RoomAccess, userId: UserId, text: string): Result<string> {
  if (!canRead(access, userId)) return fail('FORBIDDEN', '이 방에 들어올 수 없어요.');
  if (access.readOnly) return fail('NOT_OPEN', '끝난 모임이라 메시지를 보낼 수 없어요.');

  const trimmed = text.trim();
  if (!trimmed) return fail('INVALID', '메시지를 입력해 주세요.');
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return fail('INVALID', `메시지는 ${MAX_MESSAGE_LENGTH}자까지 보낼 수 있어요.`);
  }
  return ok(trimmed);
}

/** 보낸 시각 순. 같은 시각이면 id 순으로 고정해서 화면이 흔들리지 않게 한다. */
export const sortMessages = (messages: Message[]): Message[] =>
  [...messages].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));

/** 마지막으로 받은 메시지 이후의 새 메시지만 (폴링용) */
export function messagesAfter(messages: Message[], after: ISODateTime | null): Message[] {
  const sorted = sortMessages(messages);
  return after ? sorted.filter((m) => m.at > after) : sorted;
}

/** 차단한 사람의 말풍선은 가린다 — 방을 나가지 않아도 안 보이게 */
export const hideBlocked = (messages: Message[], hidden: Set<string>): Message[] =>
  messages.map((m) => (m.userId && hidden.has(m.userId) ? { ...m, text: '차단한 사용자의 메시지예요.', kind: 'system' as const } : m));
