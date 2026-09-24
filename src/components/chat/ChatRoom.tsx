'use client';

/**
 * 모임 단톡방. (담당: 한승원)
 *
 * 자리가 다 차면 열리는 그 모임 사람들만의 방. 3초마다 새 메시지를 받아온다
 * (Supabase를 붙이면 Realtime 구독으로 바꾸면 되고, 화면은 그대로다).
 */
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, EmptyState, Input, cx } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { fetchRoom, sendMessage } from '@/lib/chat-api';
import { formatMeetAt } from '@/lib/format';
import { MAX_MESSAGE_LENGTH } from '@/domain/chat/chat';
import type { ChatMessageView, RoomView } from '@/server/chat-service';

const POLL_MS = 3000;

export function ChatRoom({ roomId }: { roomId: string }) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(
    () =>
      fetchRoom(roomId)
        .then((r) => {
          setRoom(r);
          setError(null);
        })
        .catch((e) => setError(e instanceof ApiError ? e.message : '방을 열지 못했어요.')),
    [roomId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // 새 메시지가 오면 아래로 붙인다.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [room?.messages.length]);

  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      setRoom(await sendMessage(roomId, text));
      setText('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '보내지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  if (error && !room) {
    return (
      <div className="space-y-3">
        <EmptyState icon="🔒" title={error} />
        <Link href="/meetups" className="block text-center text-xs text-muted underline">
          돌아가기
        </Link>
      </div>
    );
  }
  if (!room) return <div className="h-64 animate-pulse rounded-lg bg-surface-muted" />;

  return (
    <div className="flex h-[calc(100dvh-13rem)] flex-col gap-2">
      <header className="space-y-1">
        <h1 className="text-base font-bold">{room.title}</h1>
        <p className="text-xs text-muted">
          📍 {room.place} · 🕒 {formatMeetAt(room.meetAt)}
        </p>
        <ul className="flex flex-wrap gap-1">
          {room.members.map((m) => (
            <li key={m.id} className="rounded-pill bg-surface-muted px-2 py-0.5 text-[11px]">
              {m.nickname} <span className="text-muted">{m.college}</span>
            </li>
          ))}
        </ul>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto rounded-lg border border-border bg-surface p-3">
        {room.messages.length === 0 && <p className="text-center text-xs text-muted">아직 메시지가 없어요.</p>}
        {room.messages.map((m) => (
          <Bubble key={m.id} message={m} />
        ))}
        <div ref={bottom} />
      </div>

      {error && <Badge tone="danger">{error}</Badge>}

      {room.readOnly ? (
        <p className="rounded-md bg-surface-muted px-3 py-2 text-center text-xs text-muted">
          끝난 모임이라 읽기만 돼요.
        </p>
      ) : (
        <div className="flex gap-2">
          <Input
            value={text}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder="메시지 보내기"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void send();
            }}
          />
          <Button disabled={busy || !text.trim()} onClick={send}>
            보내기
          </Button>
        </div>
      )}
      <p className="text-center text-[11px] text-muted">
        연락처·실명은 공개되지 않아요. 불쾌한 일이 있으면 모임 카드에서 신고할 수 있어요.
      </p>
    </div>
  );
}

function Bubble({ message: m }: { message: ChatMessageView }) {
  if (m.kind === 'system') {
    return <p className="mx-auto w-fit rounded-pill bg-surface-muted px-3 py-1 text-center text-[11px] text-muted">{m.text}</p>;
  }

  return (
    <div className={cx('flex flex-col', m.mine ? 'items-end' : 'items-start')}>
      {!m.mine && <span className="mb-0.5 text-[11px] text-muted">{m.nickname}</span>}
      <div className={cx('max-w-[75%] rounded-lg px-3 py-2 text-sm', m.mine ? 'bg-brand text-white' : 'bg-surface-muted')}>
        <p className="whitespace-pre-wrap break-words">{m.text}</p>
      </div>
      <span className="mt-0.5 text-[10px] text-muted">
        {new Date(m.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  );
}
