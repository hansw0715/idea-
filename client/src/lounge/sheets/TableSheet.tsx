import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { REVIEW_LABEL, admissionLabel, formatMeetAt, timeLeft } from '../../../../shared/lounge';
import type {
  GatheringAction,
  GatheringActionBody,
  GatheringView,
  PublicUser,
  ReviewMark,
  SlotView,
} from '../../../../shared/lounge';
import { ApiError } from '../../api';
import { Alert, Badge, Button, EmptyState, Icon, LoadingBlock, SelectField, Sheet, useConfirm, useToast } from '../../ui';
import { loungeApi } from '../api';
import { useLounge } from '../LoungeContext';
import Avatar, { TemperatureBadge } from '../parts/Avatar';
import InlineNotice from '../parts/InlineNotice';
import { KIND_ICON, KIND_LABEL, STATUS_BADGE, relationBadge } from '../parts/GatheringListItem';
import SafetyForm from '../parts/SafetyForm';
import TextAreaField from '../parts/TextAreaField';
import UserSheet from './UserSheet';
import '../gathering.css';

/**
 * 테이블(모임) 상세 시트 — 자리·신청·승인·참여 취소·모임 취소·모임 후 평가·단톡방 입장·신고/차단.
 * 담당: 작업 C2.
 *
 * 계약(props)은 바꾸지 말고, 필요하면 선택(optional) props 만 추가한다.
 *  - gatheringId: 열 모임 id. 시트는 직접 loungeApi.gathering(id) 으로 불러온다. 열린 동안 5초마다 새로고침한다.
 *  - initial: 이미 가진 view 가 있으면 먼저 보여 주고(깜빡임 방지) 뒤에서 새로고침한다.
 *  - focusSlotKey: 빈 의자를 눌러 열렸다면 그 자리 키. 선택돼 있고 "여기에 앉기" 버튼이 바로 보여야 한다(실수로 확정되지 않게 항상 확인 버튼을 거친다).
 *  - onChanged: 참여·취소·승인 등으로 모임이 바뀔 때마다 최신 view 를 알린다 (지도·목록이 즉시 갱신된다).
 *  - 단톡방 입장 버튼은 `navigate('/lounge/rooms/:id')` (react-router).
 *  - (추가, 선택) onSafetyChanged: 이 시트에서 차단·신고를 했을 때. 차단으로 모임이 아예 안 보이게 되면
 *    onChanged 로 알릴 view 가 없으므로 이쪽으로 알려 지도·목록이 다시 읽게 한다.
 */
export type TableSheetProps = {
  open: boolean;
  gatheringId: string | null;
  initial?: GatheringView | null;
  /** 지도에서 빈 의자를 눌러 열었을 때 그 자리(slot key)를 미리 선택해 둔다 (작업 C1 이 넘긴다) */
  focusSlotKey?: string | null;
  onClose: () => void;
  onChanged?: (g: GatheringView) => void;
  onSafetyChanged?: () => void;
};

const POLL_MS = 5000;
const NOTICE_MS = 6000;
const MARKS: ReviewMark[] = ['good', 'soso', 'noshow'];
const APPLY_MAX = 200;

type Phase = 'loading' | 'ready' | 'missing' | 'error';
type Problem = { title: string; text: string };

/** 사람 목록에서 같은 id 를 한 번만 (주최자는 자리에도 앉아 있다) */
function uniquePeople(list: PublicUser[]): PublicUser[] {
  const byId = new Map<string, PublicUser>();
  for (const p of list) if (!byId.has(p.id)) byId.set(p.id, p);
  return [...byId.values()];
}

export default function TableSheet({
  open,
  gatheringId,
  initial = null,
  focusSlotKey = null,
  onClose,
  onChanged,
  onSafetyChanged,
}: TableSheetProps) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const { handleError, needsProfile } = useLounge();

  const [g, setG] = useState<GatheringView | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pollFailed, setPollFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyText, setApplyText] = useState('');
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [safetyTargetId, setSafetyTargetId] = useState('');
  const [cardUserId, setCardUserId] = useState<string | null>(null);

  // 폴링·비동기 응답에서 최신 값을 읽으려고 ref 에 둔다 (setInterval 안에서는 렌더 때의 값이 낡는다)
  const gRef = useRef<GatheringView | null>(null);
  const busyRef = useRef(false);
  /** 응답 순서표. 새 요청·동작을 시작할 때 올려서, 그보다 먼저 시작한 응답이 늦게 와도 덮어쓰지 못하게 한다. */
  const seq = useRef(0);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const onSafetyRef = useRef(onSafetyChanged);
  onSafetyRef.current = onSafetyChanged;
  const focusKeyRef = useRef(focusSlotKey);
  focusKeyRef.current = focusSlotKey;
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const rootRef = useRef<HTMLDivElement>(null);
  const seatFocusRef = useRef<HTMLButtonElement | null>(null);
  /** 열릴 때 한 번만: 선택한 자리로 스크롤하고, 승인제면 신청 칸을 연다 */
  const arrivedRef = useRef(false);

  /** 최신 view 를 화면에 반영. notify=true 면 호출한 쪽(지도·목록)에도 알린다. */
  function commit(next: GatheringView, notify: boolean) {
    const prev = gRef.current;
    gRef.current = next;
    setG(next);
    setPhase('ready');
    setLoadError(null);
    setPollFailed(false);
    if (notify) onChangedRef.current?.(next);
    // 폴링으로 남이 바꾼 내용도 지도에 반영되게, 달라졌을 때만 알린다.
    else if (prev && JSON.stringify(prev) !== JSON.stringify(next)) onChangedRef.current?.(next);
  }

  /** 서버에서 다시 읽기 (폴링·오류 뒤 새로고침 공용) */
  async function pull(id: string): Promise<void> {
    const mine = ++seq.current;
    try {
      const next = await loungeApi.gathering(id);
      if (mine !== seq.current) return;
      commit(next, false);
    } catch (err) {
      if (mine !== seq.current) return;
      if (err instanceof ApiError && err.status === 404) {
        setPhase('missing');
        return;
      }
      // 프로필이 없으면 프로필 시트가 위에 열린다. 이 시트는 아래에서 안내만 남기고, 프로필을 만들면 다시 불러온다.
      handleError(err);
      const message = err instanceof Error ? err.message : '모임을 불러오지 못했어요.';
      if (gRef.current) setPollFailed(true);
      else {
        setLoadError(message);
        setPhase('error');
      }
    }
  }

  // 열릴 때: 초기값으로 먼저 그리고 곧바로 새로 읽는다. 열려 있는 동안 5초마다 다시 읽는다(탭이 보일 때만).
  useEffect(() => {
    if (!open || !gatheringId) return;
    const id = gatheringId;
    const seed = initialRef.current && initialRef.current.id === id ? initialRef.current : null;
    gRef.current = seed;
    setG(seed);
    setPhase(seed ? 'ready' : 'loading');
    setLoadError(null);
    setPollFailed(false);
    setProblem(null);
    setNotice(null);
    setApplyOpen(false);
    setApplyText('');
    setSafetyOpen(false);
    setSafetyTargetId('');
    setCardUserId(null);
    setSelected(focusKeyRef.current);
    arrivedRef.current = false;
    busyRef.current = false;
    setBusy(null);

    void pull(id);
    const timer = window.setInterval(() => {
      if (document.hidden || busyRef.current) return;
      void pull(id);
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden && !busyRef.current) void pull(id);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      seq.current += 1; // 닫은 뒤에 도착한 응답은 버린다
    };
    // initial·콜백은 ref 로 읽는다. 호출한 쪽이 매번 새 객체를 넘겨도 시트가 처음부터 다시 시작하지 않게.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, gatheringId]);

  // 프로필이 없어서 못 불러온 경우: 프로필을 만들면(needsProfile 이 꺼지면) 바로 다시 불러온다.
  const wasNeedingProfile = useRef(needsProfile);
  useEffect(() => {
    if (wasNeedingProfile.current && !needsProfile && open && gatheringId && gRef.current === null) {
      setPhase('loading');
      void pull(gatheringId);
    }
    wasNeedingProfile.current = needsProfile;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsProfile]);

  // 성공 알림은 잠깐 보였다가 사라진다.
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(t);
  }, [notice]);

  // 처음 데이터가 그려지면: 빈 의자를 눌러 들어온 경우 그 자리로 스크롤+포커스, 승인제면 신청 칸을 바로 연다.
  useEffect(() => {
    // 같은 렌더에서 열림 효과가 아직 새 모임을 불러오기 전이면 이전 모임의 값이 남아 있을 수 있어 id 를 확인한다.
    if (!g || g.id !== gatheringId || arrivedRef.current) return;
    arrivedRef.current = true;
    const key = focusKeyRef.current;
    if (!key) return;
    if (g.viewer.canApply) {
      setApplyOpen(true);
      return;
    }
    window.setTimeout(() => {
      const el = seatFocusRef.current;
      if (!el) return;
      el.scrollIntoView({ block: 'center' });
      const active = document.activeElement;
      // 사용자가 이미 다른 곳으로 옮겨 가지 않았을 때만 (시트 머리의 닫기 버튼이나 body 에 있을 때)
      if (!active || active === document.body || active.closest('.sheet__head')) el.focus({ preventScroll: true });
    }, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g]);

  const meId = g?.viewer.userId ?? '';
  const people = useMemo(
    () => (g ? uniquePeople([g.host, ...g.slots.flatMap((s) => s.members)]) : []),
    [g],
  );
  const safetyTargets = people.filter((p) => p.id !== meId);

  // 신고·차단 시트가 열릴 때 대상이 비어 있으면 첫 사람으로
  const safetyTarget = safetyTargets.find((p) => p.id === safetyTargetId) ?? safetyTargets[0] ?? null;

  // ───────────── 동작 ─────────────

  /** 중복 제출을 막고(ref), 응답 순서를 지키며, 오류를 코드별 문구로 바꿔 보여 주는 공통 길 */
  async function perform(
    key: string,
    action: GatheringAction,
    body: GatheringActionBody,
    copy: { fail: string; done: string },
  ): Promise<boolean> {
    if (!gatheringId || busyRef.current) return false;
    const id = gatheringId;
    busyRef.current = true;
    setBusy(key);
    setProblem(null);
    setNotice(null);
    seq.current += 1;
    try {
      const next = await loungeApi.act(id, action, body);
      seq.current += 1;
      commit(next, true);
      // 눈에 보이는 건 시트 안 알림, 낭독은 토스트(모달 뒤에 가려도 aria-live 로 읽힌다) — InlineNotice 설명 참고
      setNotice(copy.done);
      toast(copy.done);
      return true;
    } catch (err) {
      seq.current += 1;
      if (handleError(err)) return false;
      const e = err instanceof ApiError ? err : null;
      let text = err instanceof Error ? err.message : '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
      let title = copy.fail;
      if (e?.code === 'SLOT_FULL') {
        if (action === 'join') {
          title = '자리에 앉지 못했어요.';
          text = '이미 다른 사람이 앉았어요. 자리 상태를 새로 고쳤어요.';
        } else {
          text = '자리가 이미 다 찼어요. 최신 내용으로 새로 고쳤어요.';
        }
      } else if (e?.code === 'CONFLICT') {
        text = '다른 사람이 먼저 바꿨어요. 최신 내용으로 새로 고쳤어요. 다시 한 번 눌러 주세요.';
      } else if (e?.status === 404) {
        setPhase('missing');
      }
      setProblem({ title, text });
      // 자리가 찼다·마감됐다 같은 오류는 화면이 낡았다는 뜻이라 곧바로 새로 읽는다.
      void pull(id);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(null);
      settleFocus();
    }
  }

  /** 누른 버튼이 사라져 포커스가 body 로 떨어졌다면 시트 안(제목)으로 돌려 보낸다 — 키보드 사용자가 길을 잃지 않게 */
  function settleFocus() {
    window.setTimeout(() => {
      if (document.activeElement !== document.body) return;
      rootRef.current?.querySelector<HTMLElement>('[data-settle-focus]')?.focus({ preventScroll: true });
    }, 80);
  }

  async function sit(slot: SlotView) {
    if (!g || busyRef.current) return;
    const ok = await confirm({
      title: '여기에 앉을까요?',
      message: (
        <>
          <strong>{slot.label}</strong> 자리에 앉아요. 신청 마감({formatMeetAt(g.joinDeadline)}) 전에는 참여를 취소할 수
          있어요.
        </>
      ),
      confirmLabel: '앉기',
      cancelLabel: '돌아가기',
    });
    if (!ok) return;
    await perform(`join:${slot.key}`, 'join', { slotKey: slot.key }, {
      fail: '자리에 앉지 못했어요.',
      done: `${slot.label} 자리에 앉았어요. 자리가 다 차면 단톡방이 열려요.`,
    });
  }

  async function sendApply() {
    if (!g) return;
    const slotKey =
      (selected && g.slots.find((s) => s.key === selected && s.seatsLeft > 0)?.key) ??
      g.slots.find((s) => s.seatsLeft > 0)?.key ??
      g.slots[0]?.key;
    if (!slotKey) return;
    const done = await perform('apply', 'apply', { slotKey, message: applyText.trim() }, {
      fail: '신청하지 못했어요.',
      done: '신청을 보냈어요. 주최자가 수락하면 자리에 앉아요.',
    });
    if (done) {
      setApplyOpen(false);
      setApplyText('');
    }
  }

  async function leave() {
    if (!g) return;
    const applicantOnly = g.viewer.isApplicant && !g.viewer.isMember;
    const ok = await confirm({
      title: applicantOnly ? '신청을 취소할까요?' : '참여를 취소할까요?',
      message: applicantOnly
        ? '신청이 사라져요. 마감 전이라면 다시 신청할 수 있어요.'
        : `앉은 자리가 비고 다른 사람이 앉을 수 있어요. 신청 마감(${formatMeetAt(g.joinDeadline)})이 지나면 취소할 수 없어요.`,
      tone: 'danger',
      confirmLabel: applicantOnly ? '신청 취소하기' : '참여 취소하기',
      cancelLabel: '돌아가기',
    });
    if (!ok) return;
    await perform('leave', 'leave', {}, {
      fail: applicantOnly ? '신청을 취소하지 못했어요.' : '참여를 취소하지 못했어요.',
      done: applicantOnly ? '신청을 취소했어요.' : '참여를 취소했어요.',
    });
  }

  async function cancelGathering() {
    if (!g) return;
    const others = g.slots.reduce((n, s) => n + s.members.length, 0) - 1;
    const ok = await confirm({
      title: '모임을 취소할까요?',
      message:
        others > 0
          ? `앉은 ${others}명과 신청한 사람 모두 더 이상 참여할 수 없게 되고, 되돌릴 수 없어요.`
          : '더 이상 참여하거나 신청할 수 없게 되고, 되돌릴 수 없어요.',
      tone: 'danger',
      confirmLabel: '모임 취소하기',
      cancelLabel: '돌아가기',
    });
    if (!ok) return;
    await perform('cancel', 'cancel', {}, { fail: '모임을 취소하지 못했어요.', done: '모임을 취소했어요.' });
  }

  async function decide(a: GatheringView['applicants'][number], accept: boolean) {
    if (busyRef.current) return;
    if (!accept) {
      const ok = await confirm({
        title: `${a.user.nickname} 님의 신청을 거절할까요?`,
        message: '신청이 사라져요. 상대가 다시 신청할 수는 있어요.',
        confirmLabel: '거절하기',
        cancelLabel: '돌아가기',
        tone: 'danger',
      });
      if (!ok) return;
    }
    await perform(
      `${accept ? 'approve' : 'reject'}:${a.user.id}`,
      accept ? 'approve' : 'reject',
      { userId: a.user.id },
      accept
        ? { fail: '수락하지 못했어요.', done: `${a.user.nickname} 님을 수락했어요.` }
        : { fail: '거절하지 못했어요.', done: `${a.user.nickname} 님의 신청을 거절했어요.` },
    );
  }

  function review(target: PublicUser, mark: ReviewMark) {
    if (!g || g.myReviews[target.id] === mark) return; // 같은 평가를 다시 눌러도 달라지는 건 없다
    void perform(`review:${target.id}:${mark}`, 'review', { userId: target.id, mark }, {
      fail: '평가를 남기지 못했어요.',
      done: `${target.nickname} 님에게 "${REVIEW_LABEL[mark]}"를 남겼어요.`,
    });
  }

  function openRoom() {
    if (!g) return;
    onClose();
    navigate(`/lounge/rooms/${g.id}`);
  }

  /** 신고·차단 시트에서 차단이 끝난 뒤: 모임을 다시 읽어 보이면 알리고, 안 보이면 닫는다 */
  async function afterBlocked(target: PublicUser) {
    setSafetyOpen(false);
    onSafetyRef.current?.();
    if (!gatheringId) return;
    seq.current += 1;
    try {
      const next = await loungeApi.gathering(gatheringId);
      seq.current += 1;
      commit(next, true);
      const text = `${target.nickname} 님을 차단했어요. 서로의 다른 모임과 매칭에서는 사라져요.`;
      setNotice(text);
      toast(text);
    } catch (err) {
      // 내가 얽히지 않은 모임이 차단 때문에 안 보이게 된 경우
      if (err instanceof ApiError && err.status === 404) {
        onClose();
        toast(`${target.nickname} 님을 차단했어요. 이 모임은 더 이상 보이지 않아요.`);
      } else {
        setNotice(`${target.nickname} 님을 차단했어요.`);
        toast(`${target.nickname} 님을 차단했어요.`);
      }
    }
  }

  // ───────────── 그리기 ─────────────

  const v = g?.viewer;
  const sheetTitle = g ? `${KIND_LABEL[g.kind]} 테이블` : '모임 정보';

  let footer: ReactNode = undefined;
  if (g && v) {
    if (v.isMember && g.roomOpen) {
      footer = (
        <Button variant="primary" onClick={openRoom}>
          <Icon name="message" className="btn__icon" />
          단톡방 열기
        </Button>
      );
    } else if (v.canApply) {
      footer = applyOpen ? (
        <>
          <Button variant="tertiary" onClick={() => setApplyOpen(false)} disabled={busy === 'apply'}>
            취소
          </Button>
          <Button variant="primary" loading={busy === 'apply'} onClick={sendApply}>
            {busy === 'apply' ? '보내는 중…' : '신청 보내기'}
          </Button>
        </>
      ) : (
        <Button variant="primary" onClick={() => setApplyOpen(true)}>
          참여 신청하기
        </Button>
      );
    }
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} title={sheetTitle} footer={footer}>
        <div ref={rootRef} className="lounge-gath-table">
          {(problem || notice || pollFailed) && (
            <div className="lounge-gath-msgs">
              {problem && (
                <Alert tone="danger" title={problem.title}>
                  {problem.text}
                </Alert>
              )}
              {notice && <InlineNotice>{notice}</InlineNotice>}
              {pollFailed && (
                <Alert
                  tone="warning"
                  actions={
                    <Button variant="secondary" onClick={() => gatheringId && void pull(gatheringId)}>
                      다시 불러오기
                    </Button>
                  }
                >
                  최신 상태를 불러오지 못했어요. 지금 보이는 내용이 오래됐을 수 있어요.
                </Alert>
              )}
            </div>
          )}

          {phase === 'loading' && <LoadingBlock>모임을 불러오는 중이에요.</LoadingBlock>}

          {phase === 'missing' && (
            <EmptyState
              icon="info"
              title="볼 수 없는 모임이에요"
              description="모임이 없어졌거나, 지금은 볼 수 없는 상태예요."
              action={
                <Button variant="secondary" onClick={onClose}>
                  닫기
                </Button>
              }
            />
          )}

          {phase === 'error' && (
            <Alert
              tone="danger"
              title="모임을 불러오지 못했어요."
              actions={
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (!gatheringId) return;
                    setPhase('loading');
                    void pull(gatheringId);
                  }}
                >
                  다시 불러오기
                </Button>
              }
            >
              {loadError}
            </Alert>
          )}

          {phase === 'ready' && g && v && (
            <div className="lounge-gath-stack">
              {/* 머리: 종류·제목·상태 */}
              <header className="lounge-gath-head">
                <span className={`lounge-gath-item__icon lounge-gath-item__icon--${g.kind}`} aria-hidden="true">
                  <Icon name={KIND_ICON[g.kind]} />
                </span>
                <div className="grow">
                  <h3 className="lounge-gath-title" tabIndex={-1} data-settle-focus>
                    {g.title}
                  </h3>
                  <div className="lounge-gath-item__badges">
                    <Badge tone={STATUS_BADGE[g.status].tone}>{STATUS_BADGE[g.status].label}</Badge>
                    {relationBadge(g) && <Badge tone={relationBadge(g)!.tone}>{relationBadge(g)!.label}</Badge>}
                  </div>
                </div>
                {safetyTargets.length > 0 && (
                  <Button variant="icon" aria-label="신고 또는 차단" onClick={() => setSafetyOpen(true)}>
                    <Icon name="more" className="btn__icon" />
                  </Button>
                )}
              </header>

              {v.timetableConflict && (
                <Alert tone="warning" title={`수업과 겹쳐요: ${v.timetableConflict}`}>
                  그래도 참여할 수 있어요.
                </Alert>
              )}

              {/* 주최자 */}
              <section aria-label="주최자">
                <button
                  type="button"
                  className="lounge-gath-person"
                  onClick={() => setCardUserId(g.host.id)}
                  aria-label={`주최자 ${g.host.nickname} 프로필 보기`}
                >
                  <Avatar user={g.host} size="lg" />
                  <span className="lounge-gath-person__text">
                    <span className="lounge-gath-person__name">
                      {g.host.nickname}
                      <Badge tone="gray">주최</Badge>
                    </span>
                    <span className="lounge-gath-person__sub">
                      {g.host.college} · {admissionLabel(g.host.admissionYear)}
                    </span>
                    <TemperatureBadge value={g.host.temperature} />
                  </span>
                  <Icon name="chevron-right" className="list__chev" />
                </button>
              </section>

              {/* 소개 */}
              <section className="lounge-gath-stack lounge-gath-stack--tight">
                <HashTags g={g} />
                {g.body && <p className="lounge-gath-body">{g.body}</p>}
                <dl className="lounge-gath-info">
                  <div>
                    <dt>
                      <Icon name="pin" /> 장소
                    </dt>
                    <dd>{g.place}</dd>
                  </div>
                  <div>
                    <dt>
                      <Icon name="clock" /> 시간
                    </dt>
                    <dd>{formatMeetAt(g.meetAt)}</dd>
                  </div>
                  <div>
                    <dt>
                      <Icon name="calendar" /> 신청 마감
                    </dt>
                    <dd>
                      {formatMeetAt(g.joinDeadline)}
                      {g.status === 'open' && <span className="lounge-gath-info__left"> ({timeLeft(g.joinDeadline)})</span>}
                    </dd>
                  </div>
                </dl>
              </section>

              {/* 자리 */}
              <section aria-labelledby="lounge-gath-seats-title" className="lounge-gath-stack lounge-gath-stack--tight">
                <h3 className="lounge-gath-h3" id="lounge-gath-seats-title">
                  자리
                </h3>
                {g.slots.map((slot) => (
                  <SlotBox
                    key={slot.key}
                    slot={slot}
                    g={g}
                    selected={selected === slot.key && slot.seatsLeft > 0 && (v.canJoin || v.canApply)}
                    busy={busy}
                    seatFocusRef={seatFocusRef}
                    onSit={sit}
                    onPerson={(id) => setCardUserId(id)}
                  />
                ))}
                {g.joinPolicy === 'approval' && !v.isHost && g.applicantCount > 0 && (
                  <p className="text-sub text-sm">승인을 기다리는 신청이 {g.applicantCount}건 있어요.</p>
                )}
                {v.blockedReason && !v.isHost && (
                  <p className="lounge-gath-reason">
                    <Icon name="info" />
                    <span>{v.blockedReason}</span>
                  </p>
                )}
              </section>

              {/* 신청 한마디 */}
              {v.canApply && applyOpen && (
                <section aria-label="참여 신청">
                  <TextAreaField
                    label="주최자에게 한마디"
                    help="수락하기 전에는 자리를 차지하지 않아요. 적지 않아도 신청할 수 있어요."
                    placeholder="예) 저도 상상관에서 출발해요"
                    value={applyText}
                    maxLength={APPLY_MAX}
                    onChange={(e) => setApplyText(e.target.value)}
                    disabled={busy === 'apply'}
                    autoFocus
                  />
                </section>
              )}

              {/* 참여 취소 / 신청 취소 */}
              {(v.canLeave || (v.isApplicant && !v.isMember)) && (
                <Button variant="danger" block loading={busy === 'leave'} onClick={leave}>
                  {busy === 'leave' ? '취소하는 중…' : v.isApplicant && !v.isMember ? '신청 취소' : '참여 취소'}
                </Button>
              )}

              {/* 모임 후 평가 */}
              {v.canReview && <ReviewSection g={g} busy={busy} onMark={review} />}

              {/* 주최자 메뉴 */}
              {v.isHost && (
                <HostSection g={g} busy={busy} onDecide={decide} onCancel={cancelGathering} onPerson={(id) => setCardUserId(id)} />
              )}
            </div>
          )}
        </div>
      </Sheet>

      {/* 신고 · 차단: 참여자 중 대상을 고른 뒤 같은 폼을 쓴다 */}
      <Sheet open={safetyOpen} onClose={() => setSafetyOpen(false)} title="신고 · 차단">
        {safetyTarget && g ? (
          <div className="lounge-gath-stack">
            <SelectField label="대상" value={safetyTarget.id} onChange={(e) => setSafetyTargetId(e.target.value)}>
              {safetyTargets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nickname} · {p.college} · {admissionLabel(p.admissionYear)}
                </option>
              ))}
            </SelectField>
            <SafetyForm
              key={safetyTarget.id}
              target={safetyTarget}
              context={g.kind}
              refId={g.id}
              onReported={() => onSafetyRef.current?.()}
              onBlocked={afterBlocked}
            />
          </div>
        ) : (
          <EmptyState icon="users" title="신고할 사람이 아직 없어요" description="다른 사람이 앉으면 여기에서 신고하거나 차단할 수 있어요." />
        )}
      </Sheet>

      {/* 참여자·주최자의 사용자 카드 (신고 출처로 이 모임이 기록된다) */}
      <UserSheet
        open={cardUserId !== null}
        userId={cardUserId}
        context={g?.kind ?? 'profile'}
        refId={g?.id ?? null}
        onClose={() => setCardUserId(null)}
        onSafetyChanged={() => {
          onSafetyRef.current?.();
          if (gatheringId) void pull(gatheringId);
        }}
      />
    </>
  );
}

// ───────────── 조각 ─────────────

/** 분위기 태그: #장소종류 #메뉴 #태그… (상관없음 메뉴는 정보가 없어서 뺀다) */
function HashTags({ g }: { g: GatheringView }) {
  const tags = [g.meta.placeType, g.meta.menu === '상관없음' ? undefined : g.meta.menu, ...(g.meta.tags ?? [])].filter(
    (t): t is string => Boolean(t),
  );
  if (tags.length === 0) return null;
  return (
    <ul className="lounge-gath-hashtags" aria-label="분위기 태그">
      {tags.map((t) => (
        <li key={t}>#{t}</li>
      ))}
    </ul>
  );
}

function SlotBox({
  slot,
  g,
  selected,
  busy,
  seatFocusRef,
  onSit,
  onPerson,
}: {
  slot: SlotView;
  g: GatheringView;
  selected: boolean;
  busy: string | null;
  seatFocusRef: { current: HTMLButtonElement | null };
  onSit: (slot: SlotView) => void;
  onPerson: (id: string) => void;
}) {
  const canJoin = g.viewer.canJoin;
  return (
    <div className={`lounge-gath-slot${selected ? ' is-selected' : ''}`}>
      <div className="lounge-gath-slot__head">
        <h4 className="lounge-gath-slot__label">{slot.label}</h4>
        <span className="lounge-gath-slot__count tabular">
          {slot.members.length}/{slot.capacity}
        </span>
        {selected && <Badge tone="primary">선택한 자리</Badge>}
      </div>
      <ul className="lounge-gath-seats" aria-label={`${slot.label} 자리`}>
        {slot.members.map((m) => {
          const isHost = m.id === g.host.id;
          const isMe = m.id === g.viewer.userId;
          return (
            <li key={m.id}>
              <button
                type="button"
                className="lounge-gath-seat lounge-gath-seat--taken"
                onClick={() => onPerson(m.id)}
                aria-label={`${m.nickname}${isMe ? '(나)' : ''} 프로필 보기`}
              >
                <Avatar user={m} size="md" />
                <span className="lounge-gath-seat__name">{m.nickname}</span>
                {isHost && <Badge tone="gray">주최</Badge>}
                {isMe && <Badge tone="primary">나</Badge>}
                {g.noshowIds.includes(m.id) && <Badge tone="danger">노쇼 확정</Badge>}
              </button>
            </li>
          );
        })}
        {Array.from({ length: slot.seatsLeft }, (_, i) => {
          const first = i === 0;
          return (
            <li key={`empty-${i}`}>
              <div className="lounge-gath-seat lounge-gath-seat--empty">
                <span className="lounge-gath-seat__chair" aria-hidden="true">
                  <Icon name="chair" />
                </span>
                <span className="lounge-gath-seat__name lounge-gath-seat__name--empty">빈 자리</span>
                {canJoin && (
                  <Button
                    ref={first && selected ? seatFocusRef : undefined}
                    variant={first && selected ? 'primary' : 'secondary'}
                    className="lounge-gath-seat__sit"
                    aria-label={`여기에 앉기 (${slot.label})`}
                    loading={busy === `join:${slot.key}`}
                    onClick={() => onSit(slot)}
                  >
                    {busy === `join:${slot.key}` ? '앉는 중…' : '여기에 앉기'}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * 같이 간 사람마다 좋았어요 / 보통이에요 / 안 왔어요.
 * 노쇼는 나머지 전원이 눌러야 확정되므로 "혼자 누른다고 경고가 되는 게 아니다"를 안내한다.
 */
function ReviewSection({
  g,
  busy,
  onMark,
}: {
  g: GatheringView;
  busy: string | null;
  onMark: (target: PublicUser, mark: ReviewMark) => void;
}) {
  const everyone = uniquePeople(g.slots.flatMap((s) => s.members));
  const others = everyone.filter((m) => m.id !== g.viewer.userId);
  if (others.length === 0) return null;
  return (
    <section className="lounge-gath-panel" aria-labelledby="lounge-gath-review-title">
      <h3 className="lounge-gath-h3" id="lounge-gath-review-title">
        오늘 어땠어요?
      </h3>
      <p className="text-sub text-sm">같이 간 사람 전원이 &lsquo;안 왔어요&rsquo;를 누르면 노쇼 경고가 들어가요.</p>
      {everyone.length < 3 && (
        <p className="text-sub text-sm">
          둘뿐인 모임에서는 &lsquo;안 왔어요&rsquo;만으로 경고가 확정되지 않아요. 불쾌한 일이 있었다면 신고해 주세요.
        </p>
      )}
      <ul className="lounge-gath-reviews">
        {others.map((m) => {
          const mine = g.myReviews[m.id];
          return (
            <li key={m.id} className="lounge-gath-review">
              <div className="lounge-gath-review__who">
                <Avatar user={m} size="md" />
                <span className="lounge-gath-seat__name">{m.nickname}</span>
                {g.noshowIds.includes(m.id) && <Badge tone="danger">노쇼 확정</Badge>}
              </div>
              <div className="lounge-gath-marks" role="group" aria-label={`${m.nickname} 님 평가`}>
                {MARKS.map((mark) => (
                  <button
                    key={mark}
                    type="button"
                    className={`lounge-gath-mark lounge-gath-mark--${mark}`}
                    aria-pressed={mine === mark}
                    aria-busy={busy === `review:${m.id}:${mark}` || undefined}
                    onClick={() => onMark(m, mark)}
                  >
                    {mine === mark && <Icon name="check" />}
                    {REVIEW_LABEL[mark]}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** 주최자 전용: 신청자 수락·거절, 모임 취소 */
function HostSection({
  g,
  busy,
  onDecide,
  onCancel,
  onPerson,
}: {
  g: GatheringView;
  busy: string | null;
  onDecide: (a: GatheringView['applicants'][number], accept: boolean) => void;
  onCancel: () => void;
  onPerson: (id: string) => void;
}) {
  const cancellable = g.status === 'open' || g.status === 'full' || g.status === 'closed';
  // 보여 줄 게 없으면 빈 상자를 두지 않는다 (끝난 선착순 미팅의 주최자 등)
  const showApplicants = g.joinPolicy === 'approval' && (g.applicants.length > 0 || g.status === 'open');
  if (!showApplicants && !cancellable) return null;
  return (
    <section className="lounge-gath-panel lounge-gath-panel--host" aria-labelledby="lounge-gath-host-title">
      <h3 className="lounge-gath-h3" id="lounge-gath-host-title">
        주최자 메뉴
      </h3>

      {showApplicants && (
        <>
          {g.applicants.length > 0 ? (
            <ul className="lounge-gath-applicants" aria-label="신청자 목록">
              {g.applicants.map((a) => {
                return (
                  <li key={a.user.id} className="lounge-gath-applicant">
                    <button
                      type="button"
                      className="lounge-gath-person lounge-gath-person--compact"
                      onClick={() => onPerson(a.user.id)}
                      aria-label={`${a.user.nickname} 프로필 보기`}
                    >
                      <Avatar user={a.user} size="md" />
                      <span className="lounge-gath-person__text">
                        <span className="lounge-gath-person__name">{a.user.nickname}</span>
                        <span className="lounge-gath-person__sub">{a.user.college}</span>
                        <TemperatureBadge value={a.user.temperature} />
                      </span>
                    </button>
                    {a.message && <p className="lounge-gath-quote">&ldquo;{a.message}&rdquo;</p>}
                    <div className="form-actions">
                      <Button
                        variant="secondary"
                        loading={busy === `approve:${a.user.id}`}
                        aria-label={`${a.user.nickname} 수락`}
                        onClick={() => onDecide(a, true)}
                      >
                        수락
                      </Button>
                      <Button
                        variant="tertiary"
                        loading={busy === `reject:${a.user.id}`}
                        aria-label={`${a.user.nickname} 거절`}
                        onClick={() => onDecide(a, false)}
                      >
                        거절
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            g.status === 'open' && (
              <p className="text-sub text-sm">아직 신청한 사람이 없어요. 신청이 오면 여기에서 수락하거나 거절할 수 있어요.</p>
            )
          )}
        </>
      )}

      {cancellable && (
        <Button variant="danger" block loading={busy === 'cancel'} onClick={onCancel}>
          {busy === 'cancel' ? '취소하는 중…' : '모임 취소'}
        </Button>
      )}
    </section>
  );
}
