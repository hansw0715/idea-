/**
 * 밥약 빠른 매칭 시트 — 조건(날짜·장소·인원·가능 시간·태그) → 대기 → 후보 방(시간 투표·전원 수락) → 확정.
 * 담당: 작업 C3.
 *
 * 계약(props)은 바꾸지 말고, 필요하면 선택(optional) props 만 추가한다.
 *  - onConfirmed: 전원 수락으로 밥약이 확정되면 만들어진 모임 id 와 함께 호출한다. 호출한 쪽이 지도·목록을 새로 고친다.
 *
 * 진실은 서버다. 이 시트는 `loungeApi.quick()` 이 돌려준 상태를 그대로 그리고, 시트를 닫아도 대기는 서버에 남는다.
 * 후보 방이 생겼는지·남들이 수락했는지는 소켓이 없어서 열려 있는 동안 5초마다 물어본다(탭이 보일 때만).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { MEAL_CAPACITY_OPTIONS, MEAL_TAGS, PLACE_TYPES, TIME_BANDS, timeBand, todayKst, toKst } from '../../../../shared/lounge';
import type { PlaceType, PublicUser, QuickRoomView, QuickState } from '../../../../shared/lounge';
import { ApiError } from '../../api';
import { fmtDate } from '../../time';
import { Alert, Badge, Button, Icon, LoadingBlock, Segmented, Sheet, TextField, useConfirm } from '../../ui';
import { loungeApi } from '../api';
import { useLounge } from '../LoungeContext';
import Avatar from '../parts/Avatar';
import TableSheet from './TableSheet';
import '../quick.css';

export type QuickMatchSheetProps = {
  open: boolean;
  onClose: () => void;
  onConfirmed?: (gatheringId: string) => void;
};

/** 후보 방 소식을 받아오는 간격 (원본 ZIP 과 같은 5초) */
const QUICK_POLL_MS = 5000;
/** 남은 시간·"이미 지난 시간 칩"을 다시 계산하는 간격. 글자는 분이 바뀔 때만 바뀐다. */
const CLOCK_TICK_MS = 15_000;
/** 시트를 닫은 사이에 후보 방이 깨졌는지 알아채려고, 마지막으로 본 후보 방 id 를 이 탭에만 기억한다. */
const LAST_ROOM_KEY = 'lounge-quick-last-room';

/** other: 확인창 안에서 도는 거절·대기 취소처럼 사용자가 확인한 뒤 서버로 가는 동작 */
type Busy = 'submit' | 'vote' | 'accept' | 'other' | null;
type Notice = 'cancelled' | 'declined' | null;
type ActionError = { title: string; message: string; tone: 'danger' | 'warning' };

type FormValues = {
  date: string;
  placeType: PlaceType;
  size: number;
  bands: string[];
  tags: string[];
};

// ───────────── 날짜·시간 도우미 ─────────────

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * 이 날짜에 고를 수 있는 시간 구간. 오늘이면 이미 시작한 구간은 뺀다.
 * 서버(`futureBands`)가 "구간 시작이 지금보다 뒤"일 때만 받으므로 같은 기준으로 맞춘다 — 눌렀는데 서버가 거절하는 칩을 만들지 않으려는 것이다.
 */
function availableBandKeys(date: string, nowMs: number): string[] {
  const today = todayKst(nowMs);
  if (date < today) return [];
  if (date > today) return TIME_BANDS.map((b) => b.key);
  const minutes = toKst(new Date(nowMs)).minutes;
  return TIME_BANDS.filter((b) => b.startMin > minutes).map((b) => b.key);
}

/** 처음 보여 줄 조건: 오늘 남은 시간이 있으면 오늘, 없으면 내일. 점심(12시)이 가능하면 미리 골라 둔다(원본과 같다). */
function initialForm(nowMs: number): FormValues {
  const today = todayKst(nowMs);
  const date = availableBandKeys(today, nowMs).length > 0 ? today : addDays(today, 1);
  return { date, placeType: '학식', size: 2, bands: availableBandKeys(date, nowMs).includes('b12') ? ['b12'] : [], tags: [] };
}

/** 매칭 시작을 막는 이유(없으면 null)와 날짜 입력칸에 붙일 오류. 이유는 버튼 옆에 문장으로 보여 준다. */
function validateForm(f: FormValues, nowMs: number): { dateError: string | null; reason: string | null } {
  if (!f.date) return { dateError: '날짜를 골라 주세요.', reason: '날짜를 골라 주세요.' };
  if (f.date < todayKst(nowMs)) {
    return { dateError: '지난 날짜는 고를 수 없어요. 오늘 이후 날짜를 골라 주세요.', reason: '날짜를 오늘 이후로 골라 주세요.' };
  }
  const avail = availableBandKeys(f.date, nowMs);
  if (avail.length === 0) return { dateError: null, reason: '이 날짜에는 고를 수 있는 시간이 없어요. 다른 날짜를 골라 주세요.' };
  if (!f.bands.some((b) => avail.includes(b))) return { dateError: null, reason: '가능한 시간을 하나 이상 골라 주세요.' };
  return { dateError: null, reason: null };
}

const bandLabel = (key: string) => timeBand(key)?.label ?? key;

const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

/**
 * 후보 방 만료까지 남은 분(올림 — 방을 만든 직후는 "30분"으로 보인다). 만료 시각이 지났으면 null: 곧 서버가 취소한다.
 * 호출하는 쪽이 "지금"을 정확히 넘겨야 한다(상태에 저장한 옛 시각을 쓰면 한 분쯤 더 크게 보인다).
 */
const minutesLeft = (expiresAt: string, nowMs: number): number | null => {
  const ms = Date.parse(expiresAt) - nowMs;
  return ms <= 0 ? null : Math.ceil(ms / 60_000);
};

/** 확정될 시간 구간. 서버(`decideBand`)와 같은 규칙: 표가 가장 많은 구간, 동점이면 이른 시간. */
function decidedBand(room: QuickRoomView): string | null {
  const counted = room.bands
    .map((b) => ({ b, n: room.memberIds.filter((id) => (room.votes[id] ?? []).includes(b)).length }))
    .filter((c) => c.n > 0)
    .sort((a, c) => c.n - a.n || (timeBand(a.b)?.startMin ?? 0) - (timeBand(c.b)?.startMin ?? 0));
  return counted[0]?.b ?? null;
}

// ───────────── 이 탭 저장소 (막혀 있어도 동작해야 한다) ─────────────

function readLastRoom(): string | null {
  try {
    return sessionStorage.getItem(LAST_ROOM_KEY);
  } catch {
    return null;
  }
}
function writeLastRoom(id: string | null) {
  try {
    if (id) sessionStorage.setItem(LAST_ROOM_KEY, id);
    else sessionStorage.removeItem(LAST_ROOM_KEY);
  } catch {
    /* 저장이 막힌 브라우저에서는 시트를 닫은 사이의 취소를 알려 주지 못할 뿐이다 */
  }
}

// ───────────── 시트 ─────────────

export default function QuickMatchSheet({ open, onClose, onConfirmed }: QuickMatchSheetProps) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { handleError } = useLounge();

  const [state, setState] = useState<QuickState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pollFailed, setPollFailed] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [voteHint, setVoteHint] = useState(false);
  const [announce, setAnnounce] = useState('');
  // 남은 시간·"이미 지난 시간 칩"을 다시 그리려는 신호일 뿐이다. 값은 그릴 때마다 Date.now() 로 새로 읽는다.
  const [, setTick] = useState(0);
  const [form, setForm] = useState<FormValues>(() => initialForm(Date.now()));
  const [tableOpen, setTableOpen] = useState(false);

  // 비동기 콜백이 항상 최신 값을 보게 하는 참조들 (콜백을 매번 새로 만들면 폴링이 끊긴다)
  const stateRef = useRef<QuickState | null>(null);
  stateRef.current = state;
  const handleErrorRef = useRef(handleError);
  handleErrorRef.current = handleError;
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;
  const busyRef = useRef<Busy>(null);
  const inFlightRef = useRef(false);
  /** 요청마다 번호를 붙여, 늦게 도착한 옛 응답이 새 상태를 덮어쓰지 못하게 한다 */
  const seqRef = useRef(0);
  const appliedRef = useRef(0);
  /** 마지막으로 본 "대기 중인 후보 방" id. 이 방이 사라지면 취소된 것이다. */
  const lastPendingRoomRef = useRef<string | null>(null);
  const declinedByMeRef = useRef(false);
  const confirmedNotifiedRef = useRef<string | null>(null);
  const prevViewRef = useRef<string | null>(null);

  /** 서버가 준 상태를 화면에 반영한다. 더 늦게 시작한 요청의 결과가 이미 반영됐다면 버린다. */
  const apply = useCallback((next: QuickState, seq: number) => {
    if (seq < appliedRef.current) return;
    appliedRef.current = seq;

    const prevRoom = lastPendingRoomRef.current;
    // 서버는 취소된 방을 내려보내지 않는다. 기다리던 후보 방이 사라졌다면 누군가 거절했거나 시간이 지난 것이다.
    // (내가 거절한 경우는 안내를 달리한다 — 판단이 끝났을 때만 표시를 내린다)
    if (prevRoom && next.room?.id !== prevRoom) {
      setNotice(declinedByMeRef.current ? 'declined' : 'cancelled');
      declinedByMeRef.current = false;
    }
    lastPendingRoomRef.current = next.room?.status === 'pending' ? next.room.id : null;
    writeLastRoom(lastPendingRoomRef.current);

    setState(next);
    setLoadError(null);
    setPollFailed(false);
  }, []);

  /** 폴링·재동기화용 조회. 겹쳐서 요청하지 않고, 사용자가 누른 동작이 진행 중이면 건너뛴다. */
  const refresh = useCallback(async () => {
    if (inFlightRef.current || busyRef.current) return;
    inFlightRef.current = true;
    const seq = ++seqRef.current;
    try {
      apply(await loungeApi.quick(), seq);
    } catch (err) {
      if (handleErrorRef.current(err)) return;
      if (stateRef.current) setPollFailed(true);
      else setLoadError(err instanceof Error ? err.message : '매칭 상태를 불러오지 못했어요.');
    } finally {
      inFlightRef.current = false;
    }
  }, [apply]);

  // 열려 있는 동안 5초마다, 탭이 다시 보이면 곧바로 확인한다.
  useEffect(() => {
    if (!open) return;
    setNotice(null);
    setActionError(null);
    setVoteHint(false);
    setPollFailed(false);
    setTick((n) => n + 1);
    // 지난 날짜가 남아 있거나 지나가 버린 시간 칩이 골라져 있으면 처음 값으로 되돌린다.
    setForm((f) => {
      const now = Date.now();
      if (f.date < todayKst(now)) return initialForm(now);
      const avail = availableBandKeys(f.date, now);
      return { ...f, bands: f.bands.filter((b) => avail.includes(b)) };
    });
    if (lastPendingRoomRef.current === null) lastPendingRoomRef.current = readLastRoom();
    void refresh();

    const poll = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const pollTimer = window.setInterval(poll, QUICK_POLL_MS);
    const clockTimer = window.setInterval(() => setTick((n) => n + 1), CLOCK_TICK_MS);
    document.addEventListener('visibilitychange', poll);
    return () => {
      window.clearInterval(pollTimer);
      window.clearInterval(clockTimer);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [open, refresh]);

  // 전원 수락으로 확정되면 호출한 쪽에 한 번만 알린다 (같은 모임 id 로는 다시 알리지 않는다).
  useEffect(() => {
    if (state?.room?.status !== 'confirmed') return;
    const gatheringId = state.gatheringId ?? state.room.gatheringId;
    if (gatheringId && confirmedNotifiedRef.current !== gatheringId) {
      confirmedNotifiedRef.current = gatheringId;
      onConfirmedRef.current?.(gatheringId);
    }
  }, [state]);

  const room = state?.room ?? null;
  const request = state?.request ?? null;
  const view: 'loading' | 'room' | 'done' | 'waiting' | 'form' = !state
    ? 'loading'
    : room?.status === 'pending'
      ? 'room'
      : room?.status === 'confirmed'
        ? 'done'
        : request && (request.status === 'waiting' || request.status === 'matched')
          ? 'waiting'
          : 'form';

  // 화면이 바뀌는 순간만 스크린 리더에 알린다 (처음 열 때의 첫 화면은 시트 제목이 대신 읽힌다).
  useEffect(() => {
    if (view === 'loading') return;
    const prev = prevViewRef.current;
    prevViewRef.current = view;
    if (prev === null || prev === view) return;
    if (view === 'room') setAnnounce('같이 먹을 사람을 찾았어요. 시간을 확인하고 수락이나 거절을 골라 주세요.');
    else if (view === 'done') setAnnounce('매칭이 확정됐어요.');
    else if (view === 'waiting') setAnnounce('같이 먹을 사람을 찾는 중이에요.');
    else if (prev === 'room') setAnnounce('후보 방이 없어졌어요.');
  }, [view]);
  useEffect(() => {
    if (!open) prevViewRef.current = null;
  }, [open]);

  // ───────────── 동작 ─────────────

  /** 사용자가 누른 동작 하나를 실행한다. 한 번에 하나만(중복 제출 방지), 실패하면 이유를 화면에 남긴다. */
  async function act(kind: Exclude<Busy, null>, failTitle: string, call: () => Promise<QuickState>): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = kind;
    setBusy(kind);
    setActionError(null);
    const seq = ++seqRef.current;
    let ok = false;
    let resync = false;
    try {
      apply(await call(), seq);
      ok = true;
    } catch (err) {
      if (!handleErrorRef.current(err)) {
        const message = err instanceof Error ? err.message : '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
        const code = err instanceof ApiError ? err.code : undefined;
        const soft = code === 'ALREADY_JOINED' || code === 'NOT_OPEN' || code === 'DEADLINE_PASSED' || code === 'RATE_LIMITED';
        setActionError({ title: failTitle, message, tone: soft ? 'warning' : 'danger' });
        // 이미 대기 중이거나 방이 끝난 경우: 화면이 서버와 어긋나 있다는 뜻이라 바로 다시 맞춘다.
        resync = code === 'ALREADY_JOINED' || code === 'NOT_OPEN' || code === 'DEADLINE_PASSED' || code === 'NOT_FOUND' || code === 'FORBIDDEN';
      }
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
    if (resync) void refresh();
    return ok;
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (validateForm(form, Date.now()).reason) return; // 막힌 이유는 버튼 옆에 이미 적혀 있다
    setNotice(null);
    const bands = TIME_BANDS.map((b) => b.key).filter((k) => form.bands.includes(k));
    void act('submit', '매칭을 시작하지 못했어요', () =>
      loungeApi.requestQuick({ date: form.date, placeType: form.placeType, size: form.size, bands, tags: form.tags }),
    );
  }

  function toggleVote(current: QuickRoomView, band: string) {
    if (busyRef.current) return;
    const mine = current.votes[state?.meId ?? ''] ?? [];
    // 서버는 가능한 시간이 0개인 투표를 거절한다. 눌러 보기 전에 알려 준다.
    if (mine.includes(band) && mine.length === 1) {
      setVoteHint(true);
      return;
    }
    setVoteHint(false);
    void act('vote', '가능한 시간을 바꾸지 못했어요', () => loungeApi.patchQuick({ roomId: current.id, bands: toggle(mine, band) }));
  }

  function accept(current: QuickRoomView) {
    void act('accept', '수락하지 못했어요', () => loungeApi.patchQuick({ roomId: current.id, answer: 'accepted' }));
  }

  /**
   * 확인창 안에서 도는 동작(거절·대기 취소·새로 신청)을 감싼다. 도는 동안 폴링이 끼어들어
   * 옛 상태를 새로 그리지 못하게 하고, 다른 동작이 겹쳐 실행되지 않게 한다.
   */
  async function exclusive(fn: () => Promise<void>): Promise<void> {
    busyRef.current = 'other';
    setBusy('other');
    try {
      await fn();
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  }

  async function decline(current: QuickRoomView) {
    if (busyRef.current) return;
    await confirm({
      title: '이 매칭을 거절할까요?',
      message: '거절하면 후보 방이 취소돼요. 나머지 분들은 다시 대기 상태로 돌아가요.',
      tone: 'danger',
      confirmLabel: '거절하기',
      cancelLabel: '돌아가기',
      run: () =>
        exclusive(async () => {
          declinedByMeRef.current = true;
          const seq = ++seqRef.current;
          try {
            apply(await loungeApi.patchQuick({ roomId: current.id, answer: 'declined' }), seq);
          } catch (err) {
            declinedByMeRef.current = false;
            throw err;
          }
        }),
    });
  }

  async function cancelWaiting() {
    if (busyRef.current) return;
    let resync = false;
    await confirm({
      title: '대기를 취소할까요?',
      message: '취소하면 지금까지 기다린 시간이 사라져요. 필요하면 다시 신청할 수 있어요.',
      tone: 'danger',
      confirmLabel: '대기 취소하기',
      cancelLabel: '계속 기다리기',
      run: () =>
        exclusive(async () => {
          const seq = ++seqRef.current;
          try {
            apply(await loungeApi.cancelQuick(), seq);
          } catch (err) {
            // 그 사이 이미 취소됐거나 후보 방이 만들어진 경우: 서버 상태를 다시 읽어 맞춘다.
            if (err instanceof ApiError && err.code === 'NOT_FOUND') {
              resync = true;
              return;
            }
            throw err;
          }
        }),
    });
    if (resync) void refresh();
  }

  /** 확정 안내를 닫고 새로 신청한다. 서버는 확정된 매칭이 남아 있으면 새 신청을 받지 않는다 (밥약 모임과 단톡방은 그대로 남는다). */
  async function startOver() {
    if (busyRef.current) return;
    await confirm({
      title: '새로 신청할까요?',
      message: '확정된 밥약과 단톡방은 그대로 남아요. 이 확정 안내만 닫고 새 빠른 매칭을 신청할 수 있어요.',
      confirmLabel: '새로 신청하기',
      cancelLabel: '돌아가기',
      run: () =>
        exclusive(async () => {
          const seq = ++seqRef.current;
          apply(await loungeApi.cancelQuick(), seq);
        }),
    });
  }

  // ───────────── 화면 ─────────────

  const now = Date.now();
  const problem = validateForm(form, now);
  const gatheringId = state ? (state.gatheringId ?? room?.gatheringId ?? null) : null;

  let footer: ReactNode = null;
  if (view === 'form') {
    footer = (
      <div className="lounge-quick-foot">
        {problem.reason && (
          <p className="lounge-quick-reason" id="lounge-quick-reason">
            <Icon name="info" />
            <span>{problem.reason}</span>
          </p>
        )}
        <Button
          type="submit"
          form="lounge-quick-form"
          variant="primary"
          block
          loading={busy === 'submit'}
          aria-disabled={problem.reason ? true : undefined}
          aria-describedby={problem.reason ? 'lounge-quick-reason' : undefined}
        >
          {busy === 'submit' ? '처리 중…' : '매칭 시작'}
        </Button>
      </div>
    );
  } else if (view === 'waiting') {
    footer = (
      <div className="lounge-quick-foot">
        <Button variant="tertiary" block onClick={() => void cancelWaiting()}>
          대기 취소
        </Button>
      </div>
    );
  } else if (view === 'room' && room && state) {
    const iAccepted = room.answers[state.meId] === 'accepted';
    footer = (
      <div className="lounge-quick-foot">
        <div className="lounge-quick-foot-row">
          <Button variant="danger" className="lounge-quick-foot-side" onClick={() => void decline(room)}>
            거절
          </Button>
          <Button
            variant="primary"
            loading={busy === 'accept'}
            aria-disabled={iAccepted || room.bands.length === 0 ? true : undefined}
            onClick={() => accept(room)}
          >
            {busy === 'accept' ? '처리 중…' : iAccepted ? '수락함' : '수락'}
          </Button>
        </div>
      </div>
    );
  } else if (view === 'done' && gatheringId) {
    footer = (
      <div className="lounge-quick-foot">
        <div className="lounge-quick-foot-row">
          <Button variant="secondary" onClick={() => setTableOpen(true)}>
            모임 보기
          </Button>
          <Button variant="primary" onClick={() => navigate(`/lounge/rooms/${gatheringId}`)}>
            단톡방 가기
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} title="빠른 매칭" footer={footer}>
        <div className="lounge-quick-body">
          <div className="sr-only" role="status">
            {announce}
          </div>

          {notice && (
            <Alert
              tone={notice === 'cancelled' ? 'warning' : 'info'}
              title={notice === 'cancelled' ? '매칭이 취소됐어요' : '매칭을 거절했어요'}
            >
              {notice === 'cancelled'
                ? view === 'waiting'
                  ? '누군가 거절했거나 시간이 지났어요. 같이 먹을 사람을 다시 찾고 있어요.'
                  : '누군가 거절했거나 시간이 지났어요. 다시 신청할 수 있어요.'
                : '필요하면 언제든 다시 신청할 수 있어요.'}
            </Alert>
          )}
          {actionError && (
            <Alert tone={actionError.tone} title={actionError.title}>
              {actionError.message}
            </Alert>
          )}

          {view === 'loading' &&
            (loadError ? (
              <Alert
                tone="danger"
                title="매칭 상태를 불러오지 못했어요"
                actions={
                  <Button variant="secondary" size="sm" onClick={() => void refresh()}>
                    다시 불러오기
                  </Button>
                }
              >
                {loadError}
              </Alert>
            ) : (
              <LoadingBlock>매칭 상태를 불러오는 중입니다.</LoadingBlock>
            ))}

          {view === 'form' && state && (
            <FormPanel
              form={form}
              setForm={setForm}
              nowMs={now}
              dateError={problem.dateError}
              waitingCount={state.waitingCount}
              busy={busy !== null}
              onSubmit={submit}
            />
          )}

          {view === 'waiting' && state && request && <WaitingPanel state={state} />}

          {view === 'room' && state && room && (
            <RoomPanel
              state={state}
              room={room}
              nowMs={now}
              busy={busy !== null}
              voteHint={voteHint}
              onToggleBand={(band) => toggleVote(room, band)}
            />
          )}

          {view === 'done' && state && room && <DonePanel state={state} room={room} onStartOver={() => void startOver()} />}

          {pollFailed && view !== 'loading' && (
            <p className="lounge-quick-poll-note" role="status">
              최신 상태를 불러오지 못했어요. 자동으로 다시 시도하고 있어요.
            </p>
          )}
        </div>
      </Sheet>

      {/* 확정 뒤 "모임 보기": 모임 상세 시트를 이 시트 위에 겹쳐 연다 (C2 의 TableSheet 계약 그대로) */}
      <TableSheet open={tableOpen} gatheringId={tableOpen ? gatheringId : null} onClose={() => setTableOpen(false)} />
    </>
  );
}

// ───────────── 조건 입력 ─────────────

function FormPanel({
  form,
  setForm,
  nowMs,
  dateError,
  waitingCount,
  busy,
  onSubmit,
}: {
  form: FormValues;
  setForm: (updater: (f: FormValues) => FormValues) => void;
  nowMs: number;
  dateError: string | null;
  waitingCount: number;
  busy: boolean;
  onSubmit: (e: FormEvent) => void;
}) {
  const avail = form.date >= todayKst(nowMs) ? availableBandKeys(form.date, nowMs) : [];
  const anyPast = avail.length < TIME_BANDS.length;

  return (
    <form id="lounge-quick-form" className="lounge-quick-form" noValidate onSubmit={onSubmit}>
      <div>
        <p className="lounge-quick-lead">조건만 고르면 맞는 사람을 찾아 드려요. 전원이 수락해야 약속이 확정돼요.</p>
        {waitingCount > 0 && <p className="lounge-quick-lead">지금 {waitingCount}명이 같이 먹을 사람을 기다리고 있어요.</p>}
      </div>

      <TextField
        label="날짜"
        type="date"
        required
        value={form.date}
        min={todayKst(nowMs)}
        error={dateError}
        onChange={(e) => {
          const date = e.target.value;
          // 날짜를 바꾸면 그 날 고를 수 없는 시간 칩은 골라진 채로 남지 않게 뺀다.
          const nextAvail = date >= todayKst(nowMs) ? availableBandKeys(date, nowMs) : [];
          setForm((f) => ({ ...f, date, bands: f.bands.filter((b) => nextAvail.includes(b)) }));
        }}
      />

      <Segmented<PlaceType>
        label="장소 종류"
        value={form.placeType}
        options={PLACE_TYPES.map((p) => ({ value: p, label: p }))}
        onChange={(placeType) => setForm((f) => ({ ...f, placeType }))}
      />

      <Segmented<string>
        label="인원"
        value={String(form.size)}
        options={MEAL_CAPACITY_OPTIONS.map((n) => ({ value: String(n), label: `${n}명` }))}
        onChange={(v) => setForm((f) => ({ ...f, size: Number(v) }))}
        help="나를 포함한 인원이에요."
      />

      <div className="field" role="group" aria-labelledby="lounge-quick-bands-label" aria-describedby="lounge-quick-bands-help">
        <span className="field__label" id="lounge-quick-bands-label">
          가능한 시간
          <span className="field__req" aria-hidden="true">
            *
          </span>
          <span className="sr-only"> 필수 입력 항목입니다</span>
        </span>
        <p className="field__help" id="lounge-quick-bands-help">
          여러 개 고를수록 빨리 매칭돼요.{anyPast && ' 이미 시작한 시간은 고를 수 없어요.'}
        </p>
        <div className="lounge-quick-bands">
          {TIME_BANDS.map((b) => {
            const past = !avail.includes(b.key);
            return (
              <button
                key={b.key}
                type="button"
                className="tag"
                aria-pressed={form.bands.includes(b.key)}
                disabled={past}
                aria-disabled={busy ? true : undefined}
                onClick={() => {
                  if (!busy) setForm((f) => ({ ...f, bands: toggle(f.bands, b.key) }));
                }}
              >
                {b.label}
                {past && <span className="lounge-quick-chip-why">이미 지났어요</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="field" role="group" aria-labelledby="lounge-quick-tags-label" aria-describedby="lounge-quick-tags-help">
        <span className="field__label" id="lounge-quick-tags-label">
          태그
        </span>
        <p className="field__help" id="lounge-quick-tags-help">
          고르지 않아도 돼요. &lsquo;같은 과만&rsquo;을 고르면 같은 학과끼리만 매칭돼요.
        </p>
        <div className="tag-group">
          {MEAL_TAGS.map((t) => (
            <button
              key={t}
              type="button"
              className="tag"
              aria-pressed={form.tags.includes(t)}
              onClick={() => {
                if (!busy) setForm((f) => ({ ...f, tags: toggle(f.tags, t) }));
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}

// ───────────── 대기 중 ─────────────

function WaitingPanel({ state }: { state: QuickState }) {
  const request = state.request!;
  return (
    <>
      <div className="lounge-quick-wait" role="status">
        <span className="spinner" aria-hidden="true" />
        <p className="lounge-quick-wait-title">같이 먹을 사람을 찾는 중…</p>
      </div>
      <p className="lounge-quick-lead">이 창을 닫아도 계속 찾고 있어요. 다시 열면 지금 상태를 보여 드려요.</p>
      <dl className="lounge-quick-summary">
        <dt>날짜</dt>
        <dd>{fmtDate(request.date)}</dd>
        <dt>장소 종류</dt>
        <dd>{request.placeType}</dd>
        <dt>인원</dt>
        <dd>나 포함 {request.size}명</dd>
        <dt>가능한 시간</dt>
        <dd>{request.bands.map(bandLabel).join(', ')}</dd>
        {request.tags.length > 0 && (
          <>
            <dt>태그</dt>
            <dd>{request.tags.join(', ')}</dd>
          </>
        )}
      </dl>
      <p className="lounge-quick-lead">지금 대기 중인 사람 {state.waitingCount}명</p>
    </>
  );
}

// ───────────── 후보 방 ─────────────

function MemberList({ state, room, showAnswers }: { state: QuickState; room: QuickRoomView; showAnswers: boolean }) {
  const byId = new Map<string, PublicUser>(state.members.map((m) => [m.id, m]));
  return (
    <ul className="lounge-quick-members">
      {room.memberIds.map((id) => {
        const user = byId.get(id);
        const accepted = room.answers[id] === 'accepted';
        return (
          <li key={id} className="lounge-quick-member">
            {user && <Avatar user={user} size="md" />}
            <div className="lounge-quick-member-text">
              <span className="lounge-quick-member-name">{user?.nickname ?? '(알 수 없음)'}</span>
              {id === state.meId && (
                <>
                  {' '}
                  <Badge tone="gray">나</Badge>
                </>
              )}
              {user && <div className="lounge-quick-member-college">{user.college}</div>}
            </div>
            {showAnswers && (
              <span className={`lounge-quick-member-state${accepted ? ' is-done' : ''}`}>
                {accepted ? (
                  <>
                    <Icon name="check" />
                    수락함
                  </>
                ) : (
                  '기다리는 중'
                )}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function RoomPanel({
  state,
  room,
  nowMs,
  busy,
  voteHint,
  onToggleBand,
}: {
  state: QuickState;
  room: QuickRoomView;
  nowMs: number;
  busy: boolean;
  voteHint: boolean;
  onToggleBand: (band: string) => void;
}) {
  const acceptedCount = room.memberIds.filter((id) => room.answers[id] === 'accepted').length;
  const iAccepted = room.answers[state.meId] === 'accepted';
  const myVotes = room.votes[state.meId] ?? [];
  const left = minutesLeft(room.expiresAt, nowMs);

  return (
    <>
      <div className="lounge-quick-room-head">
        <h3 className="lounge-quick-h lounge-quick-h-flush">같이 먹을 사람을 찾았어요</h3>
        <Badge tone="primary">
          수락 {acceptedCount}/{room.memberIds.length}
        </Badge>
      </div>

      {iAccepted && (
        <Alert tone="info" title="수락했어요">
          나머지 분들의 수락을 기다리고 있어요. 시간은 아래에서 계속 바꿀 수 있어요.
        </Alert>
      )}

      <dl className="lounge-quick-summary">
        <dt>날짜</dt>
        <dd>{fmtDate(room.date)}</dd>
        <dt>장소 종류</dt>
        <dd>{room.placeType}</dd>
        <dt>인원</dt>
        <dd>나 포함 {room.size}명</dd>
      </dl>

      <section aria-labelledby="lounge-quick-members-h">
        <h3 className="lounge-quick-h" id="lounge-quick-members-h">
          함께할 사람
        </h3>
        <MemberList state={state} room={room} showAnswers />
      </section>

      <div className="field" role="group" aria-labelledby="lounge-quick-vote-label" aria-describedby="lounge-quick-vote-help">
        <span className="field__label" id="lounge-quick-vote-label">
          가능한 시간
        </span>
        <p className="field__help" id="lounge-quick-vote-help">
          표가 가장 많은 시간으로 정해져요. 동점이면 이른 시간이에요.
        </p>
        {room.bands.length === 0 ? (
          <Alert tone="warning" title="함께 가능한 시간이 없어요">
            모두에게 겹치는 시간이 남아 있지 않아요. 거절하고 다른 조건으로 다시 신청해 주세요.
          </Alert>
        ) : (
          <div className="lounge-quick-bands">
            {room.bands.map((b) => {
              const votes = room.memberIds.filter((id) => (room.votes[id] ?? []).includes(b)).length;
              return (
                <button
                  key={b}
                  type="button"
                  className="tag"
                  aria-pressed={myVotes.includes(b)}
                  aria-disabled={busy ? true : undefined}
                  onClick={() => onToggleBand(b)}
                >
                  {bandLabel(b)}
                  <span className="lounge-quick-votes">{votes}표</span>
                </button>
              );
            })}
          </div>
        )}
        {voteHint && (
          <p className="field__error" role="status">
            <Icon name="alert" />
            <span>가능한 시간은 하나 이상 남겨 주세요.</span>
          </p>
        )}
      </div>

      <div className="lounge-quick-timer">
        {/* 분이 바뀔 때만 글자가 바뀌므로 읽어 주는 빈도는 분당 한 번 이하다 */}
        <span className="lounge-quick-timer-left" aria-live="polite" aria-atomic="true">
          {left === null ? '곧 취소돼요' : `남은 시간 ${left}분`}
        </span>
        <span>30분 안에 전원이 수락하지 않으면 매칭이 취소돼요.</span>
      </div>
    </>
  );
}

// ───────────── 확정 ─────────────

function DonePanel({ state, room, onStartOver }: { state: QuickState; room: QuickRoomView; onStartOver: () => void }) {
  const band = decidedBand(room);
  return (
    <>
      <Alert tone="success" title="매칭이 확정됐어요">
        밥약이 목록에 추가됐어요. 시간·장소를 한 번 더 확인해 주세요.
      </Alert>
      <dl className="lounge-quick-summary">
        <dt>날짜</dt>
        <dd>{fmtDate(room.date)}</dd>
        {band && (
          <>
            <dt>정해진 시간</dt>
            <dd>{bandLabel(band)}</dd>
          </>
        )}
        <dt>장소 종류</dt>
        <dd>{room.placeType}</dd>
        <dt>인원</dt>
        <dd>나 포함 {room.size}명</dd>
      </dl>
      <section aria-labelledby="lounge-quick-done-members-h">
        <h3 className="lounge-quick-h" id="lounge-quick-done-members-h">
          함께하는 사람
        </h3>
        <MemberList state={state} room={room} showAnswers={false} />
      </section>
      <div>
        <Button variant="text" onClick={onStartOver}>
          다른 밥약 새로 신청하기
        </Button>
      </div>
    </>
  );
}
