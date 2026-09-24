'use client';

/**
 * 밥약 빠른 매칭. (담당: 한승원)
 *
 * 조건만 걸어두고 기다리다가 → 사람이 모이면 후보 방이 뜨고 → 가능한 시간을 체크하고
 * **전원이 수락**하면 밥약이 확정된다. 확정되면 아래 목록에 보통 밥약처럼 나타난다.
 */
import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, Field, Input, Select, cx } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { answerQuick, cancelQuick, fetchQuick, requestQuick, voteQuick } from '@/lib/meal-api';
import { MEAL_CAPACITY_OPTIONS, MEAL_TAGS, PLACE_TYPES, TIME_BANDS, timeBand, type PlaceType } from '@/features/mealdate/preset';
import { FREE_TIME_READY } from '@/features/facility/free-time';
import type { QuickState } from '@/features/mealdate/service';

/** 오늘 날짜(한국 기준)를 input[type=date] 값으로 */
function todayKst(): string {
  const k = new Date(Date.now() + 9 * 3600_000);
  return k.toISOString().slice(0, 10);
}

export function QuickMatchPanel({ onConfirmed }: { onConfirmed: () => void }) {
  const [state, setState] = useState<QuickState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [date, setDate] = useState(todayKst());
  const [placeType, setPlaceType] = useState<PlaceType>('학식');
  const [size, setSize] = useState(2);
  const [bands, setBands] = useState<string[]>(['b12']);
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    fetchQuick()
      .then(setState)
      .catch(() => setError('매칭 상태를 불러오지 못했어요.'));
  }, []);

  // 후보 방이 생겼는지, 남들이 수락했는지 보려면 주기적으로 확인해야 한다.
  useEffect(() => {
    const t = setInterval(() => {
      fetchQuick()
        .then(setState)
        .catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, []);

  async function run(action: () => Promise<QuickState>) {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      setState(next);
      if (next.room?.status === 'confirmed') onConfirmed();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '문제가 생겼어요.');
    } finally {
      setBusy(false);
    }
  }

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  if (!state) return <div className="h-40 animate-pulse rounded-lg bg-surface-muted" />;

  const room = state.room;
  const request = state.request;

  return (
    <div className="space-y-3">
      {error && <Badge tone="danger">{error}</Badge>}

      {room && room.status === 'pending' && (
        <RoomCard state={state} busy={busy} onVote={(b) => run(() => voteQuick(room.id, b))} onAnswer={(a) => run(() => answerQuick(room.id, a))} />
      )}

      {room?.status === 'confirmed' && (
        <Card className="space-y-2 border-success">
          <Badge tone="success">매칭 확정!</Badge>
          <p className="text-sm">아래 목록에 밥약이 추가됐어요. 시간·장소를 한 번 더 확인해 주세요.</p>
        </Card>
      )}

      {room?.status === 'cancelled' && (
        <Card className="space-y-2">
          <Badge tone="danger">매칭이 취소됐어요</Badge>
          <p className="text-sm text-muted">누군가 거절했거나 시간이 지났어요. 다시 신청할 수 있어요.</p>
        </Card>
      )}

      {request?.status === 'waiting' && (
        <Card className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 animate-pulse rounded-pill bg-brand" />
            <p className="text-sm font-semibold">같이 먹을 사람을 찾는 중…</p>
          </div>
          <p className="text-xs text-muted">
            {request.date} · {request.placeType} · {request.size}명 ·{' '}
            {request.bands.map((b) => timeBand(b)?.label).filter(Boolean).join(', ')}
          </p>
          <p className="text-xs text-muted">지금 대기 중인 사람 {state.waitingCount}명</p>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => run(cancelQuick)}>
            대기 취소
          </Button>
        </Card>
      )}

      {(!request || request.status === 'cancelled' || room?.status === 'cancelled' || room?.status === 'confirmed') && (
        <Card className="space-y-3">
          <div>
            <h3 className="text-sm font-bold">빠른 매칭</h3>
            <p className="text-xs text-muted">조건만 고르면 맞는 사람을 찾아 드려요. 전원이 수락해야 확정돼요.</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="날짜">
              <Input type="date" value={date} min={todayKst()} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="장소">
              <Select value={placeType} onChange={(e) => setPlaceType(e.target.value as PlaceType)}>
                {PLACE_TYPES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="인원" hint="나를 포함한 인원이에요.">
            <div className="grid grid-cols-3 gap-2">
              {MEAL_CAPACITY_OPTIONS.map((n) => (
                <Chip key={n} active={size === n} onClick={() => setSize(n)}>
                  {n}명
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="가능한 시간" hint="여러 개 고를수록 빨리 매칭돼요.">
            <div className="grid grid-cols-3 gap-2">
              {TIME_BANDS.map((b) => (
                <Chip key={b.key} active={bands.includes(b.key)} onClick={() => setBands(toggle(bands, b.key))}>
                  {b.label}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="태그" hint="'같은 과만'을 고르면 같은 학과끼리만 매칭돼요.">
            <div className="flex flex-wrap gap-1.5">
              {MEAL_TAGS.map((t) => (
                <Chip key={t} small active={tags.includes(t)} onClick={() => setTags(toggle(tags, t))}>
                  {t}
                </Chip>
              ))}
            </div>
          </Field>

          {!FREE_TIME_READY && (
            <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-muted">
              내 공강 시간에 맞춰 추천하는 기능은 시설 예약(공강 계산)이 붙으면 켜져요.
            </p>
          )}

          <Button
            block
            disabled={busy || bands.length === 0}
            onClick={() => run(() => requestQuick({ date, placeType, size, bands, tags }))}
          >
            매칭 시작
          </Button>
        </Card>
      )}
    </div>
  );
}

function RoomCard({
  state,
  busy,
  onVote,
  onAnswer,
}: {
  state: QuickState;
  busy: boolean;
  onVote: (bands: string[]) => void;
  onAnswer: (answer: 'accepted' | 'declined') => void;
}) {
  const room = state.room!;
  const me = state.request?.userId ?? '';
  const myVotes = room.votes[me] ?? [];
  const accepted = room.memberIds.filter((id) => room.answers[id] === 'accepted').length;
  const iAccepted = room.answers[me] === 'accepted';

  return (
    <Card className="space-y-3 border-brand">
      <div className="flex items-center justify-between">
        <Badge tone="brand">매칭됐어요!</Badge>
        <span className="text-xs text-muted">
          수락 {accepted}/{room.memberIds.length}
        </span>
      </div>

      <p className="text-sm">
        {room.date} · {room.placeType} · {room.size}명
      </p>

      <ul className="flex flex-wrap gap-1.5">
        {state.members.map((m) => (
          <li key={m.id} className="rounded-pill bg-surface-muted px-2 py-1 text-xs">
            {m.nickname} <span className="text-muted">{m.college}</span>
            {room.answers[m.id] === 'accepted' && <span className="ml-1 text-success">✓</span>}
          </li>
        ))}
      </ul>

      <Field label="가능한 시간" hint="표가 가장 많은 시간으로 정해져요. 동점이면 이른 시간이에요.">
        <div className="grid grid-cols-3 gap-2">
          {room.bands.map((b) => (
            <Chip
              key={b}
              active={myVotes.includes(b)}
              onClick={() => onVote(myVotes.includes(b) ? myVotes.filter((v) => v !== b) : [...myVotes, b])}
            >
              {timeBand(b)?.label ?? b}
              <span className="ml-1 text-[10px] opacity-70">
                {room.memberIds.filter((id) => (room.votes[id] ?? []).includes(b)).length}표
              </span>
            </Chip>
          ))}
        </div>
      </Field>

      {room.bands.length === 0 && <EmptyState title="겹치는 시간이 없어요" />}

      <div className="flex gap-2">
        <Button block disabled={busy || iAccepted} onClick={() => onAnswer('accepted')}>
          {iAccepted ? '수락함 · 나머지 기다리는 중' : '수락'}
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => onAnswer('declined')}>
          거절
        </Button>
      </div>
      <p className="text-center text-[11px] text-muted">30분 안에 전원이 수락하지 않으면 매칭이 취소돼요.</p>
    </Card>
  );
}

function Chip({
  active,
  small,
  onClick,
  children,
}: {
  active: boolean;
  small?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'rounded-md border font-semibold transition',
        small ? 'px-2 py-1 text-[11px]' : 'py-2 text-sm',
        active ? 'border-brand bg-brand text-white' : 'border-border text-muted hover:bg-surface-muted',
      )}
    >
      {children}
    </button>
  );
}
