'use client';

/**
 * 신고 · 차단. 미팅·밥약 카드에서 공통으로 쓴다. (담당: 한승원)
 *
 * 차단하면 서로의 글과 매칭에서 사라지고, 신고는 서로 다른 3명이 쌓이면 자동으로 이용이 막힌다.
 * 상대에게는 알리지 않는다 — 알림이 가면 보복이 무서워서 아무도 안 누른다.
 */
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Field, Modal, Select, Textarea } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { blockUser, reportUser } from '@/lib/meal-api';
import { REPORT_REASONS, type ReportReason } from '@/domain/safety/safety';
import type { PublicUser } from '@/shared/view';

type Props = {
  /** 신고·차단 대상 후보 (주최자와 참여자) */
  people: PublicUser[];
  context: string;
  refId: string;
  /** 나 자신은 목록에서 빼려고 */
  meId: string | null;
};

export function SafetyMenu({ people, context, refId, meId }: Props) {
  const [open, setOpen] = useState(false);
  const targets = people.filter((p) => p.id !== meId);
  if (targets.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="신고 또는 차단"
        className="rounded-sm px-2 text-muted hover:bg-surface-muted"
      >
        ⋯
      </button>
      <SafetyModal open={open} onClose={() => setOpen(false)} targets={targets} context={context} refId={refId} />
    </>
  );
}

function SafetyModal({
  open,
  onClose,
  targets,
  context,
  refId,
}: {
  open: boolean;
  onClose: () => void;
  targets: PublicUser[];
  context: string;
  refId: string;
}) {
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');
  const [reason, setReason] = useState<ReportReason>(REPORT_REASONS[0]);
  const [detail, setDetail] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      await action();
      setMsg({ ok: true, text: okText });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : '처리에 실패했어요.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="신고 · 차단">
      <div className="space-y-3">
        <Field label="대상">
          <Select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nickname} ({t.college})
              </option>
            ))}
          </Select>
        </Field>

        <Field label="신고 사유">
          <Select value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}>
            {REPORT_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="자세한 내용" hint="관리자만 볼 수 있어요.">
          <Textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} />
        </Field>

        {msg && <Badge tone={msg.ok ? 'success' : 'danger'}>{msg.text}</Badge>}

        <div className="flex gap-2">
          <Button
            block
            disabled={busy || !targetId}
            onClick={() => run(() => reportUser({ userId: targetId, context, refId, reason, detail }), '신고했어요. 관리자가 확인할게요.')}
          >
            신고하기
          </Button>
          <Button
            variant="danger"
            disabled={busy || !targetId}
            onClick={() => run(() => blockUser(targetId), '차단했어요. 서로의 글에서 사라져요.')}
          >
            차단
          </Button>
        </div>
        <p className="text-[11px] text-muted">
          차단하면 서로의 모임과 매칭에서 사라져요. 상대에게는 알리지 않아요.{' '}
          <Link href="/blocks" className="underline">
            차단 목록 보기
          </Link>
        </p>
      </div>
    </Modal>
  );
}
