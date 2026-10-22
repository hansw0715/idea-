import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { AppHeader } from '../shell/Shell';
import TimetableGrid, { MEMBER_COLORS, WeekNav } from '../components/TimetableGrid';
import type { GridEntry } from '../components/TimetableGrid';
import BookingFlow from '../components/BookingFlow';
import SchoolBookSheet from '../school/SchoolBookSheet';
import SchoolLinkSheet from '../school/SchoolLinkSheet';
import { schoolApi } from '../school/api';
import { schoolErrorMessage } from '../school/errors';
import { useSchool } from '../school/SchoolContext';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Icon,
  LoadingBlock,
  btnClass,
  useConfirm,
  useToast,
} from '../ui';
import { reservationStatus } from '../reservationStatus';
import { Reveal, StaggerList, StaggerItem } from '../ui/motion';
import {
  addDaysStr,
  fmtDate,
  fmtDayHeader,
  fmtRange,
  fmtWeekLabel,
  isCurrentWeek,
  weekDates,
  weekdayOfDate,
} from '../time';
import { useWeek } from '../useWeek';
import type { Facility, MeetingDetailData, MemberTimetableEntry, Reservation } from '../types';
import './meeting-detail.css';

const POLL_MS = 15000;

interface LoadError {
  message: string;
  status: number;
}

interface CheckNote {
  tone: 'warning' | 'danger';
  /** 어느 예약에 대한 결과인지 */
  title: string;
  text: string;
}

/** 내용이 같으면 이전 값을 그대로 돌려줘 불필요한 다시 그리기(와 시간표 초기화)를 막는다. */
function keepIfEqual<T>(prev: T, next: T): T {
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
}

function toLoadError(err: unknown): LoadError {
  return {
    message: err instanceof Error && err.message ? err.message : '회의를 불러오지 못했습니다.',
    status: err instanceof ApiError ? err.status : 0,
  };
}

function actionMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export default function MeetingDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const week = useWeek();
  const { weekStart } = week;

  const [detail, setDetail] = useState<MeetingDetailData | null>(null);
  const [memberEntries, setMemberEntries] = useState<MemberTimetableEntry[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [reservationsFailed, setReservationsFailed] = useState(false);
  const [timetableFailed, setTimetableFailed] = useState(false);

  /** 회의에 참여할 팀원. null 이면 아직 초기화 전(=전원) */
  const [participants, setParticipants] = useState<number[] | null>(null);

  const [bookingOpen, setBookingOpen] = useState(false);
  const [flowKey, setFlowKey] = useState(0);

  const [checkingId, setCheckingId] = useState<number | null>(null);
  const [checkNote, setCheckNote] = useState<CheckNote | null>(null);
  // 학교 쪽 취소가 안 됐을 때: 앱의 예약만 지울지 묻는 안내
  const [cancelFail, setCancelFail] = useState<{ r: Reservation; text: string } | null>(null);

  // 학교에 바로 신청하기: 시트는 행이 아니라 화면 맨 아래에 하나만 둔다
  // (신청이 확인되면 그 행의 버튼이 사라지는데, 그래도 결과 화면은 남아 있어야 한다)
  const school = useSchool();
  const [bookTarget, setBookTarget] = useState<Reservation | null>(null);
  const [bookSheetOpen, setBookSheetOpen] = useState(false);
  // 학교 계정이 연동돼 있지 않으면 예약을 시작하지 않고 연동 시트를 먼저 연다
  const [linkOpen, setLinkOpen] = useState(false);
  // 이번에 막 만든 예약 계획(아직 학교에 보내기 전). 신청을 보내지 않고 닫으면 계획을 지운다 — 앱 안에만 있는 예약은 없다.
  const freshBooking = useRef<number | null>(null);
  const bookSent = useRef(false);

  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copyTimer = useRef<number | undefined>(undefined);
  const codeInputRef = useRef<HTMLInputElement>(null);
  /** 눌렀던 버튼이 목록에서 사라질 때 포커스를 받아 줄 '예약 현황' 제목 */
  const resHeadingRef = useRef<HTMLHeadingElement>(null);

  const alive = useRef(true);
  const leaving = useRef(false);
  const seq = useRef({ detail: 0, reservations: 0, timetable: 0 });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      window.clearTimeout(copyTimer.current);
    };
  }, []);

  // 다른 회의로 주소가 바뀌면 이전 회의의 내용을 비운다.
  useEffect(() => {
    setDetail(null);
    setMemberEntries([]);
    setReservations([]);
    setLoadError(null);
    setParticipants(null);
    setCheckNote(null);
    leaving.current = false;
  }, [id]);

  /* ── 데이터 불러오기 ── */
  const loadCore = useCallback(() => {
    if (!id) return;
    const nDetail = ++seq.current.detail;
    const nRes = ++seq.current.reservations;
    api
      .get<MeetingDetailData>(`/meetings/${id}`)
      .then((d) => {
        if (!alive.current || leaving.current || nDetail !== seq.current.detail) return;
        setDetail((prev) => keepIfEqual(prev, d));
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (!alive.current || leaving.current || nDetail !== seq.current.detail) return;
        setLoadError(toLoadError(err));
      });
    api
      .get<Reservation[]>(`/reservations/meeting/${id}`)
      .then((list) => {
        if (!alive.current || leaving.current || nRes !== seq.current.reservations) return;
        setReservations((prev) => keepIfEqual(prev, list));
        setReservationsFailed(false);
      })
      .catch(() => {
        if (alive.current && nRes === seq.current.reservations) setReservationsFailed(true);
      });
  }, [id]);

  const loadTimetable = useCallback(() => {
    if (!id) return;
    const n = ++seq.current.timetable;
    api
      .get<MemberTimetableEntry[]>(`/meetings/${id}/timetable?week=${weekStart}`)
      .then((list) => {
        if (!alive.current || leaving.current || n !== seq.current.timetable) return;
        setMemberEntries((prev) => keepIfEqual(prev, list));
        setTimetableFailed(false);
      })
      .catch(() => {
        if (alive.current && n === seq.current.timetable) setTimetableFailed(true);
      });
  }, [id, weekStart]);

  const loadAll = useCallback(() => {
    loadCore();
    loadTimetable();
  }, [loadCore, loadTimetable]);

  useEffect(() => {
    loadCore();
  }, [loadCore]);

  useEffect(() => {
    loadTimetable();
  }, [loadTimetable]);

  // 다른 사람이 참가하면 화면을 열어 둔 채로도 팀원 목록이 갱신되도록 15초마다, 그리고 창이 다시 보일 때 불러온다.
  useEffect(() => {
    const onTick = () => {
      if (!document.hidden) loadAll();
    };
    const timer = window.setInterval(onTick, POLL_MS);
    window.addEventListener('focus', onTick);
    document.addEventListener('visibilitychange', onTick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onTick);
      document.removeEventListener('visibilitychange', onTick);
    };
  }, [loadAll]);

  // 팀원 목록이 바뀌면 참여자 기본값은 전원. 나간 사람은 빼고, 새로 온 사람은 자동으로 넣는다.
  useEffect(() => {
    if (!detail) return;
    setParticipants((prev) => {
      const ids = detail.members.map((m) => m.id);
      if (prev === null) return ids;
      const kept = prev.filter((x) => ids.includes(x));
      const added = ids.filter((x) => !prev.includes(x));
      return added.length === 0 && kept.length === prev.length ? prev : [...kept, ...added];
    });
  }, [detail]);

  const activeIds = participants ?? [];

  function toggleParticipant(memberId: number) {
    // 예약 흐름의 여유 시간·선택은 흐름이 열릴 때마다 처음부터 시작하므로, 여기서 바꾼 값이 곧바로 반영된다.
    setParticipants((prev) => {
      const base = prev ?? [];
      return base.includes(memberId) ? base.filter((x) => x !== memberId) : [...base, memberId];
    });
  }

  /* ── 시간표에 올릴 항목 ── */
  const memberIndexById = useMemo(() => {
    const map = new Map<number, number>();
    detail?.members.forEach((m, i) => map.set(m.id, i));
    return map;
  }, [detail]);

  const gridEntries: GridEntry[] = useMemo(() => {
    const days = weekDates(weekStart);
    return [
      ...memberEntries.map((e) => ({
        ...e,
        memberIndex: memberIndexById.get(e.memberId) ?? 0,
        memberName: detail?.members.find((m) => m.id === e.memberId)?.name,
        kind: 'class' as const,
        subtitle:
          e.repeatKind === 'once' ? `${fmtDayHeader(e.date ?? '')} 하루만` : e.place || undefined,
      })),
      // 이 회의로 잡은 예약도 팀원 시간표 위에 함께 보여 준다. 보고 있는 주의 날짜만 올린다.
      ...reservations
        .filter((r) => days.includes(r.date))
        .map((r) => ({
          id: r.id,
          day: weekdayOfDate(r.date),
          startMin: r.startMin,
          endMin: r.endMin,
          title: r.facilityName,
          subtitle: fmtDate(r.date),
          kind: 'reservation' as const,
        })),
    ];
  }, [memberEntries, memberIndexById, reservations, detail, weekStart]);

  /* ── 동작 ── */
  async function copyCode() {
    if (!detail) return;
    window.clearTimeout(copyTimer.current);
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(detail.code);
      setCopyState('copied');
      toast('회의 코드를 복사했습니다.');
      copyTimer.current = window.setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      // 복사 권한이 없으면 선택 가능한 입력칸으로 코드를 보여 준다.
      setCopyState('failed');
      window.setTimeout(() => {
        codeInputRef.current?.focus();
        codeInputRef.current?.select();
      }, 0);
    }
  }

  function openBooking() {
    if (activeIds.length === 0) return;
    // 시설 예약은 학교 계정 연동으로만 신청한다. 연동이 없거나 이 기기에서 쓸 수 없으면 먼저 연동한다.
    if (school.loading) return;
    if (!school.linked || !school.canUse) {
      setLinkOpen(true);
      return;
    }
    setFlowKey((k) => k + 1);
    setBookingOpen(true);
  }

  function closeBooking() {
    setBookingOpen(false);
  }

  // 4단계에서 "학교에 신청하기"를 누르면 예약 계획이 만들어지고, 곧바로 학교 신청 화면(미리보기 → 확인 → 제출)이 열린다.
  function handleBooked(created: Reservation) {
    setCheckNote(null);
    setBookingOpen(false);
    freshBooking.current = created.id;
    bookSent.current = false;
    openSchoolBook(created);
    loadAll();
  }

  /**
   * 예약 취소 = 실제 취소. 학교에 신청한 예약은 학교 신청내역에서 취소가 확인될 때만 지워진다.
   * 학교 쪽이 안 되면(연동 없음·취소 방법을 못 찾음·확인 실패) 아무것도 지우지 않고 이유를 알린다 — 앱에서만 지우는 길은 없다.
   * (학교에 보낸 신청이 없는 예약 계획은 서버가 "취소할 것이 없다"고 답해 그대로 정리된다.)
   */
  async function cancelReservation(r: Reservation) {
    let schoolError: unknown = null;
    const ok = await confirm({
      title: `${fmtDate(r.date)} ${r.facilityName} 예약을 취소할까요?`,
      message: '학교에 신청한 예약이면 학교 신청내역에서 실제로 취소해요. 취소하면 되돌릴 수 없어요.',
      tone: 'danger',
      confirmLabel: '예약 취소하기',
      cancelLabel: '돌아가기',
      run: async () => {
        try {
          if (school.linked && school.canUse) {
            // 확인창에서 직접 누른 한 번만 학교에 취소를 보낸다. 실패해도 자동으로 다시 보내지 않는다.
            await school.withCredentials((creds) => schoolApi.bookCancel(creds, r.id));
          }
          // 학교에 신청한 예약은 위에서 실제 취소가 끝난 뒤에만 서버가 지워 준다(연동이 없으면 서버가 거절한다).
          await api.del(`/reservations/${r.id}`);
        } catch (err) {
          schoolError = err;
        }
      },
    });
    if (!ok) return;
    if (schoolError) {
      // 서버가 준 문장(취소 방법을 못 찾음·확인 못 함 등)이 가장 정확하다. 없으면 일반 학교 오류 문장.
      const raw = schoolError instanceof Error ? schoolError.message : '';
      setCancelFail({ r, text: raw || schoolErrorMessage(schoolError) });
      loadAll();
      return;
    }
    // 눌렀던 '예약 취소하기' 버튼은 목록에서 사라지므로, 포커스가 본문 맨 위로 떨어지지 않게 '예약 현황' 제목으로 옮긴다.
    resHeadingRef.current?.focus();
    setCheckNote(null);
    setCancelFail(null);
    toast('예약을 취소했습니다.');
    loadAll();
  }

  // 학생이 학교 사이트에서 신청을 마친 뒤, 학교 공개 현황에 그 시간이 잡혔는지 확인한다.
  async function checkSchool(r: Reservation, trigger?: HTMLElement) {
    if (checkingId !== null) return;
    setCheckingId(r.id);
    setCheckNote(null);
    try {
      const result = await api.post<{ confirmed: boolean }>(`/reservations/${r.id}/confirm-check`);
      if (result.confirmed) {
        // 확인이 끝난 예약은 '학교 예약 확인하기' 버튼이 사라진다. 아직 그 버튼에 포커스가 있으면 제목으로 옮긴다.
        const active = document.activeElement;
        if (active === trigger || active === document.body) resHeadingRef.current?.focus();
        toast(`${r.facilityName} 예약이 학교 시스템에서 확인되었습니다.`);
      } else {
        setCheckNote({
          tone: 'warning',
          title: `${r.facilityName} ${fmtDate(r.date)} 예약 확인 결과`,
          text: '아직 학교 시스템에서 이 시간이 예약으로 보이지 않습니다. 학교 사이트에서 신청을 마쳤는지 확인한 뒤, 잠시 후(현황 갱신에 시간이 걸릴 수 있습니다) 다시 눌러 주세요.',
        });
      }
      loadAll();
    } catch (err) {
      setCheckNote({
        tone: 'danger',
        title: `${r.facilityName} ${fmtDate(r.date)} 예약을 확인하지 못했습니다.`,
        text: actionMessage(err, '학교 예약 현황을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'),
      });
    } finally {
      if (alive.current) setCheckingId(null);
    }
  }

  function openSchoolBook(r: Reservation) {
    setBookTarget(r);
    setBookSheetOpen(true);
  }

  function closeSchoolBook() {
    setBookSheetOpen(false);
    const fresh = freshBooking.current;
    freshBooking.current = null;
    if (fresh !== null && !bookSent.current) {
      // 학교에 보내지 않고 닫았다: 앱 안에만 남는 예약이 생기지 않게 방금 만든 계획을 지운다.
      void api
        .del(`/reservations/${fresh}`)
        .then(() => toast('학교에 신청하지 않아 예약을 만들지 않았어요.'))
        .catch(() => toast('만든 예약을 정리하지 못했어요. 아래 예약 현황에서 취소해 주세요.'))
        .finally(() => {
          if (alive.current) loadAll();
        });
    }
    // 신청이 확인되면 눌렀던 버튼이 목록에서 사라지므로, 포커스가 본문 맨 위로 떨어지지 않게 '예약 현황' 제목으로 옮긴다.
    window.setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body) resHeadingRef.current?.focus();
    }, 80);
  }

  async function leaveOrDelete() {
    if (!detail || !user) return;
    const isOwner = detail.ownerId === user.id;
    const ok = await confirm({
      title: isOwner ? `'${detail.name}' 회의를 삭제할까요?` : `'${detail.name}' 회의에서 나갈까요?`,
      message: isOwner
        ? '예약과 멤버 정보가 모두 삭제됩니다. 삭제한 회의는 되돌릴 수 없습니다. 학교 사이트에 이미 신청한 예약은 학교 사이트에서 따로 취소해 주세요.'
        : '나가면 이 회의의 팀원 시간표와 예약을 볼 수 없습니다. 회의 코드가 있으면 다시 참가할 수 있습니다.',
      tone: 'danger',
      confirmLabel: isOwner ? '삭제하기' : '나가기',
      run: async () => {
        leaving.current = true;
        try {
          if (isOwner) await api.del(`/meetings/${detail.id}`);
          else await api.post(`/meetings/${detail.id}/leave`);
        } catch (err) {
          leaving.current = false;
          throw err;
        }
      },
    });
    if (!ok) return;
    toast(isOwner ? '회의를 삭제했습니다.' : '회의에서 나갔습니다.');
    navigate('/meetings');
  }

  /* ── 불러오기 실패 / 불러오는 중 ── */
  // 회의가 없어졌거나(삭제) 더는 멤버가 아니면 남은 내용을 보여 주지 않는다.
  const gone = loadError !== null && (loadError.status === 403 || loadError.status === 404);

  if (loadError && (detail === null || gone)) {
    return (
      <>
        <AppHeader title="회의" backTo="/meetings" />
        <main id="main" className="app-main">
          <Alert
            tone="danger"
            title="회의를 불러오지 못했습니다."
            actions={
              <>
                {!gone && (
                  <Button variant="secondary" size="sm" onClick={loadAll}>
                    다시 시도하기
                  </Button>
                )}
                <Link to="/meetings" className={btnClass({ variant: 'tertiary', size: 'sm' })}>
                  회의 목록으로 가기
                </Link>
              </>
            }
          >
            {loadError.message}
          </Alert>
        </main>
      </>
    );
  }

  if (!detail) {
    return (
      <>
        <AppHeader title="회의" backTo="/meetings" />
        <main id="main" className="app-main">
          <LoadingBlock>회의를 불러오는 중입니다.</LoadingBlock>
        </main>
      </>
    );
  }

  const isOwner = user !== null && detail.ownerId === user.id;
  const syncFailed = loadError !== null || reservationsFailed || timetableFailed;
  const noParticipants = activeIds.length === 0;
  const colorOf = (index: number) => MEMBER_COLORS[index % MEMBER_COLORS.length];

  return (
    <>
      <AppHeader title={detail.name} backTo="/meetings" />
      <main id="main" className="app-main meeting-detail-page">
        <header className="page-head meeting-detail-head">
          <p className="eyebrow">회의 작업 공간</p>
          <h1 className="page-title">{detail.name}</h1>
          <p className="page-lead">팀원 {detail.members.length}명 · 함께 비는 시간을 찾아 예약하세요.</p>
        </header>
        {syncFailed && (
          <section className="section">
            <Alert
              tone="warning"
              title="최신 정보를 불러오지 못했습니다."
              actions={
                <Button variant="secondary" size="sm" onClick={loadAll}>
                  다시 불러오기
                </Button>
              }
            >
              화면에는 마지막으로 불러온 내용이 보입니다. 네트워크 연결을 확인해 주세요.
            </Alert>
          </section>
        )}

        <div className="mtg-workspace">
          <Reveal className="mtg-workspace-overview">
        {/* ① 회의 코드 */}
        <section className="section" aria-labelledby="mtg-code-title">
          <div className="card mtg-code">
            <h2 className="mtg-code__label" id="mtg-code-title">
              회의 코드
            </h2>
            <div className="mtg-code__row">
              {copyState === 'failed' ? (
                <input
                  ref={codeInputRef}
                  className="input mtg-code__input code-chip"
                  readOnly
                  value={detail.code}
                  aria-label="회의 코드 (길게 눌러 복사할 수 있습니다)"
                  onFocus={(e) => e.currentTarget.select()}
                />
              ) : (
                <p className="mtg-code__value code-chip">
                  <span aria-hidden="true">{detail.code}</span>
                  <span className="sr-only">{detail.code.split('').join(' ')}</span>
                </p>
              )}
              <Button variant="secondary" onClick={copyCode}>
                <Icon name={copyState === 'copied' ? 'check' : 'copy'} className="btn__icon" />
                {copyState === 'copied' ? '복사됨' : '코드 복사하기'}
              </Button>
            </div>
            {copyState === 'failed' && (
              <p className="field__help" role="status">
                자동으로 복사하지 못했습니다. 위 코드를 길게 눌러 복사해 주세요.
              </p>
            )}
            <p className="text-sub text-sm">
              회의 코드를 팀원에게 공유하면 함께 시간을 맞출 수 있습니다.
            </p>
          </div>
        </section>

        {/* ② 회의 예약하기 (이 화면의 유일한 Primary) */}
        <section className="section" aria-label="회의 예약">
          <Button
            variant="primary"
            size="lg"
            block
            onClick={openBooking}
            aria-disabled={noParticipants || undefined}
            aria-describedby="mtg-book-help"
          >
            회의 예약하기
          </Button>
          <p className="text-sub text-sm mtg-book-help" id="mtg-book-help">
            {noParticipants
              ? '참여할 팀원을 한 명 이상 선택하면 예약할 수 있습니다.'
              : `참여 ${activeIds.length}명이 모두 비는 시간을 찾고, 날짜와 시설을 고른 뒤 학교에 바로 신청합니다.`}
          </p>

          {!school.loading && (!school.linked || !school.canUse) && (
            <div className="mtg-result">
              <Alert
                tone="info"
                title={school.linked ? '이 기기에서는 학교 계정을 다시 연동해야 해요.' : '학교 계정을 연동해야 시설을 예약할 수 있어요.'}
                actions={
                  <Button variant="secondary" size="sm" onClick={() => setLinkOpen(true)}>
                    {school.linked ? '다시 연동하기' : '학교 계정 연동하기'}
                  </Button>
                }
              >
                시설 예약은 학교에 바로 신청하는 방식으로만 할 수 있어요.
              </Alert>
            </div>
          )}
        </section>

        {/* ③ 팀원 */}
        <section className="section" aria-labelledby="mtg-members-title">
          <div className="section__head">
            <h2 className="section__title" id="mtg-members-title">
              팀원 {detail.members.length}명
            </h2>
            <p className="text-sub text-sm" aria-live="polite" aria-atomic="true">
              회의에 참여할 사람 {activeIds.length}명
            </p>
          </div>
          <p className="section__sub mtg-members__sub">
            이름을 눌러 이번 회의에서 빼거나 다시 넣을 수 있습니다. 빠진 사람의 수업은 시간 계산에
            반영되지 않습니다.
          </p>
          <div className="tag-group" role="group" aria-label="회의에 참여할 팀원">
            {detail.members.map((m, i) => {
              const on = activeIds.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`tag mtg-chip${on ? '' : ' is-off'}`}
                  aria-pressed={on}
                  onClick={() => toggleParticipant(m.id)}
                >
                  <Icon name="check" className="tag__check" />
                  <span
                    className={`tag__dot${i % MEMBER_COLORS.length === 4 ? ' member-swatch--patterned' : ''}`}
                    style={{ background: on ? colorOf(i) : 'var(--gray-30)' }}
                    aria-hidden="true"
                  />
                  <span className="mtg-chip__name">{m.name}</span>
                  {m.isOwner ? <Badge tone="gray">방장</Badge> : null}
                  <span className="sr-only" aria-hidden={on}>제외됨</span>
                </button>
              );
            })}
          </div>
          {noParticipants && (
            <p className="field__error mtg-members__warn" role="status">
              <Icon name="alert" />
              <span>참여할 사람이 없으면 시간을 계산할 수 없습니다. 이름을 눌러 다시 넣어 주세요.</span>
            </p>
          )}
        </section>

          </Reveal>
        {/* ⑤ 예약 현황 */}
        <section className="section mtg-workspace-reservations" aria-labelledby="mtg-res-title">
          <div className="section__head">
            <h2 className="section__title" id="mtg-res-title" tabIndex={-1} ref={resHeadingRef}>
              예약 현황
            </h2>
          </div>

          {cancelFail && (
            <Alert
              tone="danger"
              title="예약을 취소하지 못했어요"
              className="mtg-res-note"
              actions={
                <>
                  {!(school.linked && school.canUse) && (
                    <Button variant="secondary" size="sm" onClick={() => setLinkOpen(true)}>
                      학교 계정 연동하기
                    </Button>
                  )}
                  <Button variant="text" size="sm" onClick={() => setCancelFail(null)}>
                    닫기
                  </Button>
                </>
              }
            >
              {cancelFail.text}
            </Alert>
          )}

          {checkNote && (
            <Alert
              tone={checkNote.tone}
              title={checkNote.title}
              className="mtg-res-note"
              actions={
                <Button variant="text" size="sm" onClick={() => setCheckNote(null)}>
                  닫기
                </Button>
              }
            >
              {checkNote.text}
            </Alert>
          )}

          {reservations.length === 0 ? (
            <div className="card card--flat">
              <EmptyState
                icon="pin"
                title="아직 예약된 시설이 없습니다."
                description="팀원이 모두 비는 시간에 시설을 예약해 보세요."
                action={
                  <Button variant="secondary" onClick={openBooking} aria-disabled={noParticipants || undefined}>
                    예약 시작하기
                  </Button>
                }
              />
            </div>
          ) : (
            <StaggerList className="mtg-res-list">
              {reservations.map((r) => {
                const status = reservationStatus(r);
                const confirmed = r.schoolStatus === 'confirmed';
                return (
                  <StaggerItem key={r.id} className="mtg-res">
                    <div className="mtg-res__head">
                      <p className="mtg-res__title">
                        {r.facilityName} · {r.building}
                      </p>
                      <span className={`badge ${status.className}`}>
                        <Icon name={confirmed ? 'check-circle' : 'clock'} className="mtg-res__icon" />
                        {status.label}
                      </span>
                    </div>
                    <p className="text-sub text-sm">
                      {fmtDate(r.date)} {fmtRange(r.startMin, r.endMin)} · 예약자 {r.userName}
                    </p>
                    <div className="mtg-res__actions">
                      {!confirmed && school.linked && school.canUse && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            freshBooking.current = null;
                            openSchoolBook(r);
                          }}
                          aria-label={`${r.facilityName} 학교에 바로 신청하기`}
                        >
                          학교에 바로 신청하기
                        </Button>
                      )}
                      {!confirmed && !school.loading && !(school.linked && school.canUse) && (
                        <Button variant="secondary" size="sm" onClick={() => setLinkOpen(true)}>
                          학교 계정 연동하기
                        </Button>
                      )}
                      {!confirmed && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={(e) => void checkSchool(r, e.currentTarget)}
                          loading={checkingId === r.id}
                          disabled={checkingId !== null && checkingId !== r.id}
                          aria-label={`${r.facilityName} 학교 예약 확인하기`}
                        >
                          {checkingId === r.id ? '확인 중…' : '학교 예약 확인하기'}
                        </Button>
                      )}
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => void cancelReservation(r)}
                        aria-label={`${fmtDate(r.date)} ${r.facilityName} 예약 취소하기`}
                      >
                        예약 취소하기
                      </Button>
                    </div>
                  </StaggerItem>
                );
              })}
            </StaggerList>
          )}

          {/* 연동하지 않았거나 이 기기에서 쓸 수 없으면, 학교 사이트로 가는 기존 안내는 그대로 두고 연동을 권하는 한 줄만 붙인다 */}
          {reservations.some((r) => r.schoolStatus !== 'confirmed') && !school.loading && !school.canUse && !school.error && (
            <p className="text-sub text-sm school-hint">
              {school.linked
                ? '이 기기에서는 학교 계정을 다시 연동해야 여기서 바로 신청할 수 있습니다. '
                : '학교 계정을 연동하면 여기서 학교에 바로 신청할 수 있습니다. '}
              <Link to="/account" className="link">
                {school.linked ? '내 정보에서 다시 연동하기' : '내 정보에서 연동하기'}
              </Link>
            </p>
          )}
        </section>

        </div>
        {/* ④ 팀원 시간표 */}
        <section className="section mtg-workspace-timetable" aria-labelledby="mtg-tt-title">
          <div className="section__head">
            <h2 className="section__title" id="mtg-tt-title">
              팀원 시간표
            </h2>
          </div>
          <div className="mtg-weeknav">
            <WeekNav
              label={fmtWeekLabel(weekStart)}
              sub={`${fmtDayHeader(weekStart)} ~ ${fmtDayHeader(addDaysStr(weekStart, 4))}`}
              onPrev={week.prevWeek}
              onNext={week.nextWeek}
              onToday={isCurrentWeek(weekStart) ? undefined : week.goToday}
            />
          </div>
          {memberEntries.length === 0 ? (
            <div className="card card--flat">
              <EmptyState
                icon="calendar"
                title="아직 등록된 시간표가 없습니다."
                description="각자 시간표를 등록하면 여기에 겹쳐 보입니다."
                action={
                  <Link to="/timetable" className={btnClass({ variant: 'secondary' })}>
                    내 시간표 등록하기
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="stack">
              <ul className="mtg-legend" aria-label="팀원별 색과 무늬 안내">
                {detail.members.map((m, i) => (
                  <li key={m.id} className="mtg-legend__item">
                    <span
                      className={`mtg-legend__dot${i % MEMBER_COLORS.length === 4 ? ' member-swatch--patterned' : ''}`}
                      style={{ background: colorOf(i) }}
                      aria-hidden="true"
                    />
                    {m.name}
                    {!activeIds.includes(m.id) && <span className="text-muted"> (제외됨)</span>}
                  </li>
                ))}
                <li className="mtg-legend__item">
                  <span className="tt-swatch tt-swatch--res" aria-hidden="true" />
                  회의 예약 (팀원 전체 표시)
                </li>
              </ul>
              <div className="mtg-grid">
                <TimetableGrid
                  entries={gridEntries}
                  laneCount={detail.members.length}
                  compact
                  weekStart={weekStart}
                  slide={week.slide}
                />
              </div>
            </div>
          )}
        </section>

        {/* ⑥ 위험 구역 */}
        <section className="section mtg-danger" aria-labelledby="mtg-danger-title">
          <h2 className="section__title" id="mtg-danger-title">
            {isOwner ? '회의 삭제' : '회의 나가기'}
          </h2>
          <p className="section__sub mtg-danger__text">
            {isOwner
              ? '회의를 삭제하면 예약과 멤버 정보가 모두 삭제되며 되돌릴 수 없습니다.'
              : '회의에서 나가면 이 회의의 팀원 시간표와 예약을 볼 수 없습니다. 회의 코드가 있으면 다시 참가할 수 있습니다.'}
          </p>
          <Button variant="danger" block onClick={() => void leaveOrDelete()}>
            {isOwner ? '회의 삭제하기' : '회의 나가기'}
          </Button>
        </section>
      </main>

      <BookingFlow
        key={flowKey}
        open={bookingOpen}
        onClose={closeBooking}
        meetingId={detail.id}
        members={detail.members}
        activeIds={activeIds}
        gridEntries={gridEntries}
        week={week}
        onBooked={handleBooked}
      />

      <SchoolLinkSheet open={linkOpen} onClose={() => setLinkOpen(false)} />

      <SchoolBookSheet
        open={bookSheetOpen}
        onClose={closeSchoolBook}
        reservation={bookTarget}
        onResult={() => {
          bookSent.current = true;
          loadAll();
        }}
        onRelink={() => navigate('/account')}
      />
    </>
  );
}
