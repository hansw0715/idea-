'use client';

/**
 * 미팅/밥약 공용 카드. (담당: 한승원)
 *
 * 두 기능의 화면이 거의 같아서 컴포넌트도 하나로 뒀다. 갈라지는 건 두 군데뿐:
 *  - joinPolicy 'auto'      → 빈 의자를 눌러 바로 앉는다 (미팅)
 *  - joinPolicy 'approval'  → 한 줄 남기고 신청 → 주최자가 승인 (밥약)
 * 팀빌딩(kind: 'team')도 승인제라서 그대로 재사용할 수 있다.
 */
import { useState } from 'react';
import { act, ApiError } from '@/lib/api';
import { formatMeetAt, timeLeft } from '@/lib/format';
import type { GatheringView, PublicUser, SlotView } from '@/shared/view';

type Props = {
  gathering: GatheringView;
  onChange: (next: GatheringView) => void;
};

const STATUS_BADGE: Record<GatheringView['status'], { label: string; className: string }> = {
  open: { label: '모집 중', className: 'bg-brand-soft text-brand' },
  full: { label: '마감', className: 'bg-surface-muted text-muted' },
  closed: { label: '신청 마감', className: 'bg-surface-muted text-muted' },
  cancelled: { label: '취소됨', className: 'bg-surface-muted text-muted line-through' },
  done: { label: '종료', className: 'bg-surface-muted text-muted' },
};

export function GatheringCard({ gathering: g, onChange }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [message, setMessage] = useState('');

  async function run(action: string, body?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      onChange(await act(g.id, action, body));
      setApplyOpen(false);
      setMessage('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '문제가 생겼어요. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  const badge = STATUS_BADGE[g.status];
  const dimmed = g.status === 'cancelled' || g.status === 'done';

  return (
    <article
      className={`rounded-2xl border border-border bg-surface p-4 shadow-sm ${dimmed ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-2">
        <Avatar user={g.host} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {g.host.nickname}
            <span className="ml-1 font-normal text-muted">· {g.host.college}</span>
          </p>
          <p className="text-[11px] text-muted">
            {g.host.admissionYear % 100}학번 · 신뢰도 {g.host.trustScore}
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}>
          {badge.label}
        </span>
      </div>

      <h3 className="mt-3 text-[15px] font-bold leading-snug">{g.title}</h3>
      {g.body && <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{g.body}</p>}

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[13px]">
        <dt className="text-muted">📍 장소</dt>
        <dd>{g.place}</dd>
        <dt className="text-muted">🕒 시간</dt>
        <dd>{formatMeetAt(g.meetAt)}</dd>
        <dt className="text-muted">⏳ 신청</dt>
        <dd className={g.status === 'open' ? 'font-semibold text-accent' : ''}>
          {timeLeft(g.joinDeadline)}
        </dd>
      </dl>

      <div className={`mt-3 grid gap-2 ${g.slots.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {g.slots.map((slot) => (
          <SlotBox
            key={slot.key}
            slot={slot}
            gathering={g}
            busy={busy}
            onSit={(slotKey) => run('join', { slotKey })}
          />
        ))}
      </div>

      {g.viewer.blockedReason && !g.viewer.isHost && (
        <p className="mt-3 rounded-lg bg-surface-muted px-3 py-2 text-[12px] text-muted">
          {g.viewer.blockedReason}
        </p>
      )}

      {g.viewer.canApply && !applyOpen && (
        <button
          type="button"
          onClick={() => setApplyOpen(true)}
          className="mt-3 w-full rounded-xl bg-brand py-2.5 text-sm font-semibold text-white"
        >
          참여 신청하기
        </button>
      )}

      {applyOpen && (
        <div className="mt-3 space-y-2">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            placeholder="주최자에게 한마디 (예: 저도 상상관에서 출발해요!)"
            className="w-full resize-none rounded-xl border border-border bg-surface-muted px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => run('apply', { slotKey: g.slots[0].key, message })}
              className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              신청 보내기
            </button>
            <button
              type="button"
              onClick={() => setApplyOpen(false)}
              className="rounded-xl border border-border px-4 text-sm text-muted"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {g.viewer.canLeave && (
        <button
          type="button"
          disabled={busy}
          onClick={() => run('leave')}
          className="mt-3 w-full rounded-xl border border-border py-2.5 text-sm font-semibold text-muted disabled:opacity-50"
        >
          참여 취소
        </button>
      )}

      {g.viewer.isApplicant && (
        <button
          type="button"
          disabled={busy}
          onClick={() => run('leave')}
          className="mt-3 w-full rounded-xl border border-border py-2.5 text-sm font-semibold text-muted disabled:opacity-50"
        >
          신청 취소
        </button>
      )}

      {g.viewer.isHost && <HostPanel gathering={g} busy={busy} run={run} />}

      {error && <p className="mt-3 text-[12px] font-medium text-red-500">{error}</p>}
    </article>
  );
}

// ---------- 자리 ----------

function SlotBox({
  slot,
  gathering: g,
  busy,
  onSit,
}: {
  slot: SlotView;
  gathering: GatheringView;
  busy: boolean;
  onSit: (slotKey: string) => void;
}) {
  const emptySeats = Array.from({ length: slot.seatsLeft });

  return (
    <div className="rounded-xl bg-surface-muted p-2.5">
      <p className="mb-2 text-[11px] font-semibold text-muted">
        {slot.label} {slot.members.length}/{slot.capacity}
      </p>
      <ul className="space-y-1.5">
        {slot.members.map((m) => (
          <li key={m.id} className="flex items-center gap-1.5">
            <Avatar user={m} size="sm" />
            <span className="truncate text-[12px] font-medium">{m.nickname}</span>
            {m.id === g.host.id && <span className="text-[10px] text-muted">주최</span>}
            {g.attendance[m.id] === 'noshow' && (
              <span className="rounded bg-red-500/15 px-1 text-[10px] font-semibold text-red-500">
                노쇼
              </span>
            )}
          </li>
        ))}

        {emptySeats.map((_, i) => (
          <li key={`empty-${i}`}>
            {g.viewer.canJoin ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onSit(slot.key)}
                className="w-full rounded-lg border border-dashed border-brand py-1.5 text-[12px] font-semibold text-brand disabled:opacity-50"
              >
                + 앉기
              </button>
            ) : (
              <div className="rounded-lg border border-dashed border-border py-1.5 text-center text-[12px] text-muted">
                빈자리
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- 주최자 전용 ----------

function HostPanel({
  gathering: g,
  busy,
  run,
}: {
  gathering: GatheringView;
  busy: boolean;
  run: (action: string, body?: Record<string, unknown>) => void;
}) {
  const members = g.slots.flatMap((s) => s.members).filter((m) => m.id !== g.host.id);

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-dashed border-brand/40 p-3">
      <p className="text-[11px] font-bold text-brand">주최자 메뉴</p>

      {g.applicants.length > 0 && (
        <ul className="space-y-2">
          {g.applicants.map((a) => (
            <li key={a.user.id} className="rounded-lg bg-surface-muted p-2">
              <div className="flex items-center gap-1.5">
                <Avatar user={a.user} size="sm" />
                <span className="text-[12px] font-semibold">{a.user.nickname}</span>
                <span className="text-[11px] text-muted">
                  {a.user.college} · 신뢰도 {a.user.trustScore}
                </span>
              </div>
              {a.message && <p className="mt-1 text-[12px] text-muted">“{a.message}”</p>}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run('approve', { userId: a.user.id })}
                  className="flex-1 rounded-lg bg-brand py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                >
                  수락
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run('reject', { userId: a.user.id })}
                  className="flex-1 rounded-lg border border-border py-1.5 text-[12px] font-semibold text-muted disabled:opacity-50"
                >
                  거절
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {g.joinPolicy === 'approval' && g.applicants.length === 0 && g.status === 'open' && (
        <p className="text-[12px] text-muted">아직 신청자가 없어요.</p>
      )}

      {/* 노쇼 관리 연동 지점 — 여기서 찍은 결과가 이벤트로 나가 신뢰도를 깎는다 */}
      {g.viewer.canMarkAttendance && members.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold text-muted">출결 체크</p>
          <ul className="space-y-1.5">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-2">
                <span className="flex-1 truncate text-[12px]">{m.nickname}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run('attendance', { userId: m.id, mark: 'attended' })}
                  className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${
                    g.attendance[m.id] === 'attended'
                      ? 'bg-brand text-white'
                      : 'border border-border text-muted'
                  }`}
                >
                  참석
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run('attendance', { userId: m.id, mark: 'noshow' })}
                  className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${
                    g.attendance[m.id] === 'noshow'
                      ? 'bg-red-500 text-white'
                      : 'border border-border text-muted'
                  }`}
                >
                  노쇼
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {g.status === 'open' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => run('cancel')}
          className="w-full rounded-lg border border-border py-2 text-[12px] font-semibold text-muted disabled:opacity-50"
        >
          모임 취소
        </button>
      )}
    </div>
  );
}

function Avatar({ user, size = 'md' }: { user: PublicUser; size?: 'sm' | 'md' }) {
  const px = size === 'sm' ? 'h-5 w-5 text-[10px]' : 'h-8 w-8 text-xs';
  return (
    <span
      className={`${px} flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-bold text-brand`}
    >
      {user.nickname.slice(0, 1)}
    </span>
  );
}
