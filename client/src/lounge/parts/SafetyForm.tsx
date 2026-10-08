import { useEffect, useRef, useState } from 'react';
import { REPORT_DETAIL_MAX, REPORT_REASONS } from '../../../../shared/lounge';
import type { PublicUser, ReportReason } from '../../../../shared/lounge';
import { ApiError } from '../../api';
import { Alert, Button, SelectField, useConfirm } from '../../ui';
import { loungeApi } from '../api';
import { useLounge } from '../LoungeContext';
import TextAreaField from './TextAreaField';
import '../gathering.css';

/**
 * 신고 · 차단 폼 조각. 사용자 카드(UserSheet)와 테이블 시트(TableSheet)가 같이 쓴다.
 *
 * 왜 이렇게: 차단은 되돌리기 번거롭고 상대에게 알리지 않는 동작이라 확인 창을 거치고,
 * 신고는 관리자만 보는 기록이라 사유와 자세한 내용을 받는다. 두 동작은 서로 독립이라 한 화면에 나란히 둔다.
 * 대상이 바뀌면(target.id) 입력과 결과 문구를 비운다 — 다른 사람에게 쓴 내용이 남지 않게.
 */
export type SafetyFormProps = {
  /** 신고·차단할 사람 (나 자신은 호출한 쪽에서 걸러서 넘긴다) */
  target: PublicUser;
  /** 어디서 신고했는지: profile / meetup / meal / chat … (서버가 영문·숫자 모양만 받는다) */
  context: string;
  /** 관련 모임 id 등. 없으면 null */
  refId: string | null;
  onReported?: (target: PublicUser) => void;
  /** 차단이 끝났을 때(서버 반영 후). 호출한 쪽이 화면을 닫거나 새로 고친다. */
  onBlocked?: (target: PublicUser) => void;
};

export default function SafetyForm({ target, context, refId, onReported, onBlocked }: SafetyFormProps) {
  const confirm = useConfirm();
  const { handleError } = useLounge();
  const [reason, setReason] = useState<ReportReason>(REPORT_REASONS[0]);
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [problem, setProblem] = useState<{ tone: 'danger' | 'warning'; text: string } | null>(null);
  const [reported, setReported] = useState(false);

  useEffect(() => {
    setReason(REPORT_REASONS[0]);
    setDetail('');
    setProblem(null);
    setReported(false);
  }, [target.id]);

  async function report() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setProblem(null);
    setReported(false);
    try {
      await loungeApi.report({ userId: target.id, context, refId, reason, detail: detail.trim() });
      setReported(true);
      setDetail('');
      onReported?.(target);
    } catch (err) {
      if (handleError(err)) return;
      const message = err instanceof Error ? err.message : '요청을 처리하지 못했어요.';
      // 같은 건을 이미 신고했다면 실패가 아니라 "접수돼 있어요" 안내다.
      const already = err instanceof ApiError && message.includes('이미 신고');
      setProblem({
        tone: already ? 'warning' : 'danger',
        text: already ? message : `신고하지 못했어요. ${message}`,
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function block() {
    const ok = await confirm({
      title: `${target.nickname} 님을 차단할까요?`,
      message: '서로의 모임과 매칭에서 사라져요. 상대에게는 알리지 않아요. 차단 목록에서 언제든 풀 수 있어요.',
      tone: 'danger',
      confirmLabel: '차단하기',
      cancelLabel: '돌아가기',
      run: async () => {
        await loungeApi.block(target.id);
      },
    });
    if (ok) onBlocked?.(target);
  }

  return (
    <div className="lounge-gath-safety">
      <section className="lounge-gath-safety__block" aria-labelledby={`safety-report-${target.id}`}>
        <h3 className="lounge-gath-h3" id={`safety-report-${target.id}`}>
          신고하기
        </h3>
        <p className="text-sub text-sm lounge-gath-safety__lead">
          불편했던 일을 알려 주세요. 신고는 관리자가 확인하고, 상대에게는 알리지 않아요.
        </p>
        <SelectField
          label="신고 사유"
          value={reason}
          onChange={(e) => setReason(e.target.value as ReportReason)}
          disabled={busy}
        >
          {REPORT_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </SelectField>
        <TextAreaField
          label="자세한 내용 (선택)"
          help="관리자만 볼 수 있어요."
          value={detail}
          maxLength={REPORT_DETAIL_MAX}
          onChange={(e) => setDetail(e.target.value)}
          disabled={busy}
        />
        {problem && (
          <div className="lounge-gath-gap">
            <Alert tone={problem.tone}>{problem.text}</Alert>
          </div>
        )}
        {reported && (
          <div className="lounge-gath-gap">
            <Alert tone="success">
              신고했어요. 관리자가 확인해요. 마주치고 싶지 않다면 아래에서 차단할 수도 있어요.
            </Alert>
          </div>
        )}
        <Button variant="secondary" block loading={busy} onClick={report}>
          {busy ? '신고하는 중…' : '신고하기'}
        </Button>
      </section>

      <section className="lounge-gath-safety__block" aria-labelledby={`safety-block-${target.id}`}>
        <h3 className="lounge-gath-h3" id={`safety-block-${target.id}`}>
          차단하기
        </h3>
        <p className="text-sub text-sm lounge-gath-safety__lead">
          서로의 모임과 매칭에서 사라져요. 상대에게는 알리지 않아요.
        </p>
        <Button variant="danger" block onClick={block} disabled={busy}>
          차단하기
        </Button>
      </section>
    </div>
  );
}
