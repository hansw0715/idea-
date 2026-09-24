/**
 * 단톡방 서비스. (담당: 한승원)
 *
 * 방 id = 모임 id. 정원이 차면 열리고, 참여자만 읽고 쓸 수 있다.
 * 지금은 3초마다 새 메시지를 받아오는 폴링이다 — Supabase를 붙이면 Realtime 구독으로 바꾸면 된다.
 */
import { asGatheringId, fail, ok, type Result, type UserId } from '@/shared/types';
import type { User } from '@/shared/user';
import { currentStatus, isFull, memberIds } from '@/domain/gathering';
import { checkSend, hideBlocked, messagesAfter, type Message, type RoomAccess } from '@/domain/chat/chat';
import { chatRepo, gatheringRepo, userRepo } from './repo/memory-repo';
import { hiddenFor } from './safety-service';

const nowISO = () => new Date().toISOString();

export type ChatMessageView = Message & {
  nickname: string;
  mine: boolean;
};

export type RoomView = {
  id: string;
  title: string;
  kind: string;
  meetAt: string;
  place: string;
  opened: boolean;
  readOnly: boolean;
  members: { id: string; nickname: string; college: string; temperature: number }[];
  messages: ChatMessageView[];
};

async function accessOf(roomId: string): Promise<Result<{ access: RoomAccess; gathering: NonNullable<Awaited<ReturnType<typeof gatheringRepo.find>>> }>> {
  const gathering = await gatheringRepo.find(asGatheringId(roomId));
  if (!gathering) return fail('NOT_FOUND', '없는 방이에요.');

  const status = currentStatus(gathering, nowISO());
  return ok({
    gathering,
    access: {
      memberIds: memberIds(gathering),
      // 자리가 다 차면 방이 열린다. 끝난 모임도 기록을 볼 수 있게 열어둔다.
      opened: isFull(gathering) || status === 'done',
      readOnly: status === 'cancelled' || status === 'done',
    },
  });
}

export async function roomView(roomId: string, viewer: User | null, after: string | null = null): Promise<Result<RoomView>> {
  const loaded = await accessOf(roomId);
  if (!loaded.ok) return loaded;

  const { access, gathering } = loaded.value;
  if (!viewer) return fail('FORBIDDEN', '로그인이 필요해요.');
  if (!access.opened) return fail('NOT_OPEN', '아직 자리가 다 안 찼어요. 인원이 모이면 방이 열려요.');
  if (!access.memberIds.includes(viewer.id)) return fail('FORBIDDEN', '참여자만 들어올 수 있어요.');

  const [raw, users, hidden] = await Promise.all([chatRepo.list(roomId), userRepo.list(), hiddenFor(viewer.id)]);
  const byId = new Map(users.map((u) => [u.id as string, u]));

  const messages = hideBlocked(messagesAfter(raw, after), hidden).map((m) => ({
    ...m,
    nickname: m.userId ? (byId.get(m.userId)?.nickname ?? '(탈퇴)') : '',
    mine: m.userId === viewer.id,
  }));

  return ok({
    id: roomId,
    title: gathering.title,
    kind: gathering.kind,
    meetAt: gathering.meetAt,
    place: gathering.place,
    opened: access.opened,
    readOnly: access.readOnly,
    members: access.memberIds.map((id) => {
      const u = byId.get(id);
      return {
        id,
        nickname: u?.nickname ?? '(탈퇴)',
        college: u?.college ?? '-',
        temperature: u?.temperature ?? 0,
      };
    }),
    messages,
  });
}

export async function sendMessage(roomId: string, userId: UserId, text: string): Promise<Result<Message>> {
  const loaded = await accessOf(roomId);
  if (!loaded.ok) return loaded;

  const checked = checkSend(loaded.value.access, userId, text);
  if (!checked.ok) return checked;

  const message: Message = {
    id: crypto.randomUUID(),
    roomId,
    userId,
    kind: 'text',
    text: checked.value,
    at: nowISO(),
  };
  await chatRepo.save(message);
  return ok(message);
}

/** 방을 열면서 안내 한 줄을 남긴다. 빈 화면만 뜨면 뭘 해야 할지 모르니까. */
export async function openRoom(roomId: string, text: string): Promise<void> {
  if (await chatRepo.hasMessages(roomId)) return;
  await chatRepo.save({
    id: crypto.randomUUID(),
    roomId,
    userId: null,
    kind: 'system',
    text,
    at: nowISO(),
  });
}
