import { useCallback, useState } from 'react';
import { addDaysStr, currentWeekStart } from './time';

/** 슬라이드 방향. 주가 바뀔 때마다 새 값을 주어 애니메이션을 다시 재생시킨다. */
export interface WeekSlide {
  dir: 'next' | 'prev';
  tick: number;
}

/**
 * 시간표가 보고 있는 '주'(월요일 날짜)를 다룬다.
 * 대시보드·시간표·회의가 같은 방식으로 주를 넘길 수 있도록 한곳에 모았다.
 */
export function useWeek() {
  const [weekStart, setWeekStart] = useState(currentWeekStart);
  const [slide, setSlide] = useState<WeekSlide | null>(null);

  const shiftWeeks = useCallback((weeks: number) => {
    if (weeks === 0) return;
    setSlide((prev) => ({ dir: weeks > 0 ? 'next' : 'prev', tick: (prev?.tick ?? 0) + 1 }));
    setWeekStart((current) => addDaysStr(current, weeks * 7));
  }, []);

  const goToday = useCallback(() => {
    const today = currentWeekStart();
    setWeekStart((current) => {
      if (current === today) return current;
      setSlide((prev) => ({ dir: current < today ? 'next' : 'prev', tick: (prev?.tick ?? 0) + 1 }));
      return today;
    });
  }, []);

  return {
    weekStart,
    slide,
    prevWeek: useCallback(() => shiftWeeks(-1), [shiftWeeks]),
    nextWeek: useCallback(() => shiftWeeks(1), [shiftWeeks]),
    goToday,
  };
}
