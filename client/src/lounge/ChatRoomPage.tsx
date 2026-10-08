/**
 * 모임 단톡방 화면 (/lounge/rooms/:id).
 * 담당: 작업 C3. 규칙: docs/lounge/00-overview.md, docs/lounge/01-contract.md §3.5, docs/UI-KIT.md
 *
 * 소켓이 없어서 3초마다 새 메시지만 물어본다(탭이 보일 때만). 화면의 진실은 서버가 준 RoomView 이고,
 * 이 화면은 그것을 이어 붙이기만 한다. 방은 정원이 차야 열리고 참여자만 들어올 수 있다.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { CHAT_POLL_MS, MAX_MESSAGE_LENGTH, formatMeetAt } from '../../../shared/lounge';
import type { ChatMessageView, PublicUser, RoomView } from '../../../shared/lounge';
import { ApiError } from '../api';
import { AppHeader, useHideTabBar } from '../shell/Shell';
import { Alert, Button, EmptyState, Icon, LoadingBlock, Sheet, btnClass } from '../ui';
import { loungeApi } from './api';
import { useLounge } from './LoungeContext';
import Avatar from './parts/Avatar';
import { factLine } from './parts/fact';
import UserSheet from './sheets/UserSheet';
import './chat.css';

/** 사용자가 이 거리(px) 안쪽에서 읽고 있으면 "맨 아래를 보고 있다"고 본다 */
const NEAR_BOTTOM_PX = 80;
/**
 * 폴링할 때 마지막 메시지 시각보다 조금 앞에서부터 받는다. 서버는 `at > after` 만 주는데, 메시지의 `at` 은
 * 보내는 쪽 요청이 시각을 정한 뒤 저장이 끝나야 보인다. 두 사람이 거의 동시에 보내면 나중 시각이 먼저 저장돼
 * 그보다 이른 메시지가 영영 안 보일 수 있어서, 몇 초 겹쳐 받고 id 로 중복을 걷어낸다.
 */
const POLL_OVERLAP_MS = 5000;
/** 연속으로 이만큼 실패하면 "연결이 불안정해요" 를 보인다 (한 번 삐끗한 것은 알리지 않는다) */
const WEAK_LINK_AFTER = 2;

type Phase = 'loading' | 'ready' | 'denied' | 'error';
type RoomMeta = Omit<RoomView, 'messages'>;
type Mode = 'first' | 'poll' | 'sent' | 'replace';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function clockLabel(iso: string): string {
  const d = new Date(iso);
  const hour = d.getHours();
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour < 12 ? '오전' : '오후'} ${h12}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function dayLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}
const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** 보낸 시각 순, 같은 시각이면 id 순 — 서버(`sortMessages`)와 같아야 화면이 흔들리지 않는다 */
const sortMessages = (list: ChatMessageView[]) => [...list].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));

/** 입장할 수 없는 이유 (서버 문구와 같다). 그 밖의 오류는 일반 오류 화면으로 간다 */
function denial(err: unknown): { code: string; title: string; description: string } | null {
  if (!(err instanceof ApiError)) return null;
  if (err.code === 'NOT_OPEN') {
    return { code: err.code, title: '아직 방이 열리지 않았어요', description: '아직 자리가 다 안 찼어요. 인원이 모이면 방이 열려요.' };
  }
  if (err.code === 'FORBIDDEN') {
    return { code: err.code, title: '입장할 수 없어요', description: '참여자만 들어올 수 있어요.' };
  }
  if (err.code === 'NOT_FOUND') {
    return { code: err.code, title: '없는 방이에요', description: '모임이 없어졌거나 주소가 맞지 않아요. 라운지에서 다시 찾아 주세요.' };
  }
  return null;
}

export default function ChatRoomPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to="/lounge" replace />;
  // 방이 바뀌면 상태를 모두 새로 시작한다
  return <ChatRoom key={id} roomId={id} />;
}

/**
 * 모바일 키보드가 올라와도 입력창이 가려지지 않게, 대화 화면의 높이를 "지금 보이는 화면"에 맞춘다.
 * iOS·Android 기본값은 키보드가 visualViewport 만 줄이고 레이아웃(100dvh)은 그대로 둔다.
 */
function useVisualViewportFit(active: boolean) {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) return;
    const rootStyle = document.documentElement.style;
    let frame = 0;
    const clear = () => {
      rootStyle.removeProperty('--lounge-chat-vvh');
      rootStyle.removeProperty('--lounge-chat-vvtop');
    };
    const apply = () => {
      frame = 0;
      // 손가락으로 확대해서 보는 중이면 맞추지 않는다 (확대하면 보이는 영역이 줄어들 뿐 키보드가 아니다)
      if (vv.scale > 1.01) {
        clear();
        return;
      }
      rootStyle.setProperty('--lounge-chat-vvh', `${Math.round(vv.height)}px`);
      rootStyle.setProperty('--lounge-chat-vvtop', `${Math.round(vv.offsetTop)}px`);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    return () => {
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      if (frame) cancelAnimationFrame(frame);
      clear();
    };
  }, [active]);
}

function ChatRoom({ roomId }: { roomId: string }) {
  useHideTabBar();
  const { profile, handleError } = useLounge();

  const [phase, setPhase] = useState<Phase>('loading');
  const [denied, setDenied] = useState<{ title: string; description: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomMeta | null>(null);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [weakLink, setWeakLink] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [pickOpen, setPickOpen] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(null);

  const messagesRef = useRef<ChatMessageView[]>([]);
  const phaseRef = useRef<Phase>('loading');
  const deniedCodeRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const failCountRef = useRef(0);
  const aliveRef = useRef(true);
  const handleErrorRef = useRef(handleError);
  handleErrorRef.current = handleError;
  /** 맨 아래를 보고 있는가 — 새 메시지가 올 때 따라 내려갈지 정한다 */
  const atBottomRef = useRef(true);
  /** 다음 그리기 뒤에 맨 아래로 내려갈지 */
  const stickRef = useRef(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const sendingRef = useRef(false);
  /** 한글 같은 조합 입력 중인가 (조합 중 Enter 는 글자를 확정하는 키다) */
  const composingRef = useRef(false);

  const ready = phase === 'ready';
  useVisualViewportFit(ready);

  const setPhaseBoth = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  /** 서버가 준 방을 화면에 이어 붙인다. 이미 있는 메시지(id)는 건너뛰고, 새 것만 더한다. */
  const ingest = useCallback((next: RoomView, mode: Mode) => {
    const { messages: incoming, ...meta } = next;
    setRoom(meta);

    if (mode === 'replace') {
      // 차단·신고 뒤처럼 서버가 가린 모양으로 처음부터 다시 그린다 (읽던 위치는 그대로 둔다)
      const list = sortMessages(incoming);
      messagesRef.current = list;
      setMessages(list);
      return;
    }
    const prev = messagesRef.current;
    const known = new Set(prev.map((m) => m.id));
    const added = incoming.filter((m) => !known.has(m.id));
    if (added.length === 0) return;

    const list = sortMessages([...prev, ...added]);
    messagesRef.current = list;
    setMessages(list);
    // 내가 보냈거나 맨 아래를 보던 중이면 따라 내려가고, 위를 읽는 중이면 알림만 띄운다.
    if (mode === 'first' || mode === 'sent' || atBottomRef.current || added.some((m) => m.mine)) {
      stickRef.current = true;
    } else {
      setNewCount((c) => c + added.filter((m) => !m.mine).length);
    }
  }, []);

  const fetchRoom = useCallback(
    async (mode: Mode) => {
      // 폴링은 겹쳐서 보내지 않는다. 처음 불러오기·다시 그리기는 사용자가 원한 것이라 막지 않는다.
      if (mode === 'poll') {
        if (inFlightRef.current) return;
        inFlightRef.current = true;
      }
      try {
        const last = messagesRef.current[messagesRef.current.length - 1];
        const after = mode === 'poll' && last ? new Date(Date.parse(last.at) - POLL_OVERLAP_MS).toISOString() : undefined;
        const next = await loungeApi.room(roomId, after);
        if (!aliveRef.current) return;
        ingest(next, phaseRef.current === 'ready' ? mode : 'first');
        failCountRef.current = 0;
        setWeakLink(false);
        deniedCodeRef.current = null;
        setPhaseBoth('ready');
      } catch (err) {
        if (!aliveRef.current) return;
        if (handleErrorRef.current(err)) return;
        const why = denial(err);
        if (why) {
          deniedCodeRef.current = why.code;
          setDenied({ title: why.title, description: why.description });
          setPhaseBoth('denied');
          return;
        }
        failCountRef.current += 1;
        if (phaseRef.current === 'ready') {
          if (failCountRef.current >= WEAK_LINK_AFTER) setWeakLink(true);
        } else {
          setErrorMessage(err instanceof Error ? err.message : '대화를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
          setPhaseBoth('error');
        }
      } finally {
        if (mode === 'poll') inFlightRef.current = false;
      }
    },
    [roomId, ingest, setPhaseBoth],
  );

  // 처음 한 번 불러오고, 그 뒤 3초마다(탭이 보일 때만) 새 메시지를 받는다.
  useEffect(() => {
    aliveRef.current = true;
    void fetchRoom('first');
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      const p = phaseRef.current;
      if (p === 'loading') return;
      // 아직 안 열린 방은 계속 물어봐서 정원이 차는 순간 들어가게 한다. 참여자가 아니거나 없는 방은 더 묻지 않는다.
      if (p === 'denied' && deniedCodeRef.current !== 'NOT_OPEN') return;
      void fetchRoom(p === 'ready' ? 'poll' : 'first');
    };
    const timer = window.setInterval(tick, CHAT_POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      aliveRef.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [fetchRoom]);

  // 새 메시지를 그린 직후 맨 아래로 (그리기 전에 하면 높이가 모자라 중간에 멈춘다)
  useLayoutEffect(() => {
    if (!stickRef.current) return;
    stickRef.current = false;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    setNewCount((c) => (c === 0 ? c : 0));
  }, [messages, phase]);

  // 입력창이 늘어나거나 키보드가 올라와 대화 영역이 줄어도, 맨 아래를 보던 중이면 계속 맨 아래를 보여 준다.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!ready || !el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ready]);

  // 글이 길어지면 입력칸도 같이 커진다 (넘치는 부분은 CSS max-height 안에서 스크롤)
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, ready]);

  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    atBottomRef.current = near;
    if (near) setNewCount((c) => (c === 0 ? c : 0));
  }

  function jumpToBottom() {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    setNewCount(0);
    el.focus({ preventScroll: true });
  }

  async function send() {
    if (sendingRef.current || !room || room.readOnly) return;
    const text = draft.trim();
    if (!text) return;
    // 보내기 버튼을 눌러도 입력칸의 포커스(= 키보드)를 놓치지 않게, 사용자 동작 안에서 바로 되돌려 둔다.
    textareaRef.current?.focus();
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    try {
      ingest(await loungeApi.sendMessage(roomId, text), 'sent');
      setDraft('');
    } catch (err) {
      if (handleErrorRef.current(err)) return;
      // 실패해도 쓴 글은 그대로 두어 다시 보낼 수 있게 한다.
      setSendError(err instanceof Error ? err.message : '메시지를 보내지 못했어요. 잠시 후 다시 시도해 주세요.');
      // 방이 읽기 전용이 되었거나 더는 참여자가 아닌 경우: 화면을 서버 상태에 맞춘다.
      if (err instanceof ApiError && (err.code === 'NOT_OPEN' || err.code === 'FORBIDDEN' || err.code === 'NOT_FOUND')) {
        void fetchRoom('first');
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey) return; // Shift+Enter 는 줄바꿈
    // 한글 조합 중에 누른 Enter 는 마지막 글자를 확정하는 키라 보내지 않는다. (Safari 는 조합이 끝난 뒤 keyCode 229 로 한 번 더 보낸다)
    if (e.nativeEvent.isComposing || composingRef.current || e.keyCode === 229) return;
    e.preventDefault();
    void send();
  }

  const myId = profile?.id ?? null;
  const entries = useMemo(() => buildEntries(messages), [messages]);
  const others = useMemo(
    () => (room ? room.members.filter((m) => m.id !== myId && (m.admissionYear ?? 0) > 0) : []),
    [room, myId],
  );

  const title = phase === 'loading' ? '' : (room?.title ?? '단톡방');
  const moreButton = ready ? (
    <button
      ref={moreRef}
      type="button"
      className="btn btn--icon"
      aria-label="신고·차단"
      aria-haspopup="dialog"
      onClick={() => setPickOpen(true)}
    >
      {/* 점 세 개는 선이 가늘면 작아 보여서 굵게 그린다 */}
      <Icon name="more" className="btn__icon" strokeWidth={4} />
    </button>
  ) : undefined;

  const length = draft.length;
  const canSend = draft.trim().length > 0;

  return (
    <div className={`lounge-chat-shell${ready ? ' lounge-chat-root' : ''}`}>
      <AppHeader title={title} backTo="/lounge" actions={moreButton} />

      {phase === 'loading' && (
        <main id="main" className="app-main">
          <LoadingBlock>대화를 불러오는 중입니다.</LoadingBlock>
        </main>
      )}

      {phase === 'denied' && denied && (
        <main id="main" className="app-main">
          <EmptyState
            icon="message"
            title={denied.title}
            description={denied.description}
            action={
              <Link to="/lounge" className={btnClass({ variant: 'primary' })}>
                라운지로 돌아가기
              </Link>
            }
          />
        </main>
      )}

      {phase === 'error' && (
        <main id="main" className="app-main">
          <Alert
            tone="danger"
            title="대화를 불러오지 못했어요"
            actions={
              <Button variant="secondary" size="sm" onClick={() => void fetchRoom('first')}>
                다시 불러오기
              </Button>
            }
          >
            {errorMessage}
          </Alert>
        </main>
      )}

      {ready && room && (
        <main id="main" className="lounge-chat-main">
          <div className="lounge-chat-viewport">
            {/* 키보드로도 위아래로 읽을 수 있게 포커스를 받는다 */}
            <div
              ref={scrollerRef}
              className="lounge-chat-scroller"
              tabIndex={0}
              aria-label="대화 영역"
              onScroll={onScroll}
            >
              <section className="lounge-chat-info" aria-label="방 정보">
                <ul className="lounge-chat-meta">
                  <li>
                    <Icon name="pin" />
                    <span>{room.place}</span>
                  </li>
                  <li>
                    <Icon name="clock" />
                    <span>{formatMeetAt(room.meetAt)}</span>
                  </li>
                </ul>
                <ul className="lounge-chat-people" aria-label={`참여자 ${room.members.length}명`}>
                  {room.members.map((m) => (
                    <li key={m.id} className="lounge-chat-person">
                      <Avatar user={m} size="sm" />
                      <span className="lounge-chat-person-text">
                        <span className="bold">
                          {m.nickname}
                          {m.id === myId && ' (나)'}
                        </span>
                        {(m.admissionYear ?? 0) > 0 && <span className="lounge-chat-person-college">{factLine(m)}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="lounge-chat-safe">
                  <Icon name="shield" />
                  <span>
                    연락처·실명은 공개되지 않아요. 불쾌한 일이 있으면 <span aria-hidden="true">⋯</span>
                    <span className="sr-only">(위쪽 신고·차단 버튼)</span> 에서 신고할 수 있어요.
                  </span>
                </p>
              </section>

              <div className="lounge-chat-log" role="log" aria-live="polite" aria-relevant="additions" aria-label="대화 내용">
                {entries.length === 0 && <p className="lounge-chat-empty">아직 대화가 없어요. 먼저 인사를 건네 보세요.</p>}
                {entries.map((entry) => {
                  if (entry.kind === 'date') {
                    return (
                      <p key={entry.key} className="lounge-chat-chip">
                        {entry.label}
                      </p>
                    );
                  }
                  if (entry.kind === 'system') {
                    return (
                      <p key={entry.key} className="lounge-chat-chip">
                        {entry.message.text}
                      </p>
                    );
                  }
                  const { message: m, first, last } = entry;
                  const nameShown = first && !m.mine;
                  return (
                    <div
                      key={entry.key}
                      className={`lounge-chat-item${m.mine ? ' lounge-chat-item--mine' : ''}${first ? ' lounge-chat-item--first' : ''}`}
                    >
                      {nameShown && <span className="lounge-chat-name">{m.nickname}</span>}
                      <div className="lounge-chat-row">
                        <p className={`lounge-chat-bubble${m.mine ? ' lounge-chat-bubble--mine' : ''}`}>
                          {(m.mine || !nameShown) && <span className="sr-only">{m.mine ? '내 메시지: ' : `${m.nickname}: `}</span>}
                          {m.text}
                        </p>
                        {last && (
                          <time className="lounge-chat-time" dateTime={m.at}>
                            {clockLabel(m.at)}
                          </time>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {newCount > 0 && (
              <Button
                variant="secondary"
                className="lounge-chat-jump"
                aria-label={`새 메시지 ${newCount}개 보기, 맨 아래로 이동`}
                onClick={jumpToBottom}
              >
                새 메시지
                <Icon name="chevron-down" className="btn__icon" />
              </Button>
            )}
          </div>

          {room.readOnly ? (
            <p className="lounge-chat-readonly" role="status">
              끝난 모임이라 읽기만 돼요.
            </p>
          ) : (
            <form
              className="lounge-chat-composer"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              {sendError && (
                <Alert tone="danger" title="메시지를 보내지 못했어요">
                  {sendError}
                </Alert>
              )}
              {weakLink && (
                <p className="lounge-chat-weak" role="status">
                  연결이 불안정해요. 자동으로 다시 시도하고 있어요.
                </p>
              )}
              <div className="lounge-chat-compose-row">
                <label htmlFor="lounge-chat-input" className="sr-only">
                  메시지 입력
                </label>
                <textarea
                  id="lounge-chat-input"
                  ref={textareaRef}
                  className="input lounge-chat-input"
                  rows={1}
                  maxLength={MAX_MESSAGE_LENGTH}
                  value={draft}
                  placeholder="메시지를 입력해 주세요"
                  enterKeyHint="send"
                  autoComplete="off"
                  readOnly={sending}
                  aria-describedby="lounge-chat-count"
                  onChange={(e) => {
                    setDraft(e.target.value);
                    if (sendError) setSendError(null);
                  }}
                  onKeyDown={onKeyDown}
                  onCompositionStart={() => {
                    composingRef.current = true;
                  }}
                  onCompositionEnd={() => {
                    composingRef.current = false;
                  }}
                />
                <Button
                  type="submit"
                  variant="primary"
                  className="lounge-chat-send"
                  aria-label="보내기"
                  loading={sending}
                  aria-disabled={canSend ? undefined : true}
                  // 마우스·터치로 누를 때 입력칸이 포커스를 잃어 키보드가 내려가지 않게 한다
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {!sending && <Icon name="send" className="btn__icon" />}
                </Button>
              </div>
              <div className="lounge-chat-foot-row">
                <span id="lounge-chat-count" className={`lounge-chat-count${length >= MAX_MESSAGE_LENGTH ? ' is-full' : ''}`}>
                  {length >= MAX_MESSAGE_LENGTH ? `최대 ${MAX_MESSAGE_LENGTH}자까지 쓸 수 있어요 · ` : ''}
                  {length}/{MAX_MESSAGE_LENGTH}
                </span>
              </div>
            </form>
          )}
        </main>
      )}

      {/* ⋯ → 신고·차단할 참여자 고르기 → 사용자 카드(UserSheet) */}
      <Sheet open={pickOpen} onClose={() => setPickOpen(false)} title="신고·차단할 사람 고르기">
        <p className="lounge-chat-pick-lead">신고하거나 차단할 참여자를 골라 주세요. 차단해도 상대에게 알리지 않아요.</p>
        {others.length === 0 ? (
          <EmptyState title="고를 수 있는 참여자가 없어요" description="나 말고 다른 참여자가 있을 때 고를 수 있어요." />
        ) : (
          <div className="list">
            {others.map((m: PublicUser) => (
              <button
                key={m.id}
                type="button"
                className="list__item list__item--link lounge-chat-pick-item"
                onClick={() => {
                  setPickOpen(false);
                  setTargetId(m.id);
                }}
              >
                <Avatar user={m} size="md" />
                <span className="list__body">
                  <span className="list__main">{m.nickname}</span>
                  <span className="list__sub">{factLine(m)}</span>
                </span>
                <Icon name="chevron-right" className="list__chev" />
              </button>
            ))}
          </div>
        )}
      </Sheet>
      <UserSheet
        open={targetId !== null}
        userId={targetId}
        context="chat"
        refId={roomId}
        onClose={() => {
          setTargetId(null);
          // 사용자 카드를 닫으면 ⋯ 버튼으로 돌아온다 (고르기 시트가 이미 닫혀 있어 포커스가 갈 곳이 없다)
          window.setTimeout(() => moreRef.current?.focus(), 0);
        }}
        onSafetyChanged={() => void fetchRoom('replace')}
      />
    </div>
  );
}

// ───────────── 말풍선 목록 만들기 ─────────────

type Entry =
  | { kind: 'date'; key: string; label: string }
  | { kind: 'system'; key: string; message: ChatMessageView }
  | { kind: 'message'; key: string; message: ChatMessageView; first: boolean; last: boolean };

/** 같은 사람이 같은 분 안에 이어서 보낸 말은 한 묶음으로 본다 (이름은 첫 말풍선에만, 시각은 마지막에만) */
const sameGroup = (a?: ChatMessageView, b?: ChatMessageView) =>
  !!a && !!b && a.kind === 'text' && b.kind === 'text' && a.userId !== null && a.userId === b.userId && a.at.slice(0, 16) === b.at.slice(0, 16);

function buildEntries(messages: ChatMessageView[]): Entry[] {
  const out: Entry[] = [];
  let lastDay = '';
  messages.forEach((m, i) => {
    const day = dayKey(m.at);
    if (day !== lastDay) {
      out.push({ kind: 'date', key: `date-${day}`, label: dayLabel(m.at) });
      lastDay = day;
    }
    if (m.kind === 'system') {
      out.push({ kind: 'system', key: m.id, message: m });
      return;
    }
    out.push({
      kind: 'message',
      key: m.id,
      message: m,
      first: !sameGroup(messages[i - 1], m),
      last: !sameGroup(m, messages[i + 1]),
    });
  });
  return out;
}
