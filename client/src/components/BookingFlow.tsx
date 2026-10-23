import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import TimetableGrid, { GridLegend, MEMBER_COLORS, WeekNav } from './TimetableGrid';
import type { GridEntry, SelectedRange } from './TimetableGrid';
import {
  Alert,
  Badge,
  Button,
  Icon,
  LoadingBlock,
  SelectField,
  Sheet,
  Stepper,
  useDisplay,
  useToast,
} from '../ui';
import { useHideTabBar } from '../shell/Shell';
import {
  DAY_NAMES,
  MAX_DAYS_AHEAD,
  addDaysStr,
  fmtDate,
  fmtDayHeader,
  fmtDuration,
  fmtMin,
  fmtRange,
  fmtWeekLabel,
  isCurrentWeek,
  nextDatesForDay,
  nowMinutes,
  todayStr,
} from '../time';
import type { WeekSlide } from '../useWeek';
import type { Facility, FacilityResponse, FreeSlot, Member, Reservation } from '../types';
import '../pages/meeting-detail.css';

const STEPS = ['시간', '날짜', '시설', '확인'];
const STEP_MIN = 30;
/** 학교 규정: 하루 최대 3시간 */
const MAX_RESERVATION_MIN = 180;

export interface WeekControls {
  weekStart: string;
  slide: WeekSlide | null;
  prevWeek: () => void;
  nextWeek: () => void;
  goToday: () => void;
}

interface BookingFlowProps {
  open: boolean;
  onClose: () => void;
  meetingId: number;
  members: Member[];
  /** 이번 회의에 참여하는 팀원 id */
  activeIds: number[];
  /** 팀원 수업 + 이 회의의 예약을 합친 시간표 항목 */
  gridEntries: GridEntry[];
  week: WeekControls;
  /** 예약 계획이 만들어졌을 때. 흐름을 닫고 학교 신청 화면을 여는 일은 부모가 맡는다. */
  onBooked: (created: Reservation, facility: Facility) => void;
}

function sameRange(a: SelectedRange | null, b: SelectedRange | null): boolean {
  return Boolean(a && b && a.day === b.day && a.startMin === b.startMin && a.endMin === b.endMin);
}

function dayText(day: number): string {
  return `${DAY_NAMES[day]}요일`;
}

function capacityText(f: Facility): string {
  if (f.minCapacity !== null && f.capacity !== null) return `${f.minCapacity}~${f.capacity}명`;
  if (f.capacity !== null) return `최대 ${f.capacity}명`;
  if (f.minCapacity !== null) return `${f.minCapacity}명 이상`;
  return '인원 기준 없음';
}

/** 서버가 30분 단위가 아닌 경계를 주더라도 예약 가능한 30분 칸으로 맞춘다. */
function alignSlots(slots: FreeSlot[]): FreeSlot[] {
  return slots
    .map((s) => ({
      day: s.day,
      start: Math.ceil(s.start / STEP_MIN) * STEP_MIN,
      end: Math.floor(s.end / STEP_MIN) * STEP_MIN,
    }))
    .filter((s) => s.end - s.start >= STEP_MIN);
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function FacilityStatus({ f }: { f: Facility }) {
  if (f.campusState === 'closed') return <Badge tone="danger">학교 신청불가</Badge>;
  if (f.campusState === 'reserved') return <Badge tone="danger">학교에서 예약됨</Badge>;
  if (f.plannedHere) return <Badge tone="gray">우리 팀이 잡아 둠</Badge>;
  return <Badge tone="success">예약 가능</Badge>;
}

/**
 * 단계별 회의 예약 흐름 (전체 화면 시트): 시간 → 날짜 → 시설 → 확인.
 * 부모가 key 를 바꿔 다시 마운트하면 선택 상태가 모두 처음으로 돌아간다. (cody 의 resetFlow)
 */
export default function BookingFlow({
  open,
  onClose,
  meetingId,
  members,
  activeIds,
  gridEntries,
  week,
  onBooked,
}: BookingFlowProps) {
  const toast = useToast();
  const { zoom } = useDisplay();
  useHideTabBar(open);

  const hintId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const pendingRef = useRef(false);

  const [step, setStep] = useState(1);
  const [slots, setSlots] = useState<FreeSlot[] | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [slotsTick, setSlotsTick] = useState(0);
  const [range, setRange] = useState<SelectedRange | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [facilities, setFacilities] = useState<Facility[] | null>(null);
  const [facilitiesError, setFacilitiesError] = useState<string | null>(null);
  const [facilitiesTick, setFacilitiesTick] = useState(0);
  const [campusStatus, setCampusStatus] = useState<'ok' | 'unavailable' | 'skipped'>('skipped');
  const [hiddenByCapacity, setHiddenByCapacity] = useState(0);
  const [selectedFacility, setSelectedFacility] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const activeKey = activeIds.join(',');
  const peopleCount = activeIds.length;

  const alignedSlots = useMemo(() => alignSlots(slots ?? []), [slots]);
  const freeRanges: SelectedRange[] = useMemo(
    () => alignedSlots.map((s) => ({ day: s.day, startMin: s.start, endMin: s.end })),
    [alignedSlots],
  );

  /** 선택한 시간이 들어 있는 여유 구간 (시작·종료 시각 목록의 범위) */
  const activeSlot = useMemo(
    () =>
      range
        ? (alignedSlots.find(
            (s) => s.day === range.day && range.startMin >= s.start && range.endMin <= s.end,
          ) ?? null)
        : null,
    [alignedSlots, range],
  );

  const bookableDates = useMemo(() => {
    if (!range) return [];
    const today = todayStr();
    return nextDatesForDay(range.day).filter((d) => d !== today || range.startMin > nowMinutes());
  }, [range]);

  const selectedFacilityInfo = facilities?.find((f) => f.id === selectedFacility) ?? null;
  const split = useMemo(() => {
    if (!facilities) return null;
    return {
      ok: facilities.filter((f) => f.available !== false),
      blocked: facilities.filter((f) => f.available === false),
    };
  }, [facilities]);

  /* ── 팀원 공통 여유 시간: 흐름이 열려 있는 동안, 참여자·주가 바뀔 때마다 다시 조회 ── */
  useEffect(() => {
    if (!open || peopleCount === 0) return;
    let cancelled = false;
    // 새 결과가 오기 전에 옛 여유 시간을 보여 주면 오해하기 쉬워 먼저 비운다.
    setSlots(null);
    setSlotsError(null);
    api
      .get<FreeSlot[]>(
        `/meetings/${meetingId}/free-slots?duration=30&week=${week.weekStart}&members=${activeKey}`,
      )
      .then((s) => {
        if (!cancelled) setSlots(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) setSlotsError(errorMessage(err, '여유 시간을 계산하지 못했습니다.'));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, meetingId, week.weekStart, activeKey, slotsTick]);

  /* ── 열려 있는 동안 팀원 구성이 바뀌면(누가 참가·퇴장) 선택을 처음부터 다시 시작 ── */
  const prevKey = useRef(activeKey);
  useEffect(() => {
    if (prevKey.current === activeKey) return;
    prevKey.current = activeKey;
    setRange(null);
    setSelectedDate(null);
    setFacilities(null);
    setSelectedFacility(null);
    setPickError(null);
    setSubmitError(null);
    setStep(1);
    if (openRef.current) {
      setNotice(
        '팀원 구성이 바뀌어 선택을 처음부터 다시 시작합니다. 바뀐 참여 인원으로 여유 시간을 다시 계산했습니다.',
      );
    }
  }, [activeKey]);

  /* ── 날짜와 시간이 정해지면 이용할 수 있는 시설을 조회 ── */
  useEffect(() => {
    if (!selectedDate || !range) {
      setFacilities(null);
      setSelectedFacility(null);
      return;
    }
    let cancelled = false;
    setFacilities(null);
    setSelectedFacility(null);
    setFacilitiesError(null);
    api
      .get<FacilityResponse>(
        `/facilities?date=${selectedDate}&start=${range.startMin}&end=${range.endMin}&people=${peopleCount}`,
      )
      .then((r) => {
        if (cancelled) return;
        setFacilities(r.facilities);
        setCampusStatus(r.campusStatus);
        setHiddenByCapacity(r.hiddenByCapacity ?? 0);
      })
      .catch((err: unknown) => {
        if (!cancelled) setFacilitiesError(errorMessage(err, '시설 목록을 불러오지 못했습니다.'));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate, range, peopleCount, facilitiesTick]);

  // 시설 선택이 사라졌는데(목록을 다시 불러옴) 확인 단계에 있으면 시설 단계로 돌린다.
  useEffect(() => {
    if (step === 4 && !selectedFacilityInfo) setStep(3);
  }, [step, selectedFacilityInfo]);

  // 단계가 바뀌면 새 단계의 제목으로 포커스를 옮기고 맨 위로 보낸다.
  const stepMounted = useRef(false);
  useEffect(() => {
    if (!stepMounted.current) {
      stepMounted.current = true;
      return;
    }
    const heading = headingRef.current;
    heading?.closest('.sheet__body')?.scrollTo({ top: 0 });
    heading?.focus({ preventScroll: true });
  }, [step]);

  /* ── 시간 고르기 ── */
  function applyRange(next: SelectedRange) {
    setPickError(null);
    setSubmitError(null);
    setNotice(null);
    if (sameRange(range, next)) return;
    setRange(next);
    // 시간이 바뀌면 날짜·시설은 다시 고른다.
    setSelectedDate(null);
    setFacilities(null);
    setSelectedFacility(null);
  }

  function isWithinFree(next: SelectedRange): boolean {
    return alignedSlots.some(
      (s) => s.day === next.day && next.startMin >= s.start && next.endMin <= s.end,
    );
  }

  /** 시간표를 끌어서 고른 구간 */
  function pickFromGrid(next: SelectedRange) {
    setPickError(null);
    if (!isWithinFree(next)) {
      setPickError(
        '참여자 중 수업이 있거나 예약할 수 없는 시간입니다. 시간표에서 배경이 칠해진 “모두 비는 시간” 구간 안에서 선택해 주세요.',
      );
      return;
    }
    if (next.endMin - next.startMin > MAX_RESERVATION_MIN) {
      setPickError(`학교 규정상 하루 최대 ${MAX_RESERVATION_MIN / 60}시간까지 이용할 수 있습니다.`);
      return;
    }
    applyRange(next);
  }

  function changeStart(value: number) {
    if (!range || !activeSlot) return;
    const duration = range.endMin - range.startMin;
    const maxEnd = Math.min(activeSlot.end, value + MAX_RESERVATION_MIN);
    let end = range.endMin;
    if (end <= value) end = Math.min(maxEnd, value + duration);
    if (end > maxEnd) end = maxEnd;
    applyRange({ day: range.day, startMin: value, endMin: end });
  }

  function changeEnd(value: number) {
    if (!range) return;
    applyRange({ ...range, endMin: value });
  }

  const startOptions: number[] = [];
  const endOptions: number[] = [];
  if (range && activeSlot) {
    for (let m = activeSlot.start; m <= activeSlot.end - STEP_MIN; m += STEP_MIN) startOptions.push(m);
    const maxEnd = Math.min(activeSlot.end, range.startMin + MAX_RESERVATION_MIN);
    for (let m = range.startMin + STEP_MIN; m <= maxEnd; m += STEP_MIN) endOptions.push(m);
  }

  /* ── 예약하기 ── */
  async function submit() {
    if (pendingRef.current || !range || !selectedDate || selectedFacility === null) return;
    const facility = selectedFacilityInfo;
    if (!facility) return;
    pendingRef.current = true;
    setPending(true);
    setSubmitError(null);
    try {
      const created = await api.post<Reservation>('/reservations', {
        meetingId,
        facilityId: selectedFacility,
        date: selectedDate,
        startMin: range.startMin,
        endMin: range.endMin,
        memberIds: activeIds,
      });
      onBooked(created, facility);
    } catch (err) {
      const message = errorMessage(err, '예약하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      // 응답을 기다리는 사이 흐름을 닫았다면 화면 안 오류를 볼 수 없으니 알림으로 남긴다.
      if (openRef.current) setSubmitError(message);
      else toast(message);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  /* ── 하단 버튼 ── */
  const canNext =
    step === 1 ? range !== null : step === 2 ? selectedDate !== null : step === 3 ? selectedFacilityInfo !== null : !pending;

  function goStep(next: number) {
    setSubmitError(null);
    setStep(next);
  }

  function onNext() {
    if (!canNext) return;
    if (step === 4) {
      void submit();
      return;
    }
    goStep(step + 1);
  }

  function onPrev() {
    if (step === 1) onClose();
    else goStep(step - 1);
  }

  const durationText = range ? fmtDuration(range.endMin - range.startMin) : '';
  const rangeText = range ? `${dayText(range.day)} ${fmtRange(range.startMin, range.endMin)}` : '';

  let hint: string;
  if (step === 1) {
    if (range) hint = `선택한 시간: ${rangeText} (${durationText})`;
    else if (peopleCount === 0) hint = '회의에 참여할 팀원이 없어 시간을 고를 수 없습니다.';
    else if (slots !== null && alignedSlots.length === 0)
      hint = '함께 비는 시간이 없어 다음으로 갈 수 없습니다.';
    else hint = '시간을 고르면 다음으로 갈 수 있습니다.';
  } else if (step === 2) {
    hint =
      selectedDate && range
        ? `선택한 날짜: ${fmtDate(selectedDate)} ${fmtRange(range.startMin, range.endMin)}`
        : '날짜를 골라 주세요.';
  } else if (step === 3) {
    hint = selectedFacilityInfo
      ? `선택한 시설: ${selectedFacilityInfo.name}`
      : facilities === null && !facilitiesError
        ? '이용 가능한 시설을 확인하는 중입니다.'
        : '시설을 골라 주세요.';
  } else {
    hint =
      selectedFacilityInfo && selectedDate && range
        ? `${selectedFacilityInfo.name} (${selectedFacilityInfo.building}) · ${fmtDate(selectedDate)} ${fmtRange(range.startMin, range.endMin)} · ${durationText}`
        : '';
  }

  const weekEnd = addDaysStr(week.weekStart, 4);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="회의 예약"
      full
      initialFocus=".mtg-step-title"
      footer={
        <div className="mtg-foot">
          <p className="mtg-foot__hint" id={hintId} aria-live="polite">
            {hint}
          </p>
          <div className="mtg-foot__btns">
            <Button variant="tertiary" size="lg" onClick={onPrev} disabled={pending}>
              {step === 1 ? '취소' : '이전'}
            </Button>
            <Button
              variant="primary"
              size="lg"
              onClick={onNext}
              aria-disabled={!canNext || undefined}
              aria-describedby={hintId}
              loading={pending}
            >
              {step === 4 ? (pending ? '준비 중…' : '학교에 신청하기') : '다음'}
            </Button>
          </div>
        </div>
      }
    >
      {/* 글자를 크게 쓰면 위·아래 고정 영역이 화면을 너무 차지하므로 단계 표시기는 함께 스크롤한다. */}
      <div className={`mtg-flow__steps${zoom >= 1.3 ? ' mtg-flow__steps--static' : ''}`}>
        <Stepper steps={STEPS} current={step} />
      </div>

      {/* ─────────── 1단계 시간 ─────────── */}
      {step === 1 && (
        <div className="stack-lg">
          <div>
            <h3 className="section__title mtg-step-title" tabIndex={-1} ref={headingRef}>
              시간 고르기
            </h3>
            <p className="section__sub">
              팀원이 모두 비는 시간 안에서 고릅니다. 하루 최대 {MAX_RESERVATION_MIN / 60}시간까지
              이용할 수 있습니다.
            </p>
          </div>

          {notice && <Alert tone="info">{notice}</Alert>}
          {pickError && <Alert tone="danger">{pickError}</Alert>}

          <WeekNav
            label={fmtWeekLabel(week.weekStart)}
            sub={`${fmtDayHeader(week.weekStart)} ~ ${fmtDayHeader(weekEnd)}`}
            onPrev={week.prevWeek}
            onNext={week.nextWeek}
            onToday={isCurrentWeek(week.weekStart) ? undefined : week.goToday}
          />

          {peopleCount === 0 ? (
            <Alert tone="warning">
              회의에 참여할 팀원이 없습니다. 창을 닫고 팀원 이름을 눌러 다시 넣어 주세요.
            </Alert>
          ) : slotsError ? (
            // 알림 안의 다시 시도 버튼도 터치 대상 최소 44px 를 지켜야 하므로 sm(40) 이 아닌 기본(48) 크기를 쓴다.
            // (이 파일의 다른 알림 버튼도 같은 이유로 기본 크기다.)
            <Alert
              tone="danger"
              title="여유 시간을 계산하지 못했습니다."
              actions={
                <Button variant="secondary" onClick={() => setSlotsTick((n) => n + 1)}>
                  다시 시도하기
                </Button>
              }
            >
              {slotsError}
            </Alert>
          ) : slots === null ? (
            <LoadingBlock>공통 여유 시간을 계산하는 중입니다.</LoadingBlock>
          ) : alignedSlots.length === 0 ? (
            <Alert tone="warning">
              모든 팀원이 함께 비는 시간이 없습니다. 팀원 시간표를 확인해 보세요. 다른 주로 넘겨
              보거나, 참여하지 않는 팀원을 뺄 수도 있습니다.
            </Alert>
          ) : null}

          {range && activeSlot && (
            <section aria-labelledby={`${hintId}-adjust`}>
              <h4 className="mtg-sub-title" id={`${hintId}-adjust`}>
                시작·종료 시각
              </h4>
              <div className="form-row">
                <SelectField
                  label="시작 시각"
                  value={range.startMin}
                  onChange={(e) => changeStart(Number(e.target.value))}
                >
                  {startOptions.map((m) => (
                    <option key={m} value={m}>
                      {fmtMin(m)}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  label="종료 시각"
                  value={range.endMin}
                  onChange={(e) => changeEnd(Number(e.target.value))}
                >
                  {endOptions.map((m) => (
                    <option key={m} value={m}>
                      {fmtMin(m)} ({fmtDuration(m - range.startMin)})
                    </option>
                  ))}
                </SelectField>
              </div>
            </section>
          )}

          {peopleCount > 0 && !slotsError && (
            <section aria-labelledby={`${hintId}-grid`}>
              <h4 className="mtg-sub-title" id={`${hintId}-grid`}>
                시간표에서 고르기
              </h4>
              <p className="field__help mtg-grid__help">
                {alignedSlots.length > 0
                  ? '“모두 비는 시간”으로 칠해진 구간 안을 눌러 고를 수 있습니다. 한 번 누르면 30분이 선택되고, 길게 눌러 끌면 범위를 고를 수 있습니다.'
                  : '팀원 수업이 겹치는 시간표입니다.'}
              </p>
              {alignedSlots.length > 0 && <GridLegend items={['free', 'pending']} />}
              <div className="mtg-grid">
                <TimetableGrid
                  entries={gridEntries}
                  laneCount={members.length}
                  freeRanges={freeRanges}
                  selectable={alignedSlots.length > 0}
                  onSelectRange={pickFromGrid}
                  pendingRange={range}
                  weekStart={week.weekStart}
                  slide={week.slide}
                />
              </div>
              <ul className="mtg-legend mtg-flow-legend" aria-label="팀원별 색 안내">
                {members.map((m, i) => (
                  <li key={m.id} className="mtg-legend__item">
                    <span
                      className="mtg-legend__dot"
                      style={{ background: MEMBER_COLORS[i % MEMBER_COLORS.length] }}
                      aria-hidden="true"
                    />
                    {m.name}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* ─────────── 2단계 날짜 ─────────── */}
      {step === 2 && range && (
        <div className="stack-lg">
          <div>
            <h3 className="section__title mtg-step-title" tabIndex={-1} ref={headingRef}>
              날짜 고르기
            </h3>
            <p className="section__sub">
              {rangeText} ({durationText})에 이용할 날짜를 골라 주세요.
            </p>
          </div>

          {bookableDates.length === 0 ? (
            <Alert
              tone="warning"
              actions={
                <Button variant="secondary" onClick={() => goStep(1)}>
                  시간 다시 고르기
                </Button>
              }
            >
              이 요일은 앞으로 {MAX_DAYS_AHEAD}일 안에 신청할 수 있는 날이 없습니다. 다른 요일을 골라
              주세요. 학교 규정상 이용일 {MAX_DAYS_AHEAD}일 전부터 신청할 수 있습니다.
            </Alert>
          ) : (
            <section>
              <div className="tag-group" role="group" aria-label="이용 날짜">
                {bookableDates.map((d) => {
                  const chosen = selectedDate === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      className="tag mtg-date"
                      aria-pressed={chosen}
                      onClick={() => {
                        setSubmitError(null);
                        setSelectedDate(d);
                      }}
                    >
                      {chosen && <Icon name="check" className="tag__check" />}
                      {fmtDate(d)}
                      {d === todayStr() && <span className="text-sm">오늘</span>}
                    </button>
                  );
                })}
              </div>
              <p className="field__help mtg-slots__help">
                학교 규정상 이용일 {MAX_DAYS_AHEAD}일 전부터 신청할 수 있어 그 안의 날짜만
                보여집니다.
              </p>
            </section>
          )}
        </div>
      )}

      {/* ─────────── 3단계 시설 ─────────── */}
      {step === 3 && range && selectedDate && (
        <div className="stack-lg">
          <div>
            <h3 className="section__title mtg-step-title" tabIndex={-1} ref={headingRef}>
              시설 고르기
            </h3>
            <p className="section__sub">
              {fmtDate(selectedDate)} {fmtRange(range.startMin, range.endMin)} · 참여 {peopleCount}명
              기준입니다.
            </p>
          </div>

          {facilitiesError ? (
            <Alert
              tone="danger"
              title="시설 목록을 불러오지 못했습니다."
              actions={
                <Button variant="secondary" onClick={() => setFacilitiesTick((n) => n + 1)}>
                  다시 시도하기
                </Button>
              }
            >
              {facilitiesError}
            </Alert>
          ) : facilities === null || split === null ? (
            <LoadingBlock>이용 가능한 시설을 확인하는 중입니다.</LoadingBlock>
          ) : (
            <>
              {campusStatus === 'unavailable' && (
                <Alert tone="warning">
                  학교 예약 현황을 불러오지 못했습니다. 아래 목록은 우리 앱 기준이므로, 학교
                  사이트에서 실제 빈자리를 한 번 더 확인해 주세요.
                </Alert>
              )}
              {hiddenByCapacity > 0 && (
                <p className="text-sub text-sm">
                  참여 {peopleCount}명 기준으로 인원 조건이 맞지 않는 시설 {hiddenByCapacity}곳은
                  목록에서 뺐습니다.
                </p>
              )}

              <section aria-labelledby={`${hintId}-ok`}>
                <h4 className="mtg-sub-title" id={`${hintId}-ok`}>
                  예약할 수 있는 시설 {split.ok.length}곳
                </h4>
                {split.ok.length === 0 ? (
                  <Alert
                    tone="warning"
                    actions={
                      <Button variant="secondary" onClick={() => goStep(2)}>
                        날짜 다시 고르기
                      </Button>
                    }
                  >
                    이 시간에 예약할 수 있는 시설이 없습니다. 다른 날짜나 시간을 골라 주세요.
                  </Alert>
                ) : (
                  <ul className="mtg-fac-list">
                    {split.ok.map((f) => (
                      <li key={f.id}>
                        <FacilityCard
                          f={f}
                          selected={selectedFacility === f.id}
                          onSelect={() => {
                            setSubmitError(null);
                            setSelectedFacility(f.id);
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {split.blocked.length > 0 && (
                <details className="mtg-more" open={split.ok.length === 0}>
                  <summary>
                    <span>이용할 수 없는 시설 {split.blocked.length}곳</span>
                    <Icon name="chevron-down" className="mtg-more__chev" />
                  </summary>
                  <ul className="mtg-fac-list">
                    {split.blocked.map((f) => (
                      <li key={f.id}>
                        <FacilityCard f={f} selected={false} onSelect={() => undefined} />
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      )}

      {/* ─────────── 4단계 확인 ─────────── */}
      {step === 4 && range && selectedDate && selectedFacilityInfo && (
        <div className="stack-lg">
          <div>
            <h3 className="section__title mtg-step-title" tabIndex={-1} ref={headingRef}>
              예약 내용 확인
            </h3>
            <p className="section__sub">내용이 맞으면 학교에 신청하기를 눌러 주세요.</p>
          </div>

          {submitError && (
            <Alert tone="danger" title="예약하지 못했습니다.">
              {submitError} 입력한 내용은 그대로 남아 있습니다. 이전 단계에서 바꾼 뒤 다시 시도해
              주세요.
            </Alert>
          )}

          <div className="card mtg-summary">
            <dl>
              <div className="kv">
                <dt className="kv__key">시설</dt>
                <dd className="kv__val bold">{selectedFacilityInfo.name}</dd>
              </div>
              <div className="kv">
                <dt className="kv__key">건물</dt>
                <dd className="kv__val">{selectedFacilityInfo.building}</dd>
              </div>
              <div className="kv">
                <dt className="kv__key">날짜</dt>
                <dd className="kv__val">{fmtDate(selectedDate)}</dd>
              </div>
              <div className="kv">
                <dt className="kv__key">시간</dt>
                <dd className="kv__val tabular">{fmtRange(range.startMin, range.endMin)}</dd>
              </div>
              <div className="kv">
                <dt className="kv__key">이용 시간</dt>
                <dd className="kv__val">{durationText}</dd>
              </div>
              <div className="kv">
                <dt className="kv__key">참여 인원</dt>
                <dd className="kv__val">
                  {peopleCount}명
                  <span className="mtg-summary__names">
                    {members
                      .filter((m) => activeIds.includes(m.id))
                      .map((m) => m.name)
                      .join(', ')}
                  </span>
                </dd>
              </div>
            </dl>
          </div>

          <Alert tone="info" title="다음 화면에서 학교에 바로 신청해요.">
            학교에 신청하기를 누르면 {selectedFacilityInfo.systemLabel ?? '학교'} 예약 시스템에 보낼
            내용을 한 번 더 보여 드려요. 거기서 확인하고 보내기 전에는 아무것도 신청되지 않고,
            신청하지 않고 닫으면 예약도 만들어지지 않아요.
          </Alert>
        </div>
      )}
    </Sheet>
  );
}

function FacilityCard({
  f,
  selected,
  onSelect,
}: {
  f: Facility;
  selected: boolean;
  onSelect: () => void;
}) {
  const blocked = f.available === false;
  return (
    <button
      type="button"
      className="mtg-fac"
      aria-pressed={blocked ? undefined : selected}
      aria-disabled={blocked || undefined}
      onClick={blocked ? undefined : onSelect}
    >
      <span className="mtg-fac__head">
        <span className="mtg-fac__name">{f.name}</span>
        <FacilityStatus f={f} />
      </span>
      <span className="mtg-fac__meta">
        {f.building} · {capacityText(f)}
        {f.systemLabel ? ` · ${f.systemLabel}` : ''}
      </span>
      {f.description && <span className="mtg-fac__desc">{f.description}</span>}
      {selected && (
        <span className="mtg-fac__picked">
          <Icon name="check" className="mtg-fac__check" />
          선택됨
        </span>
      )}
    </button>
  );
}
