/** 날짜/시간 표시. 서버·클라이언트 결과가 달라지면 hydration 경고가 뜨므로 한 곳에 모아둔다. */

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** "9/3(수) 오후 7:00" */
export function formatMeetAt(iso: string): string {
  const d = new Date(iso);
  const hour = d.getHours();
  const ampm = hour < 12 ? '오전' : '오후';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]}) ${ampm} ${h12}:${mm}`;
}

/** 마감까지 남은 시간. 급할수록 사람이 빨리 누르므로 눈에 띄게 보여준다. */
export function timeLeft(iso: string, now: number = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  if (diff <= 0) return '마감';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}분 남음`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 남음`;
  return `${Math.floor(hours / 24)}일 남음`;
}

/** datetime-local input 값(로컬 시간) → ISO 문자열 */
export const localInputToISO = (value: string): string => new Date(value).toISOString();

/** 지금부터 h시간 뒤를 datetime-local input 기본값으로 */
export function defaultLocalInput(hoursFromNow: number): string {
  const d = new Date(Date.now() + hoursFromNow * 3600_000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
