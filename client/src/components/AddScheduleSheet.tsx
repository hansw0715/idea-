import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import { Alert, Button, Segmented, SelectField, Sheet, TextField, useToast } from '../ui';
import '../pages/timetable.css';
import { CLOSE_MIN, DAY_NAMES, OPEN_MIN, STEP_MIN, fmtDayHeader, fmtMin, nowMinutes, timeOptions, todayStr, weekDates } from '../time';

type RepeatKind = 'weekly' | 'once';

const FORM_ID = 'home-add-schedule';

/** 기본 시간: 고른 날이 오늘이면 다음 정시부터 1시간, 아니면 09:00~10:00 */
function defaultRange(date: string | undefined) {
  if (date && date === todayStr()) {
    const next = (Math.floor(nowMinutes() / 60) + 1) * 60;
    const startMin = Math.min(CLOSE_MIN - 60, Math.max(OPEN_MIN, next));
    return { startMin, endMin: startMin + 60 };
  }
  return { startMin: OPEN_MIN, endMin: OPEN_MIN + 60 };
}

/**
 * 홈에서 바로 여는 '일정 추가' 창: 시간표 탭으로 가지 않고 언제·무엇을 하는지 그 자리에서 적는다.
 * 저장은 시간표와 같은 곳(/timetable)에 한다.
 */
export default function AddScheduleSheet({
  open,
  onClose,
  weekStart,
  day,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  /** 이 주의 월요일 (YYYY-MM-DD) */
  weekStart: string;
  /** 처음 고른 요일 (0 = 월) */
  day: number;
  onAdded: () => void;
}) {
  const toast = useToast();
  const dates = weekDates(weekStart, DAY_NAMES.length);
  const [pickedDay, setPickedDay] = useState(day);
  const [range, setRange] = useState(() => defaultRange(dates[day]));
  const [title, setTitle] = useState('');
  const [place, setPlace] = useState('');
  const [repeatKind, setRepeatKind] = useState<RepeatKind>('once');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // 열 때마다 홈에서 고른 날로 새로 시작한다
  useEffect(() => {
    if (!open) return;
    setPickedDay(day);
    setRange(defaultRange(dates[day]));
    setTitle('');
    setPlace('');
    setRepeatKind('once');
    setTitleError(null);
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const date = dates[pickedDay] ?? null;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const name = title.trim();
    if (!name) {
      setTitleError('무엇을 하는지 적어 주세요. 1자 이상 30자 이하로 적어 주세요.');
      document.getElementById('home-add-title')?.focus();
      return;
    }
    setTitleError(null);
    setFormError(null);
    setPending(true);
    try {
      await api.post('/timetable', {
        day: pickedDay,
        startMin: range.startMin,
        endMin: range.endMin,
        title: name,
        place: place.trim(),
        repeatKind,
        date,
      });
      toast('일정을 추가했습니다.');
      onAdded();
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '일정을 추가하지 못했습니다.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={() => !pending && onClose()}
      title="일정 추가"
      initialFocus="#home-add-title"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={pending}>
            취소
          </Button>
          <Button type="submit" form={FORM_ID} loading={pending}>
            {pending ? '추가하는 중…' : '추가하기'}
          </Button>
        </>
      }
    >
      {formError && (
        <Alert tone="danger" title="일정을 추가하지 못했습니다.">
          {formError}
        </Alert>
      )}
      <form id={FORM_ID} onSubmit={save} noValidate>
        <TextField
          id="home-add-title"
          label="무엇을 하나요"
          required
          type="text"
          placeholder="예: 근로, 스터디"
          autoComplete="off"
          maxLength={30}
          value={title}
          error={titleError}
          onChange={(e) => {
            setTitle(e.target.value);
            if (titleError) setTitleError(null);
          }}
        />
        <fieldset className="tt-time">
          <legend className="field__label">언제</legend>
          <SelectField label="날짜" value={pickedDay} onChange={(e) => setPickedDay(Number(e.target.value))}>
            {DAY_NAMES.map((d, i) => (
              <option key={d} value={i}>
                {dates[i] ? fmtDayHeader(dates[i]) : `${d}요일`}
              </option>
            ))}
          </SelectField>
          {/* 시작·종료는 한 줄에 나란히 */}
          <div className="tt-time__row tt-time__row--pair">
            <SelectField
              label="시작"
              value={range.startMin}
              onChange={(e) => {
                const startMin = Number(e.target.value);
                setRange({ startMin, endMin: Math.max(range.endMin, startMin + STEP_MIN) });
              }}
            >
              {timeOptions(OPEN_MIN, CLOSE_MIN - STEP_MIN).map((m) => (
                <option key={m} value={m}>
                  {fmtMin(m)}
                </option>
              ))}
            </SelectField>
            <SelectField label="종료" value={range.endMin} onChange={(e) => setRange({ ...range, endMin: Number(e.target.value) })}>
              {timeOptions(range.startMin + STEP_MIN, CLOSE_MIN).map((m) => (
                <option key={m} value={m}>
                  {fmtMin(m)}
                </option>
              ))}
            </SelectField>
          </div>
        </fieldset>
        <TextField
          id="home-add-place"
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
            { value: 'once', label: '그 날만' },
            { value: 'weekly', label: '매주' },
          ]}
          help={repeatKind === 'weekly' ? `매주 ${DAY_NAMES[pickedDay]}요일마다 표시됩니다.` : `${date ? fmtDayHeader(date) : ''} 하루에만 표시됩니다.`}
        />
      </form>
    </Sheet>
  );
}
