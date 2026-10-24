import { addDaysStr, weekStartOf, weekdayOfDate } from "./time";

/** 홈은 주말에 다음 수업 주를 먼저 보여준다. 시간표·회의의 기본 주에는 영향을 주지 않는다. */
export function homeWeekStart(today: string): string {
  const monday = weekStartOf(today);
  return weekdayOfDate(today) >= 5 ? addDaysStr(monday, 7) : monday;
}
