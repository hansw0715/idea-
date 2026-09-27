import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import TimetableGrid, { MEMBER_COLORS } from '../components/TimetableGrid';
import type { GridEntry, SelectedRange } from '../components/TimetableGrid';
import {
  DAY_NAMES,
  fmtDate,
  fmtDuration,
  fmtRange,
  nextDatesForDay,
  weekdayOfDate,
  todayStr,
  nowMinutes,
  MAX_DAYS_AHEAD,
  fmtWeekLabel,
  fmtDayHeader,
  isCurrentWeek,
} from '../time';
import { useWeek } from '../useWeek';
import type {
  Facility,
  FacilityResponse,
  FreeSlot,
  MeetingDetailData,
  MemberTimetableEntry,
  Reservation,
} from '../types';

// 학교 규정: 하루 최대 3시간
const MAX_RESERVATION_MIN = 180;

export default function MeetingDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { weekStart, slide, prevWeek, nextWeek, goToday } = useWeek();

  const [detail, setDetail] = useState<MeetingDetailData | null>(null);
  const [memberEntries, setMemberEntries] = useState<MemberTimetableEntry[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // 예약 플로우 상태 — 시간은 시간표에서 드래그로 지정한다.
  const [booking, setBooking] = useState(false);
  const [slots, setSlots] = useState<FreeSlot[] | null>(null);
  const [range, setRange] = useState<SelectedRange | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [facilities, setFacilities] = useState<Facility[] | null>(null);
  const [campusStatus, setCampusStatus] = useState<'ok' | 'unavailable' | 'skipped'>('skipped');
  const [hiddenByCapacity, setHiddenByCapacity] = useState(0);
  /** 회의 시간 계산에 넣을 팀원. null이면 아직 초기화 전(=전원) */
  const [participants, setParticipants] = useState<number[] | null>(null);
  const [bookingGuide, setBookingGuide] = useState<{
    systemLabel: string | null;
    reserveUrl: string | null;
    contact: string | null;
  } | null>(null);
  const [selectedFacility, setSelectedFacility] = useState<number | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const loadAll = useCallback(() => {
    if (!id) return;
    api
      .get<MeetingDetailData>(`/meetings/${id}`)
      .then((d) => {
        setDetail(d);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : '회의를 불러오지 못했습니다.'));
    api
      .get<MemberTimetableEntry[]>(`/meetings/${id}/timetable?week=${weekStart}`)
      .then(setMemberEntries)
      .catch(() => undefined);
    api
      .get<Reservation[]>(`/reservations/meeting/${id}`)
      .then(setReservations)
      .catch(() => undefined);
  }, [id, weekStart]);

  useEffect(loadAll, [loadAll]);

  // 팀원 목록이 바뀌면 기본값은 전원 참여로 둔다.
  useEffect(() => {
    if (!detail) return;
    setParticipants((prev) => {
      const ids = detail.members.map((m) => m.id);
      if (prev === null) return ids;
      // 나간 사람은 빼고, 새로 들어온 사람은 자동으로 넣는다.
      const kept = prev.filter((id) => ids.includes(id));
      const added = ids.filter((id) => !prev.includes(id));
      return [...kept, ...added];
    });
  }, [detail]);

  const activeIds = participants ?? [];

  function toggleParticipant(id: number) {
    setParticipants((prev) => {
      const base = prev ?? [];
      return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    });
    // 인원이 바뀌면 여유 시간과 시설 조건이 달라지므로 선택을 되돌린다.
    // 새 결과가 오기 전까지 옛 여유 시간을 보여주면 오해하기 쉬워 함께 비운다.
    setSlots(null);
    setRange(null);
    setSelectedDate(null);
    setFacilities(null);
    setSelectedFacility(null);
    setBookingError(null);
  }

  // 다른 사람이 참가하면 화면을 열어둔 채로도 팀원 목록이 갱신되도록 주기적으로 다시 불러온다.
  useEffect(() => {
    const timer = window.setInterval(loadAll, 15000);
    window.addEventListener('focus', loadAll);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', loadAll);
    };
  }, [loadAll]);

  /** 예약 플로우 선택 상태를 처음으로 되돌린다. */
  function resetFlow() {
    setRange(null);
    setSelectedDate(null);
    setFacilities(null);
    setSelectedFacility(null);
    setBookingError(null);
  }

  function openBooking() {
    resetFlow();
    setBooking(true);
  }

  function closeBooking() {
    setBooking(false);
    setBookingError(null);
  }

  // 패널이 열려 있는 동안 팀원 공통 여유 시간을 조회한다.
  // 30분 기준으로 받아 와 비는 구간 전체를 시간표에 표시한다.
  useEffect(() => {
    if (!booking || !id || activeIds.length === 0) return;
    let cancelled = false;
    setBookingError(null);
    api
      .get<FreeSlot[]>(
        `/meetings/${id}/free-slots?duration=30&week=${weekStart}&members=${activeIds.join(',')}`,
      )
      .then((s) => {
        if (!cancelled) setSlots(s);
      })
      .catch((err) => {
        if (!cancelled) {
          setBookingError(err instanceof Error ? err.message : '여유 시간을 계산하지 못했습니다.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [booking, id, weekStart, activeIds.join(',')]);

  // 날짜와 시간이 정해지면 시설 목록을 조회
  useEffect(() => {
    if (!selectedDate || !range) {
      setFacilities(null);
      setSelectedFacility(null);
      return;
    }
    let cancelled = false;
    setFacilities(null);
    setSelectedFacility(null);
    setBookingError(null);
    api
      .get<FacilityResponse>(
        `/facilities?date=${selectedDate}&start=${range.startMin}&end=${range.endMin}&people=${activeIds.length}`,
      )
      .then((r) => {
        if (!cancelled) {
          setFacilities(r.facilities);
          setCampusStatus(r.campusStatus);
          setHiddenByCapacity(r.hiddenByCapacity ?? 0);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setBookingError(err instanceof Error ? err.message : '시설 목록을 불러오지 못했습니다.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate, range, activeIds.length]);

  const memberIndexById = useMemo(() => {
    const map = new Map<number, number>();
    detail?.members.forEach((m, i) => map.set(m.id, i));
    return map;
  }, [detail]);

  const gridEntries: GridEntry[] = useMemo(
    () => [
      ...memberEntries.map((e) => ({
        ...e,
        memberIndex: memberIndexById.get(e.memberId) ?? 0,
        memberName: detail?.members.find((m) => m.id === e.memberId)?.name,
        kind: 'class' as const,
        subtitle:
          e.repeatKind === 'once' ? `${fmtDayHeader(e.date ?? '')} 하루만` : e.place || undefined,
      })),
      // 이 회의로 확정된 예약도 팀원 시간표 위에 함께 보여준다.
      ...reservations.map((r) => ({
        id: r.id,
        day: weekdayOfDate(r.date),
        startMin: r.startMin,
        endMin: r.endMin,
        title: r.facilityName,
        subtitle: fmtDate(r.date),
        kind: 'reservation' as const,
      })),
    ],
    [memberEntries, memberIndexById, reservations],
  );

  /** 시간표에 초록 배경으로 표시할 공통 여유 구간 */
  const freeRanges: SelectedRange[] = useMemo(
    () => (slots ?? []).map((s) => ({ day: s.day, startMin: s.start, endMin: s.end })),
    [slots],
  );

  /** 드래그한 구간이 팀원 전원이 비는 시간 안에 들어가는지 */
  function isWithinFree(next: SelectedRange): boolean {
    return (slots ?? []).some(
      (s) => s.day === next.day && next.startMin >= s.start && next.endMin <= s.end,
    );
  }

  /**
   * 고른 시간대로 실제 신청할 수 있는 날짜.
   * 오늘이면서 시작 시각이 이미 지난 날은 서버가 거절하므로 미리 뺀다.
   */
  const bookableDates = useMemo(() => {
    if (!range) return [];
    const today = todayStr();
    return nextDatesForDay(range.day).filter(
      (d) => d !== today || range.startMin > nowMinutes(),
    );
  }, [range]);

  function pickRange(next: SelectedRange) {
    setBookingError(null);
    if (!isWithinFree(next)) {
      setBookingError(
        '참여자 중 수업이 있거나 예약할 수 없는 시간입니다. 분홍색으로 표시된 구간 안에서 선택해 주세요.',
      );
      return;
    }
    if (next.endMin - next.startMin > MAX_RESERVATION_MIN) {
      setBookingError(`학교 규정상 하루 최대 ${MAX_RESERVATION_MIN / 60}시간까지 이용할 수 있습니다.`);
      return;
    }
    setRange(next);
    setSelectedDate(null);
    setFacilities(null);
    setSelectedFacility(null);
  }

  async function copyCode() {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(detail.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('아래 코드를 복사해 주세요.', detail.code);
    }
  }

  async function reserve() {
    if (!detail || !selectedDate || !range || selectedFacility === null) return;
    setBookingError(null);
    setPending(true);
    try {
      const created = await api.post<Reservation>('/reservations', {
        meetingId: detail.id,
        facilityId: selectedFacility,
        date: selectedDate,
        startMin: range.startMin,
        endMin: range.endMin,
        memberIds: activeIds,
      });
      setSuccessMsg(
        `${created.facilityName}(${created.building})을 ${fmtDate(created.date)} ${fmtRange(
          created.startMin,
          created.endMin,
        )}에 예약했습니다.`,
      );
      setBookingGuide(
        selectedFacilityInfo
          ? {
              systemLabel: selectedFacilityInfo.systemLabel,
              reserveUrl: selectedFacilityInfo.reserveUrl,
              contact: selectedFacilityInfo.contact,
            }
          : null,
      );
      closeBooking();
      loadAll();
    } catch (err) {
      setBookingError(err instanceof Error ? err.message : '예약에 실패했습니다.');
    } finally {
      setPending(false);
    }
  }

  async function cancelReservation(r: Reservation) {
    if (!window.confirm(`${fmtDate(r.date)} ${r.facilityName} 예약을 취소할까요?`)) return;
    try {
      await api.del(`/reservations/${r.id}`);
      setSuccessMsg(null);
      loadAll();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '예약을 취소하지 못했습니다.');
    }
  }

  async function leaveOrDelete() {
    if (!detail || !user) return;
    const isOwner = detail.ownerId === user.id;
    const message = isOwner
      ? `'${detail.name}' 회의를 삭제할까요? 예약과 멤버 정보가 모두 삭제됩니다.`
      : `'${detail.name}' 회의에서 나갈까요?`;
    if (!window.confirm(message)) return;
    try {
      if (isOwner) await api.del(`/meetings/${detail.id}`);
      else await api.post(`/meetings/${detail.id}/leave`);
      navigate('/meetings');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '요청을 처리하지 못했습니다.');
    }
  }

  if (loadError) {
    return (
      <main className="page">
        <div className="alert alert-error">{loadError}</div>
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="page">
        <p className="empty-note">불러오는 중…</p>
      </main>
    );
  }

  const isOwner = user !== null && detail.ownerId === user.id;
  const selectedFacilityInfo = facilities?.find((f) => f.id === selectedFacility) ?? null;

  return (
    <main className="page">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 className="page-title">{detail.name}</h1>
          <p className="page-sub" style={{ marginBottom: 16 }}>
            회의 코드를 팀원에게 공유하면 함께 시간을 맞출 수 있습니다.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="badge badge-neutral code-badge" style={{ fontSize: 14, padding: '6px 14px' }}>
            {detail.code}
          </span>
          <button type="button" className="btn btn-outline btn-sm" onClick={copyCode}>
            {copied ? '복사됨' : '코드 복사'}
          </button>
          <button type="button" className="btn btn-danger-text btn-sm" onClick={leaveOrDelete}>
            {isOwner ? '회의 삭제' : '나가기'}
          </button>
        </div>
      </div>

      <section className="card">
        <h2 className="card-title">
          팀원 {detail.members.length}명{' '}
          <span className="row-sub" style={{ fontWeight: 400 }}>
            · 회의에 참여할 사람 {activeIds.length}명
          </span>
        </h2>
        <p className="row-sub" style={{ marginTop: -8, marginBottom: 12 }}>
          이름을 눌러 이번 회의에서 빼거나 다시 넣을 수 있습니다. 빠진 사람의 수업은 시간 계산에
          반영되지 않습니다.
        </p>
        <div className="chip-group">
          {detail.members.map((m, i) => {
            const on = activeIds.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                className={`chip member-chip${on ? ' selected' : ' off'}`}
                onClick={() => toggleParticipant(m.id)}
                aria-pressed={on}
              >
                <span
                  className="legend-dot"
                  style={{
                    background: on ? MEMBER_COLORS[i % MEMBER_COLORS.length] : 'var(--faint)',
                  }}
                />
                {m.name}
                {m.isOwner ? (
                  <span className="badge badge-neutral" style={{ marginLeft: 2 }}>
                    방장
                  </span>
                ) : null}
                {!on && <span className="member-chip-off">제외됨</span>}
              </button>
            );
          })}
        </div>
      </section>

      <section className="card">
        <div className="week-bar" style={{ marginBottom: 12 }}>
          <h2 className="card-title" style={{ margin: 0 }}>
            팀원 시간표
          </h2>
          <span className="week-label" style={{ fontSize: 14, color: 'var(--slate-3)' }}>
            {fmtWeekLabel(weekStart)}
          </span>
          {!isCurrentWeek(weekStart) && (
            <button type="button" className="btn btn-outline btn-sm" onClick={goToday}>
              이번 주로
            </button>
          )}
        </div>
        {memberEntries.length === 0 ? (
          <p className="empty-note">
            아직 등록된 시간표가 없습니다. 각자 시간표를 등록하면 여기에 겹쳐 보입니다.
          </p>
        ) : (
          <>
            <div className="legend">
              <span className="legend-item">
                <span className="legend-dot" style={{ background: 'var(--success)' }} />
                확정된 회의 예약 (팀원 전체 표시)
              </span>
            </div>
            <TimetableGrid
              entries={gridEntries}
              laneCount={detail.members.length}
              compact
              weekStart={weekStart}
              onPrevWeek={prevWeek}
              onNextWeek={nextWeek}
              slide={slide}
            />
          </>
        )}
      </section>

      <section className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 className="card-title" style={{ margin: 0, flex: 1 }}>
            회의 예약
          </h2>
          {!booking && (
            <button type="button" className="btn btn-primary" onClick={openBooking}>
              회의 예약
            </button>
          )}
        </div>

        {successMsg && (
          <div className="alert alert-success" style={{ marginTop: 16 }}>
            <div>{successMsg}</div>
            <div style={{ marginTop: 10 }}>
              <strong>아직 학교 예약은 끝나지 않았습니다.</strong>{' '}
              {bookingGuide?.systemLabel
                ? `${bookingGuide.systemLabel} 예약 시스템에서 같은 시간으로 신청을 완료해 주세요.`
                : '학교 예약 시스템에서 같은 시간으로 신청을 완료해 주세요.'}
              {bookingGuide?.contact ? ` (문의 ${bookingGuide.contact})` : ''}
            </div>
            {bookingGuide?.reserveUrl && (
              <a
                className="btn btn-primary btn-sm"
                style={{ marginTop: 12 }}
                href={bookingGuide.reserveUrl}
                target="_blank"
                rel="noreferrer"
              >
                {bookingGuide.systemLabel ?? '학교'} 예약 시스템 열기
              </a>
            )}
          </div>
        )}

        {booking && (
          <div style={{ marginTop: 20 }}>
            {bookingError && <div className="alert alert-error">{bookingError}</div>}

            <p className="step-label">
              <span className="step-num">1</span>시간표에서 회의 시간 드래그
            </p>
            {slots === null ? (
              !bookingError && <p className="empty-note">공통 여유 시간을 계산하는 중…</p>
            ) : slots.length === 0 ? (
              <p className="empty-note">
                모든 팀원이 함께 비는 시간이 없습니다. 팀원 시간표를 확인해 보세요.
              </p>
            ) : (
              <>
                <p className="row-sub" style={{ marginBottom: 10 }}>
                  <span className="legend-item">
                    <span className="legend-dot" style={{ background: 'rgb(219, 39, 119)' }} />
                    분홍색이 참여자 모두가 비는 시간입니다.
                  </span>{' '}
                  그 안에서 원하는 만큼 끌어 주세요. (최대 3시간)
                </p>
                <TimetableGrid
                  entries={gridEntries}
                  laneCount={detail.members.length}
                  freeRanges={freeRanges}
                  selectable
                  onSelectRange={pickRange}
                  pendingRange={range}
                  weekStart={weekStart}
                  onPrevWeek={prevWeek}
                  onNextWeek={nextWeek}
                  slide={slide}
                />
                {range && (
                  <p className="row-sub" style={{ marginTop: 10 }}>
                    선택: <strong>{DAY_NAMES[range.day]}요일 {fmtRange(range.startMin, range.endMin)}</strong>{' '}
                    ({fmtDuration(range.endMin - range.startMin)})
                  </p>
                )}
              </>
            )}

            {range && (
              <>
                <hr className="divider" />
                <p className="step-label">
                  <span className="step-num">2</span>날짜 선택
                </p>
                {bookableDates.length === 0 ? (
                  <p className="empty-note">
                    이 요일은 앞으로 {MAX_DAYS_AHEAD}일 안에 신청할 수 있는 날이 없습니다. 다른
                    요일을 골라 주세요.
                  </p>
                ) : (
                  <>
                    <div className="chip-group">
                      {bookableDates.map((d) => (
                        <button
                          key={d}
                          type="button"
                          className={`chip${selectedDate === d ? ' selected' : ''}`}
                          onClick={() => setSelectedDate(d)}
                        >
                          {fmtDate(d)}
                        </button>
                      ))}
                    </div>
                    <p className="row-sub" style={{ marginTop: 8 }}>
                      학교 규정상 이용일 {MAX_DAYS_AHEAD}일 전부터 신청할 수 있어 그 안의 날짜만
                      보여집니다.
                    </p>
                  </>
                )}
              </>
            )}

            {selectedDate && range && (
              <>
                <hr className="divider" />
                <p className="step-label">
                  <span className="step-num">3</span>시설 선택
                </p>
                {facilities === null ? (
                  !bookingError && <p className="empty-note">이용 가능한 시설을 확인하는 중…</p>
                ) : (
                  <>
                    {campusStatus === 'unavailable' && (
                      <div className="alert alert-error">
                        학교 예약 현황을 불러오지 못했습니다. 아래 목록은 우리 앱 기준이므로,
                        학교 사이트에서 실제 빈자리를 한 번 더 확인해 주세요.
                      </div>
                    )}
                    {hiddenByCapacity > 0 && (
                      <p className="row-sub" style={{ marginBottom: 10 }}>
                        참여 {activeIds.length}명 기준으로 인원 조건이 맞지 않는 시설{' '}
                        {hiddenByCapacity}곳은 목록에서 뺐습니다.
                      </p>
                    )}
                    <div className="facility-grid">
                      {facilities.map((f) => {
                        const blocked = f.available === false;
                        const capacityText =
                          f.minCapacity !== null && f.capacity !== null
                            ? `${f.minCapacity}~${f.capacity}명`
                            : f.capacity !== null
                              ? `최대 ${f.capacity}명`
                              : f.minCapacity !== null
                                ? `${f.minCapacity}명 이상`
                                : '인원 기준 없음';
                        return (
                          <div
                            key={f.id}
                            className={`facility-card${
                              selectedFacility === f.id ? ' selected' : ''
                            }${blocked ? ' unavailable' : ''}`}
                            onClick={blocked ? undefined : () => setSelectedFacility(f.id)}
                          >
                            <div className="facility-name">{f.name}</div>
                            <div className="facility-meta">
                              {f.building} · {capacityText}
                              {f.systemLabel ? ` · ${f.systemLabel}` : ''}
                            </div>
                            {f.description && (
                              <div className="facility-desc">{f.description}</div>
                            )}
                            {f.campusState === 'closed' ? (
                              <span className="badge badge-danger">학교 신청불가</span>
                            ) : f.campusState === 'reserved' ? (
                              <span className="badge badge-danger">학교에서 예약됨</span>
                            ) : f.plannedHere ? (
                              <span className="badge badge-neutral">우리 팀이 잡아 둠</span>
                            ) : (
                              <span className="badge badge-success">예약 가능</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            )}

            {selectedFacilityInfo && selectedDate && range && (
              <>
                <hr className="divider" />
                <div className="booking-summary">
                  <strong>{selectedFacilityInfo.name}</strong> ({selectedFacilityInfo.building}) ·{' '}
                  {fmtDate(selectedDate)} {fmtRange(range.startMin, range.endMin)} ·{' '}
                  {fmtDuration(range.endMin - range.startMin)}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-lg"
                    onClick={reserve}
                    disabled={pending}
                  >
                    {pending ? '예약 중…' : '예약하기'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-lg"
                    onClick={closeBooking}
                  >
                    취소
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">예약 현황</h2>
        {reservations.length === 0 ? (
          <p className="empty-note">아직 예약된 시설이 없습니다. 위의 회의 예약으로 시작해 보세요.</p>
        ) : (
          <div className="row-list">
            {reservations.map((r) => (
              <div key={r.id} className="row-item">
                <div className="grow">
                  <div className="row-main">
                    {r.facilityName} · {r.building}
                  </div>
                  <div className="row-sub">
                    {fmtDate(r.date)} {fmtRange(r.startMin, r.endMin)} · 예약자 {r.userName}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-danger-text btn-sm"
                  onClick={() => cancelReservation(r)}
                >
                  취소
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
