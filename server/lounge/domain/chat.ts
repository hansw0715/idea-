/**
 * 모임 단톡방. (ZIP domain/chat 이식)
 *
 * 카톡처럼 "인원이 다 차면 그 사람들만의 방"이 열린다. 방은 모임 하나당 하나고, id 도 모임 id 를 그대로 쓴다.
 * 자리가 다 차기 전에는 라운지(공개 피드)에서 이야기하고, 방은 확정된 사람들만 들어온다.
 *
 * 연락처·실명은 아직 공개하지 않는다 — 개인정보 문제가 있어서, 약속 조율은 이 방 안에서만 한다.
 *
 * 전부 순수 함수. 저장은 repo/messages, 부수효과는 services/chat 이 한다.
 */
import { fail, ok } from '../../../shared/lounge/types.js';
import type { ISODateTime, Result, UserId } from '../../../shared/lounge/types.js';
import { MAX_MESSAGE_LENGTH } from '../../../shared/lounge/constants.js';

export { MAX_MESSAGE_LENGTH };

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

export type RoomAccess = {
  /** 이 방에 들어갈 수 있는 사람들 (모임 참여자) */
  memberIds: UserId[];
  /** 정원이 차서 방이 열렸는가 */
  opened: boolean;
  /** 취소·종료된 모임이면 읽기만 */
  readOnly: boolean;
};

/** 차단한 사람의 말풍선 자리에 대신 보이는 문장 */
export const HIDDEN_MESSAGE_TEXT = '차단한 사용자의 메시지예요.';

/**
 * DB 에 넣으면 오류가 나는 글자가 들어 있는가. (사용자 글이 500 오류가 되지 않게 입구에서 거른다)
 *  - NUL(\u0000): Postgres text·jsonb 둘 다 저장하지 못한다.
 *  - 짝 없는 서로게이트: JSON 으로 바꾸면 jsonb 가 거절한다.
 *  - 그 밖의 제어문자: 화면을 깨뜨리는 글자라 막는다. 줄바꿈·탭은 여러 줄 글(`allowNewline`)에서만 허용.
 */
export function hasUnsafeChars(text: string, allowNewline = true): boolean {
  // eslint-disable-next-line no-control-regex
  const control = allowNewline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
  if (control.test(text)) return true;
  return /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(text);
}

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
  if (hasUnsafeChars(trimmed)) return fail('INVALID', '보낼 수 없는 글자가 들어 있어요.');
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
  messages.map((m) =>
    m.userId && hidden.has(m.userId) ? { ...m, text: HIDDEN_MESSAGE_TEXT, kind: 'system' as const } : m,
  );
