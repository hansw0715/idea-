import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import TimetableGrid, { GridLegend, WeekNav } from './TimetableGrid';
import type { GridEntry, SelectedRange } from './TimetableGrid';
import MeetingParticipants from './MeetingParticipants';
import {
  Alert,
  Badge,
  Button,
  Icon,
  LoadingBlock,
  Sheet,
  Stepper,
  useDisplay,
  useToast,
} from '../ui';
import { useHideTabBar } from '../shell/Shell';
import {
  MAX_DAYS_AHEAD,
  addDaysStr,
  fmtDate,
  fmtDayHeader,
  fmtDuration,
  fmtRange,
  fmtWeekLabel,
  isCurrentWeek,
  nowMinutes,
  todayStr,
} from '../time';
import type { WeekSlide } from '../useWeek';
import type { Facility, FacilityResponse, FreeSlot, Member, Reservation } from '../types';
import '../pages/meeting-detail.css';

const STEPS = ['시간', '시설', '확인'];
/** 학교 시설은 모두 1시간 단위(정각 시작)로 신청한다 — 회의 예약도 1시간 단위로 고른다 */
const STEP_MIN = 60;
/** 한 번에 잡을 수 있는 최대 시간. 시설마다 더 짧을 수 있다(대부분 3시간, 코딩라운지 6시간) — 시설 단계에서 안내한다 */
const MAX_RESERVATION_MIN = 360;

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
  onToggleParticipant: (id: number) => void;
  /** 팀원 수업 + 이 회의의 예약을 합친 시간표 항목 */
  gridEntries: GridEntry[];
  week: WeekControls;
  /** 예약 계획이 만들어졌을 때. 흐름을 닫고 학교 신청 화면을 여는 일은 부모가 맡는다. */
  /** 시설 없이 잡았으면 facility 는 null */
  onBooked: (created: Reservation, facility: Facility | null) => void;
}

function sameRange(a: SelectedRange | null, b: SelectedRange | null): boolean {
  return Boolean(a && b && a.day === b.day && a.startMin === b.startMin && a.endMin === b.endMin);
}

function capacityText(f: Facility): string {
  if (f.minCapacity !== null && f.capacity !== null) return `${f.minCapacity}~${f.capacity}명`;
  if (f.capacity !== null) return `최대 ${f.capacity}명`;
  if (f.minCapacity !== null) return `${f.minCapacity}명 이상`;
  return '인원 기준 없음';
}

/** 서버의 여유 구간을 학교 시설의 정각 1시간 단위로 맞춘다. */
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
  // 학교 규정(인원 외: 이용 시간·마감·신청 기간)에 맞지 않으면 그 이유를 그대로 보여 준다
  if (f.ruleReason) return <Badge tone="gray">{f.ruleReason}</Badge>;
  if (f.campusState === 'closed') return <Badge tone="danger">학교 신청불가</Badge>;
  if (f.campusState === 'reserved') return <Badge tone="danger">학교에서 예약됨</Badge>;
  if (f.plannedHere) return <Badge tone="gray">우리 팀이 잡아 둠</Badge>;
  return <Badge tone="success">예약 가능</Badge>;
}

/**
 * 단계별 회의 예약 흐름 (전체 화면 시트): 시간 → 시설 → 확인.
 * 부모가 key 를 바꿔 다시 마운트하면 선택 상태가 모두 처음으로 돌아간다. (cody 의 resetFlow)
 */
export default function BookingFlow({
  open,
  onClose,
  meetingId,
  members,
  activeIds,
  onToggleParticipant,
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
  const selectedDate = range ? addDaysStr(week.weekStart, range.day) : null;
  const [facilities, setFacilities] = useState<Facility[] | null>(null);
  const [facilitiesError, setFacilitiesError] = useState<string | null>(null);
  const [facilitiesTick, setFacilitiesTick] = useState(0);
  const [campusStatus, setCampusStatus] = useState<'ok' | 'unavailable' | 'skipped'>('skipped');
  const [hiddenByCapacity, setHiddenByCapacity] = useState(0);
  const [selectedFacility, setSelectedFacility] = useState<number | null>(null);
  /** "시설 없이 예약하기"를 골랐다 (장소가 필요 없는 회의) */
  const [noFacility, setNoFacility] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [editingMembers, setEditingMembers] = useState(false);
  const [slotsContext, setSlotsContext] = useState('');

  const activeKey = activeIds.join(',');
  const peopleCount = activeIds.length;
  const scheduleKey = JSON.stringify(gridEntries.map((e) => [e.kind, e.memberIndex, e.day, e.startMin, e.endMin]));
  const availabilityKey = `${meetingId}|${week.weekStart}|${activeKey}|${scheduleKey}`;
  const currentSlots = slotsContext === availabilityKey ? slots : null;

  const alignedSlots = useMemo(() => {
    const today = todayStr();
    return alignSlots(currentSlots ?? []).flatMap((slot) => {
      const date = addDaysStr(week.weekStart, slot.day);
      if (date < today) return [];
      const start = date === today
        ? Math.max(slot.start, (Math.floor(nowMinutes() / STEP_MIN) + 1) * STEP_MIN)
        : slot.start;
      return slot.end - start >= STEP_MIN ? [{ ...slot, start }] : [];
    });
  }, [currentSlots, week.weekStart]);
  const freeRanges: SelectedRange[] = useMemo(
    () => alignedSlots.map((s) => ({ day: s.day, startMin: s.start, endMin: s.end })),
    [alignedSlots],
  );

  /** 선택한 시간이 들어 있는 여유 구간 */
  const activeSlot = useMemo(
    () =>
      range
        ? (alignedSlots.find(
            (s) => s.day === range.day && range.startMin >= s.start && range.endMin <= s.end,
          ) ?? null)
        : null,
    [alignedSlots, range],
  );

  /** 고른 날짜가 학교 시설 신청 기간(7일)보다 멀다 → 시설 없이만 잡을 수 있다 */
  const beyondFacilityWindow = selectedDate !== null && selectedDate > addDaysStr(todayStr(), MAX_DAYS_AHEAD);

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
    setSlotsContext(availabilityKey);
    setSlotsError(null);
    api
      .get<FreeSlot[]>(
        `/meetings/${meetingId}/free-slots?duration=${STEP_MIN}&week=${week.weekStart}&members=${activeKey}`,
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
  }, [open, availabilityKey, slotsTick]);

  /* ── 열려 있는 동안 팀원 구성이 바뀌면(누가 참가·퇴장) 선택을 처음부터 다시 시작 ── */
  const prevKey = useRef(availabilityKey);
  useEffect(() => {
    if (prevKey.current === availabilityKey) return;
    prevKey.current = availabilityKey;
    setRange(null);
    setFacilities(null);
    setSelectedFacility(null);
    setPickError(null);
    setNoFacility(false);
    setFacilitiesError(null);
    setSubmitError(null);
    setStep(1);
    if (openRef.current) {
      setNotice(
        '인원 또는 시간표가 바뀌었습니다. 시간을 다시 선택해 주세요.',
      );
    }
  }, [availabilityKey]);

  /* ── 날짜와 시간이 정해지면 이용할 수 있는 시설을 조회 ── */
  useEffect(() => {
    // 날짜가 바뀌면 시설 선택은 처음부터. 7일보다 먼 날짜는 시설을 쓸 수 없어 "시설 없이"를 미리 골라 둔다
    const beyond = selectedDate !== null && selectedDate > addDaysStr(todayStr(), MAX_DAYS_AHEAD);
    setNoFacility(beyond);
    if (!selectedDate || !range || beyond) {
      setFacilities(selectedDate ? [] : null);
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
    if (step === 3 && !selectedFacilityInfo && !noFacility) setStep(2);
  }, [step, selectedFacilityInfo, noFacility]);

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

  /* ── 시간 선택 ── */
  function applyRange(next: SelectedRange) {
    setPickError(null);
    setSubmitError(null);
    setNotice(null);
    if (sameRange(range, next)) return;
    setRange(next);
    // 날짜는 보고 있는 주와 선택한 열에서 정하고, 시설 선택만 초기화한다.
    setFacilities(null);
    setSelectedFacility(null);
  }

  function isWithinFree(next: SelectedRange): boolean {
    return alignedSlots.some(
      (s) => s.day === next.day && next.startMin >= s.start && next.endMin <= s.end,
    );
  }

  /** 시간표를 끌어서 고른 구간 — 1시간 단위(정각)로 맞춘다. 한 번 누르면 그 시각부터 1시간 */
  function pickFromGrid(picked: SelectedRange) {
    setPickError(null);
    const startMin = Math.floor(picked.startMin / STEP_MIN) * STEP_MIN;
    const date = addDaysStr(week.weekStart, picked.day);
    if (date < todayStr() || (date === todayStr() && startMin <= nowMinutes())) {
      setPickError('이미 지난 시간입니다. 시간표에서 앞으로의 시간을 선택해 주세요.');
      return;
    }
    const next: SelectedRange = {
      day: picked.day,
      startMin,
      endMin: Math.max(startMin + STEP_MIN, Math.ceil(picked.endMin / STEP_MIN) * STEP_MIN),
    };
    if (!isWithinFree(next)) {
      setPickError(
        '참여자의 일정이 있거나 예약할 수 없는 시간입니다. 빈 칸에서 시간을 다시 선택해 주세요.',
      );
      return;
    }
    if (next.endMin - next.startMin > MAX_RESERVATION_MIN) {
      setPickError(`한 번에 최대 ${MAX_RESERVATION_MIN / 60}시간까지 잡을 수 있습니다.`);
      return;
    }
    applyRange(next);
  }

  /* ── 예약하기 ── */
  async function submit() {
    if (pendingRef.current || !range || !selectedDate) return;
    if (selectedDate < todayStr() || (selectedDate === todayStr() && range.startMin <= nowMinutes())) {
      setSubmitError('선택한 시간이 지났습니다. 이전 단계에서 시간을 다시 선택해 주세요.');
      return;
    }
    const facility = noFacility ? null : selectedFacilityInfo;
    if (!noFacility && !facility) return;
    pendingRef.current = true;
    setPending(true);
    setSubmitError(null);
    try {
      const created = await api.post<Reservation>('/reservations', {
        meetingId,
        facilityId: noFacility ? null : selectedFacility,
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
    step === 1
      ? range !== null && activeSlot !== null && peopleCount > 0 && !slotsError
      : step === 2
        ? noFacility || selectedFacilityInfo !== null
        : !pending;

  function goStep(next: number) {
    setSubmitError(null);
    setStep(next);
  }

  function onNext() {
    if (!canNext) return;
    if (step === 3) {
      void submit();
      return;
    }
    if (step === 1 && selectedDate && range &&
        (selectedDate < todayStr() || (selectedDate === todayStr() && range.startMin <= nowMinutes()))) {
      setPickError('선택한 시간이 지났습니다. 시간을 다시 선택해 주세요.');
      return;
    }
    goStep(step + 1);
  }

  function onPrev() {
    if (step === 1) onClose();
    else goStep(step - 1);
  }

  const durationText = range ? fmtDuration(range.endMin - range.startMin) : '';
  const rangeText = range && selectedDate ? `${fmtDate(selectedDate)} ${fmtRange(range.startMin, range.endMin)}` : '';

  let hint: string;
  if (step === 1) {
    if (range && activeSlot) hint = `${rangeText} · ${durationText}`;
    else if (peopleCount === 0) hint = '참여할 팀원을 선택해 주세요.';
    else if (currentSlots !== null && alignedSlots.length === 0)
      hint = '다른 주나 참여 인원을 확인해 주세요.';
    else hint = '시간을 선택해 주세요.';
  } else if (step === 2) {
    hint = noFacility
      ? '시설 없이 회의 시간만 잡아요.'
      : selectedFacilityInfo
      ? `선택한 시설: ${selectedFacilityInfo.name}`
      : facilities === null && !facilitiesError
        ? '이용 가능한 시설을 확인하는 중입니다.'
        : '시설을 골라 주세요.';
  } else {
    const where = noFacility || !selectedFacilityInfo ? '시설 없이' : `${selectedFacilityInfo.name} (${selectedFacilityInfo.building})`;
    hint =
      selectedDate && range && (noFacility || selectedFacilityInfo)
        ? `${where} · ${fmtDate(selectedDate)} ${fmtRange(range.startMin, range.endMin)} · ${durationText}`
        : '';
  }

  const weekEnd = addDaysStr(week.weekStart, 4);

  return (
    <Sheet
      open={open}
      onClose={() => { if (!pendingRef.current) onClose(); }}
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
              disabled={!canNext && !pending}
              aria-describedby={hintId}
              loading={pending}
            >
              {step === 3 ? (pending ? '준비 중…' : noFacility ? '예약하기' : '학교에 신청하기') : ['시설 선택', '예약 확인'][step - 1]}
            </Button>
          </div>
        </div>
      }
    >
      {/* 글자를 크게 쓰면 위·아래 고정 영역이 화면을 너무 차지하므로 단계 표시기는 함께 스크롤한다. */}
      <div className={`mtg-flow__steps${zoom >= 1.3 ? ' mtg-flow__steps--static' : ''}`}>
        <Stepper steps={STEPS} current={step} />
      </div>

      {/* 시간: 설명보다 선택 가능한 시간표를 먼저 보여 준다. */}
      {step === 1 && (
        <div className="mtg-time-step">
          <div className="mtg-time-head">
            <div>
              <h3 className="section__title mtg-step-title" tabIndex={-1} ref={headingRef}>시간 선택</h3>
              <p className="section__sub">원하는 날짜의 빈 시간을 끌어 선택하세요.</p>
            </div>
            <Button variant="text" size="sm" aria-expanded={editingMembers}
              aria-controls={hintId + '-members'} onClick={() => setEditingMembers((v) => !v)}>
              <Icon name="users" className="btn__icon" />
              <span aria-live="polite">{peopleCount}명</span>
              <Icon name={editingMembers ? 'chevron-up' : 'chevron-down'} className="btn__icon" />
              <span className="sr-only">참여 인원 변경</span>
            </Button>
          </div>
          <div id={hintId + '-members'} hidden={!editingMembers} className="mtg-flow-members">
            <p className="field__help">선택한 팀원의 시간표만 반영합니다.</p>
            <MeetingParticipants members={members} activeIds={activeIds} onToggle={onToggleParticipant} />
          </div>

          {notice && <p className="field__help" role="status">{notice}</p>}
          {pickError && <Alert tone="danger">{pickError}</Alert>}

          <WeekNav label={fmtWeekLabel(week.weekStart)}
            sub={fmtDayHeader(week.weekStart) + ' ~ ' + fmtDayHeader(weekEnd)}
            onPrev={week.prevWeek} onNext={week.nextWeek}
            onToday={isCurrentWeek(week.weekStart) ? undefined : week.goToday} />

          {peopleCount === 0 ? (
            <Alert tone="warning">참여할 팀원을 한 명 이상 선택해 주세요.</Alert>
          ) : slotsError ? (
            <Alert tone="danger" title="빈 시간을 불러오지 못했습니다."
              actions={<Button variant="secondary" onClick={() => setSlotsTick((n) => n + 1)}>다시 시도하기</Button>}>
              {slotsError}
            </Alert>
          ) : currentSlots === null ? (
            <LoadingBlock>함께 비는 시간을 확인하고 있습니다.</LoadingBlock>
          ) : alignedSlots.length === 0 ? (
            <Alert tone="warning">함께 비는 시간이 없습니다. 다른 주나 참여 인원을 확인해 주세요.</Alert>
          ) : null}

          {peopleCount > 0 && !slotsError && (
            <section aria-label="예약 시간표" aria-busy={currentSlots === null}>
              <div className="mtg-time-legend">
                <GridLegend items={['busy', 'pending']} />
              </div>
              <div className="mtg-grid">
                <TimetableGrid entries={gridEntries}
                  listPosition="hidden" freeRanges={freeRanges} highlightFreeRanges={false}
                  step={STEP_MIN} halfHourLines
                  selectable={currentSlots !== null && alignedSlots.length > 0}
                  onSelectRange={pickFromGrid} pendingRange={activeSlot ? range : null}
                  weekStart={week.weekStart} slide={week.slide} />
              </div>
            </section>
          )}

        </div>
      )}

      {/* ─────────── 2단계 시설 ─────────── */}
      {step === 2 && range && selectedDate && (
        <div className="stack-lg">
          <div>
            <h3 className="section__title mtg-step-title" tabIndex={-1} ref={headingRef}>
              시설 선택
            </h3>
            <p className="section__sub">
              {fmtDate(selectedDate)} {fmtRange(range.startMin, range.endMin)} · 참여 {peopleCount}명
              기준입니다.
            </p>
          </div>

          {/* 장소가 필요 없는 회의: 시설 없이 시간만 잡는다 */}
          <button
            type="button"
            className="mtg-fac mtg-fac--none"
            aria-pressed={noFacility}
            onClick={() => {
              setSubmitError(null);
              setSelectedFacility(null);
              setNoFacility(true);
            }}
          >
            <span className="mtg-fac__head">
              <span className="mtg-fac__name">시설 없이 예약하기</span>
              {noFacility && <Badge tone="primary">선택함</Badge>}
            </span>
            <span className="mtg-fac__meta">회의 시간만 예약합니다.</span>
          </button>

          {beyondFacilityWindow ? (
            <p className="mtg-date-limit">
              학교 규정상 시설은 이용일 {MAX_DAYS_AHEAD}일 전부터 예약할 수 있어요. 이 날짜는 시설 없이만 잡을 수 있어요.
            </p>
          ) : facilitiesError ? (
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
                      <Button variant="secondary" onClick={() => goStep(1)}>
                        시간 다시 선택하기
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
                            setNoFacility(false);
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

      {/* ─────────── 3단계 확인 ─────────── */}
      {step === 3 && range && selectedDate && (noFacility || selectedFacilityInfo) && (
        <div className="stack-lg">
          <div>
            <h3 className="section__title mtg-step-title" tabIndex={-1} ref={headingRef}>
              예약 내용 확인
            </h3>
            <p className="section__sub">
              {noFacility ? '내용이 맞으면 예약하기를 눌러 주세요.' : '내용이 맞으면 학교에 신청하기를 눌러 주세요.'}
            </p>
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
                <dd className="kv__val bold">{noFacility || !selectedFacilityInfo ? '시설 없이' : selectedFacilityInfo.name}</dd>
              </div>
              {!noFacility && selectedFacilityInfo && (
                <div className="kv">
                  <dt className="kv__key">건물</dt>
                  <dd className="kv__val">{selectedFacilityInfo.building}</dd>
                </div>
              )}
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
