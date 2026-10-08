import { describe, expect, it } from 'vitest';
import {
  canRead,
  checkSend,
  hasUnsafeChars,
  hideBlocked,
  MAX_MESSAGE_LENGTH,
  messagesAfter,
  sortMessages,
  type Message,
  type RoomAccess,
} from './chat.js';

const u = (id: string) => id;

const access: RoomAccess = { memberIds: [u('a'), u('b')], opened: true, readOnly: false };

const msg = (id: string, at: string, over: Partial<Message> = {}): Message => ({
  id,
  roomId: 'g1',
  userId: u('a'),
  kind: 'text',
  text: '안녕',
  at,
  ...over,
});

describe('입장', () => {
  it('참여자만 들어올 수 있다', () => {
    expect(canRead(access, u('a'))).toBe(true);
    expect(canRead(access, u('c'))).toBe(false);
    expect(canRead(access, null)).toBe(false);
  });

  it('정원이 차기 전에는 방이 없다', () => {
    expect(canRead({ ...access, opened: false }, u('a'))).toBe(false);
  });
});

describe('메시지 보내기', () => {
  it('앞뒤 공백을 지우고 보낸다', () => {
    const r = checkSend(access, u('a'), '  밥 먹자  ');
    expect(r.ok && r.value).toBe('밥 먹자');
  });

  it('빈 메시지는 못 보낸다', () => {
    expect(checkSend(access, u('a'), '   ').ok).toBe(false);
  });

  it('너무 길면 막는다', () => {
    expect(checkSend(access, u('a'), 'ㅋ'.repeat(MAX_MESSAGE_LENGTH + 1)).ok).toBe(false);
    expect(checkSend(access, u('a'), 'ㅋ'.repeat(MAX_MESSAGE_LENGTH)).ok).toBe(true);
  });

  it('참여자가 아니면 못 보낸다', () => {
    const r = checkSend(access, u('c'), '안녕');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN');
  });

  it('취소·종료된 모임은 읽기만 된다', () => {
    const r = checkSend({ ...access, readOnly: true }, u('a'), '안녕');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_OPEN');
  });

  it('DB 가 받지 못하는 글자(NUL)는 입구에서 막는다', () => {
    const r = checkSend(access, u('a'), '안녕\u0000하세요');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID');
  });
});

describe('안전하지 않은 글자', () => {
  it('NUL · 제어문자 · 짝 없는 서로게이트를 찾아낸다', () => {
    expect(hasUnsafeChars('a\u0000b')).toBe(true);
    expect(hasUnsafeChars('a\u0007b')).toBe(true);
    expect(hasUnsafeChars('\ud83d')).toBe(true);
    expect(hasUnsafeChars('\ude00')).toBe(true);
  });

  it('이모지와 여러 줄 글은 괜찮다', () => {
    expect(hasUnsafeChars('같이 가요 😀\n내일 봐요\t!')).toBe(false);
  });

  it('한 줄 글에서는 줄바꿈도 막는다', () => {
    expect(hasUnsafeChars('제목\n둘째 줄', false)).toBe(true);
    expect(hasUnsafeChars('제목', false)).toBe(false);
  });
});

describe('목록', () => {
  const list = [msg('m2', '2026-09-25T01:00:00.000Z'), msg('m1', '2026-09-25T00:00:00.000Z')];

  it('시간순으로 정렬한다', () => {
    expect(sortMessages(list).map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('같은 시각이면 id 순으로 고정한다', () => {
    const same = [msg('b', '2026-09-25T00:00:00.000Z'), msg('a', '2026-09-25T00:00:00.000Z')];
    expect(sortMessages(same).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('마지막으로 받은 시각 이후만 준다', () => {
    expect(messagesAfter(list, '2026-09-25T00:30:00.000Z').map((m) => m.id)).toEqual(['m2']);
    expect(messagesAfter(list, null)).toHaveLength(2);
  });

  it('차단한 사람의 메시지는 가린다', () => {
    const [hidden] = hideBlocked([msg('m1', '2026-09-25T00:00:00.000Z')], new Set(['a']));
    expect(hidden.text).not.toBe('안녕');
    expect(hidden.kind).toBe('system');
  });

  it('차단하지 않은 사람의 메시지와 시스템 메시지는 그대로 둔다', () => {
    const visible = hideBlocked(
      [msg('m1', '2026-09-25T00:00:00.000Z', { userId: u('b') }), msg('m2', '2026-09-25T00:00:01.000Z', { userId: null, kind: 'system' })],
      new Set(['a']),
    );
    expect(visible.map((m) => m.text)).toEqual(['안녕', '안녕']);
  });
});
