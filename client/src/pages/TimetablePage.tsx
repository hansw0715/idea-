import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AppHeader } from '../shell/Shell';
import { api } from '../api';
import TimetableGrid, { EntryInfoSheet, GridLegend, WeekNav } from '../components/TimetableGrid';
import type { GridEntry, SelectedRange } from '../components/TimetableGrid';
import CourseSearch from '../components/CourseSearch';
import type { Course, CourseAddFailure } from '../components/CourseSearch';
import {
  DAY_NAMES,
  OPEN_MIN,
  CLOSE_MIN,
  GRID_DEFAULT_CLOSE_MIN,
  STEP_MIN,
  fmtMin,
  timeOptions,
  weekDates,
  weekdayOfDate,
  todayStr,
  nowMinutes,
  fmtDayHeader,
  fmtWeekLabel,
  isCurrentWeek,
} from '../time';
import { useWeek } from '../useWeek';
import { reservationsToEntries } from '../gridEntries';
import {
  Alert,
  Button,
  Icon,
  LoadingBlock,
  Segmented,
  SelectField,
  Sheet,
  Tabs,
  TextField,
  btnClass,
  useConfirm,
  useToast,
} from '../ui';
import type { Reservation, TimetableEntry } from '../types';
import SchoolTimetableAction from '../school/SchoolTimetableAction';
import './timetable.css';

type TabId = 'timetable' | 'search';
type RepeatKind = 'weekly' | 'once';

const TAB_BASE = 'tt-tabs';
const ADD_FORM_ID = 'tt-add-form';

/** "일정 추가하기" 버튼으로 열 때의 기본 시간: 오늘 요일, 지금 다음 정시부터 1시간 (주말이면 월요일 09:00) */
function defaultAddRange(): SelectedRange {
  const day = weekdayOfDate(todayStr());
  if (day >= DAY_NAMES.length) return { day: 0, startMin: OPEN_MIN, endMin: OPEN_MIN + 60 };
  const nextHour = (Math.floor(nowMinutes() / 60) + 1) * 60;
  const startMin = Math.min(CLOSE_MIN - 60, Math.max(OPEN_MIN, nextHour));
  return { day, startMin, endMin: startMin + 60 };
}

export default function TimetablePage() {
  const confirm = useConfirm();
  const toast = useToast();
  const [params] = useSearchParams();
  const { weekStart, slide, prevWeek, nextWeek, goToday } = useWeek();

  const [tab, setTab] = useState<TabId>(params.get('tab') === 'search' ? 'search' : 'timetable');
  // 과목 검색은 처음 열 때 불러오고, 이후에는 조건을 남겨 둔 채 숨기기만 한다.
  const [searchOpened, setSearchOpened] = useState(tab === 'search');

  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  /** entries 가 어느 주 기준으로 받은 것인지 (주가 바뀌면 다시 받는 동안 이전 주 일정이 섞여 보이지 않게 한다) */
  const [loadedWeek, setLoadedWeek] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const reload = useCallback(() => setReloadTick((n) => n + 1), []);

  // 일정 추가 시트
  const [addOpen, setAddOpen] = useState(false);
  const [range, setRange] = useState<SelectedRange>(defaultAddRange);
  const [title, setTitle] = useState('');
  const [place, setPlace] = useState('');
  // 'weekly' = 매주 반복, 'once' = 고른 그 날만
  const [repeatKind, setRepeatKind] = useState<RepeatKind>('weekly');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const formAlertRef = useRef<HTMLDivElement>(null);

  // 항목 정보 시트
  const [selected, setSelected] = useState<GridEntry | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // 시간표와 예약을 한 번의 요청으로 함께 받는다. 보고 있는 주만 받아 온다.
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    api
      .get<{ timetable: TimetableEntry[]; weekReservations: Reservation[] }>(
        `/dashboard?week=${weekStart}`,
      )
      .then((d) => {
        if (cancelled) return;
        setEntries(d.timetable);
        setReservations(d.weekReservations ?? []);
        setLoadedWeek(weekStart);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : '시간표를 불러오지 못했습니다.');
      });
    return () => {
      cancelled = true;
    };
  }, [weekStart, reloadTick]);

  // 입력을 닫으면(취소·추가 완료) 입력값·반복·오류를 비운다. 닫히는 모션이 끝난 뒤에 비워 내용이 갑자기 사라져 보이지 않게 한다.
  useEffect(() => {
    if (addOpen) return;
    const t = window.setTimeout(() => {
      setTitle('');
      setPlace('');
      setRepeatKind('weekly');
      setTitleError(null);
      setFormError(null);
    }, 450);
    return () => window.clearTimeout(t);
  }, [addOpen]);

  // 오류가 생기면 시트 안에서 바로 보이게 한다.
  useEffect(() => {
    if (formError) formAlertRef.current?.scrollIntoView({ block: 'nearest' });
  }, [formError]);

  const fresh = loadedWeek === weekStart;

  // 시간표는 기본으로 17:00 까지만 그리고, 더 늦은 일정이 있으면 그 시각(정각으로 올림)까지, 최대 24:00 까지 늘린다.
  // 일정이 없는 저녁 시간에 일정을 넣으려면 아래 "펼치기"로 펼친다.
  const [showEvening, setShowEvening] = useState(false);
  const gridEntries = useMemo<GridEntry[]>(() => {
    const classes: GridEntry[] = entries
      // 다른 주를 받아 오는 동안에는 그 주에만 있는 일정(특정 날짜)을 숨긴다.
      .filter((e) => fresh || (e.repeatKind ?? 'weekly') === 'weekly')
      .map((e) => ({
        id: e.id,
        day: e.day,
        startMin: e.startMin,
        endMin: e.endMin,
        title: e.title,
        place: e.place || undefined,
        kind: 'class' as const,
        // 그 주에만 있는 일정은 블록 안에서도 구분되게 한다.
        subtitle: e.repeatKind === 'once' ? `${fmtDayHeader(e.date ?? '')} 하루만` : undefined,
      }));
    return [...classes, ...(fresh ? reservationsToEntries(reservations) : [])];
  }, [entries, reservations, fresh]);
  const latestEnd = useMemo(() => gridEntries.reduce((max, e) => Math.max(max, e.endMin), 0), [gridEntries]);
  const naturalClose = Math.min(CLOSE_MIN, Math.max(GRID_DEFAULT_CLOSE_MIN, Math.ceil(latestEnd / 60) * 60));
  const gridClose = showEvening ? CLOSE_MIN : naturalClose;

  // 고른 요일이 보고 있는 주에서 실제로 며칠인지.
  const rangeDate = weekDates(weekStart)[range.day] ?? null;
  const dates = weekDates(weekStart);

  function changeTab(next: TabId) {
    setTab(next);
    if (next === 'search') setSearchOpened(true);
  }

  /** 시간을 잡자마자 입력 시트를 연다. 일정 칸에는 시트가 열리며 바로 포커스가 간다. */
  function openAdd(next: SelectedRange) {
    setRange(next);
    setTitle('');
    setPlace('');
    setRepeatKind('weekly');
    setTitleError(null);
    setFormError(null);
    setAddOpen(true);
  }

  function closeAdd() {
    if (pending) return;
    setAddOpen(false);
  }

  async function saveEntry(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const name = title.trim();
    if (!name) {
      setTitleError('일정 이름을 입력해 주세요. 이름은 1자 이상 30자 이하로 적어 주세요.');
      document.getElementById('tt-title')?.focus();
      return;
    }
    setTitleError(null);
    setFormError(null);
    setPending(true);
    try {
      await api.post('/timetable', {
        day: range.day,
        startMin: range.startMin,
        endMin: range.endMin,
        title: name,
        place: place.trim(),
        repeatKind,
        date: rangeDate,
      });
      setAddOpen(false);
      reload();
      toast('일정을 추가했습니다.');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '일정을 추가하지 못했습니다.');
    } finally {
      setPending(false);
    }
  }

  /** 검색한 과목의 대면 시간대를 모두 시간표에 담는다. */
  async function addCourse(course: Course): Promise<CourseAddFailure | null> {
    if (course.slots.length === 0) {
      return {
        message: `'${course.name}'은(는) 대면 시간이 없어 시간표에 넣을 수 없습니다.`,
      };
    }
    const failures: string[] = [];
    for (const slot of course.slots) {
      try {
        await api.post('/timetable', {
          day: slot.day,
          startMin: slot.startMin,
          endMin: slot.endMin,
          title: course.name,
          place: course.room,
        });
      } catch (err) {
        failures.push(err instanceof Error ? err.message : '추가 실패');
      }
    }
    reload();
    if (failures.length === course.slots.length) {
      return { message: `'${course.name}'을(를) 담지 못했습니다. ${failures[0]}` };
    }
    if (failures.length > 0) {
      return {
        message: `'${course.name}'의 일부 시간만 담았습니다. ${failures[0]}`,
        partial: true,
      };
    }
    toast(`'${course.name}'을(를) 시간표에 담았습니다.`, {
      action: { label: '시간표 보기', onClick: () => changeTab('timetable') },
    });
    return null;
  }

  function openInfo(entry: GridEntry) {
    setSelected(entry);
    setInfoOpen(true);
  }

  function closeInfo() {
    setInfoOpen(false);
  }

  /** 수업·일정을 삭제한다. 예약은 지울 수 없다. */
  async function removeEntry(entry: GridEntry) {
    if (entry.kind === 'reservation') return;
    const detail = entries.find((e) => e.id === entry.id);
    const once = detail?.repeatKind === 'once';
    const ok = await confirm({
      title: `'${entry.title}' 일정을 삭제할까요?`,
      message: once
        ? `${detail?.date ? fmtDayHeader(detail.date) : '그 날'} 하루 일정이 사라지며, 되돌릴 수 없습니다.`
        : '매주 반복하는 일정이라 모든 주의 시간표에서 사라지며, 되돌릴 수 없습니다.',
      tone: 'danger',
      confirmLabel: '삭제하기',
      run: async () => {
        await api.del(`/timetable/${entry.id}`);
      },
    });
    if (!ok) return;
    setInfoOpen(false);
    reload();
    toast('일정을 삭제했습니다.');
  }

  // 수업의 "그 날만" 안내는 시트의 "반복" 줄에서 말하므로 부제를 따로 보이지 않는다.
  const sheetEntry = useMemo<GridEntry | null>(
    () =>
      selected && selected.kind !== 'reservation' ? { ...selected, subtitle: undefined } : selected,
    [selected],
  );

  const selectedClass =
    selected && selected.kind !== 'reservation' ? entries.find((e) => e.id === selected.id) : undefined;
  const selectedReservation =
    selected && selected.kind === 'reservation'
      ? reservations.find((r) => r.id === selected.id)
      : undefined;

  const addTitle = `${rangeDate ? fmtDayHeader(rangeDate) : `${DAY_NAMES[range.day]}요일`} ${fmtMin(
    range.startMin,
  )}~${fmtMin(range.endMin)} 일정 추가`;

  return (
    <>
      <AppHeader />
      <main id="main" className="app-main tt-page">
        <div className="page-head tt-page__head">
          <div className="grow">
            <h1 className="page-title">내 시간표</h1>
            <p className="page-lead">시간표를 확인하고 일정을 추가합니다.</p>
          </div>
          {/* 제목 오른쪽의 작은 "학교 시간표 가져오기" (연동돼 있을 때만). 가입 직후 ?school=import 로도 열린다 */}
          <SchoolTimetableAction onImported={reload} />
        </div>

        <Tabs
          label="시간표 화면"
          idBase={TAB_BASE}
          value={tab}
          onChange={changeTab}
          tabs={[
            { value: 'timetable', label: '시간표' },
            { value: 'search', label: '과목 검색' },
          ]}
        />

        <div
          role="tabpanel"
          id={`${TAB_BASE}-panel-timetable`}
          aria-labelledby={`${TAB_BASE}-tab-timetable`}
          hidden={tab !== 'timetable'}
          className="tt-page__panel"
        >
          {loadError && (
            <div className="tt-page__alert">
              <Alert
                tone="danger"
                title="시간표를 불러오지 못했습니다."
                actions={
                  <Button variant="secondary" onClick={reload}>
                    다시 시도하기
                  </Button>
                }
              >
                {loadError}
              </Alert>
            </div>
          )}

          <WeekNav
            label={fmtWeekLabel(weekStart)}
            sub={`${fmtDayHeader(dates[0])} ~ ${fmtDayHeader(dates[dates.length - 1])}`}
            onPrev={prevWeek}
            onNext={nextWeek}
            onToday={isCurrentWeek(weekStart) ? undefined : goToday}
            busy={!fresh && !loadError && loadedWeek !== null}
          />

          <div className="tt-page__legend">
            <GridLegend />
          </div>

          {loadedWeek !== null && (
            <p className="tt-page__guide">시간표를 길게 누른 채 끌어 일정을 추가할 수 있습니다.</p>
          )}

          {loadedWeek === null ? (
            !loadError && <LoadingBlock>시간표를 불러오는 중입니다.</LoadingBlock>
          ) : (
            <div aria-busy={!fresh || undefined}>
              {fresh && entries.length === 0 && (
                <div className="tt-page__empty">
                  <Alert
                    tone="info"
                    title="아직 등록한 수업이나 일정이 없습니다."
                    actions={
                      <Button variant="secondary" onClick={() => changeTab('search')}>
                        과목 검색하기
                      </Button>
                    }
                  >
                    시간표의 빈 칸을 눌러 일정을 추가하거나, 과목 검색에서 수강할 과목을 담아 주세요.
                  </Alert>
                </div>
              )}
              <div className="tt-page__gridwrap">
                <TimetableGrid
                  entries={gridEntries}
                  onEntryClick={openInfo}
                  selectable
                  onSelectRange={openAdd}
                  pendingRange={addOpen ? range : null}
                  weekStart={weekStart}
                  slide={slide}
                  closeMin={gridClose}
                />
                {naturalClose < CLOSE_MIN && (
                  <div className="tt-page__evening">
                    <button
                      type="button"
                      className="tag tag--sm"
                      aria-pressed={showEvening}
                      aria-label={showEvening ? `${fmtMin(naturalClose)} 이후 시간 접기` : `${fmtMin(naturalClose)} 이후 시간 펼치기`}
                      onClick={() => setShowEvening((v) => !v)}
                    >
                      {showEvening ? '접기' : '펼치기'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div
          role="tabpanel"
          id={`${TAB_BASE}-panel-search`}
          aria-labelledby={`${TAB_BASE}-tab-search`}
          hidden={tab !== 'search'}
          className="tt-page__panel"
        >
          {searchOpened && <CourseSearch onAdd={addCourse} />}
        </div>
      </main>

      {/* 일정 추가: 시간표에서 시간을 고르거나 "일정 추가하기" 버튼으로 연다. */}
      <Sheet
        open={addOpen}
        onClose={closeAdd}
        title={addTitle}
        initialFocus="#tt-title"
        footer={
          <>
            <Button variant="tertiary" onClick={closeAdd} disabled={pending}>
              취소
            </Button>
            <Button type="submit" form={ADD_FORM_ID} loading={pending}>
              {pending ? '추가하는 중…' : '추가하기'}
            </Button>
          </>
        }
      >
        {formError && (
          <div className="tt-sheet__alert" ref={formAlertRef}>
            <Alert tone="danger" title="일정을 추가하지 못했습니다.">
              {formError}
            </Alert>
          </div>
        )}
        <form id={ADD_FORM_ID} onSubmit={saveEntry} noValidate>
          <TextField
            id="tt-title"
            label="일정"
            required
            type="text"
            placeholder="예: 근로"
            autoComplete="off"
            maxLength={30}
            value={title}
            error={titleError}
            onChange={(e) => {
              setTitle(e.target.value);
              if (titleError) setTitleError(null);
            }}
          />
          <TextField
            id="tt-place"
            label="장소 (선택)"
            type="text"
            placeholder="예: 공학관 203"
            autoComplete="off"
            maxLength={30}
            value={place}
            onChange={(e) => setPlace(e.target.value)}
          />

          <Segmented<RepeatKind>
            label="반복"
            value={repeatKind}
            onChange={setRepeatKind}
            options={[
              { value: 'weekly', label: '매주' },
              { value: 'once', label: '그 날만' },
            ]}
            help={
              repeatKind === 'weekly'
                ? `매주 ${DAY_NAMES[range.day]}요일마다 표시됩니다.`
                : `${rangeDate ? fmtDayHeader(rangeDate) : ''} 하루에만 표시됩니다.`
            }
          />

          <fieldset className="tt-time">
            <legend className="field__label">시간 직접 고치기</legend>
            <div className="tt-time__row">
              <SelectField
                label="요일"
                value={range.day}
                onChange={(e) => setRange({ ...range, day: Number(e.target.value) })}
              >
                {DAY_NAMES.map((d, i) => (
                  <option key={d} value={i}>
                    {d}요일
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="시작"
                value={range.startMin}
                onChange={(e) => {
                  const startMin = Number(e.target.value);
                  setRange({
                    ...range,
                    startMin,
                    endMin: Math.max(range.endMin, startMin + STEP_MIN),
                  });
                }}
              >
                {timeOptions(OPEN_MIN, CLOSE_MIN - STEP_MIN).map((m) => (
                  <option key={m} value={m}>
                    {fmtMin(m)}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="종료"
                value={range.endMin}
                onChange={(e) => setRange({ ...range, endMin: Number(e.target.value) })}
              >
                {timeOptions(range.startMin + STEP_MIN, CLOSE_MIN).map((m) => (
                  <option key={m} value={m}>
                    {fmtMin(m)}
                  </option>
                ))}
              </SelectField>
            </div>
          </fieldset>
        </form>
      </Sheet>

      {/* 항목 정보: 마우스를 올릴 수 없는 모바일에서 툴팁 대신 쓴다. 수업이면 삭제할 수 있다. */}
      <EntryInfoSheet
        entry={infoOpen ? sheetEntry : null}
        onClose={closeInfo}
        footer={
          selected?.kind === 'reservation' ? (
            <>
              <Button variant="tertiary" onClick={closeInfo}>
                닫기
              </Button>
              {selectedReservation && (
                <Link
                  className={btnClass({ variant: 'secondary' })}
                  to={`/meetings/${selectedReservation.meetingId}`}
                >
                  회의 화면 보기
                </Link>
              )}
            </>
          ) : (
            <>
              <Button variant="tertiary" onClick={closeInfo}>
                닫기
              </Button>
              <Button variant="danger" onClick={() => selected && removeEntry(selected)}>
                삭제하기
              </Button>
            </>
          )
        }
      >
        {selected?.kind === 'reservation' ? (
          <Alert tone="info">
            회의 예약은 시간표에서 지울 수 없습니다. 해당 회의 화면에서 학교 예약 내역을 확인해
            주세요.
          </Alert>
        ) : (
          selectedClass && (
            <div className="kv">
              <span className="tt-info__key">반복</span>
              <span className="tt-info__val">
                {selectedClass.repeatKind === 'once'
                  ? `${selectedClass.date ? fmtDayHeader(selectedClass.date) : '그 날'} 하루만`
                  : `매주 ${DAY_NAMES[selectedClass.day]}요일`}
              </span>
            </div>
          )
        )}
      </EntryInfoSheet>
    </>
  );
}
