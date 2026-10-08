/** 날짜·시간 표시 순수 함수 (서버·클라이언트 공용) */

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** "9/3(수) 오후 7:00" — 기기의 시간대 기준 */
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

/** 지금부터 h시간 뒤(정시)를 datetime-local input 기본값으로 */
export function defaultLocalInput(hoursFromNow: number): string {
  const d = new Date(Date.now() + hoursFromNow * 3600_000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 오늘 날짜(한국 기준) YYYY-MM-DD */
export function todayKst(now: number = Date.now()): string {
  return new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
}

/** "26학번" */
export const admissionLabel = (year: number): string => (year > 0 ? `${String(year % 100).padStart(2, '0')}학번` : '');

/** 학번(이메일 앞부분)에서 입학년도 추정. 모르면 null. 예: "2493044" → 2024, "20240001" → 2024 */
export function guessAdmissionYear(localPart: string): number | null {
  if (/^20\d{2}/.test(localPart)) return Number(localPart.slice(0, 4));
  const m = /^(\d{2})\d{5}$/.exec(localPart);
  if (m) return 2000 + Number(m[1]);
  return null;
}

/** 이름을 가려 기본 닉네임을 만든다. "한승원" → "한○원", "김수" → "김○" */
export function defaultNickname(name: string): string {
  const chars = [...name.trim()];
  if (chars.length <= 1) return name.trim();
  if (chars.length === 2) return `${chars[0]}○`;
  return `${chars[0]}${'○'.repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

/** 한국 시간(KST, UTC+9, 서머타임 없음) 기준 날짜·요일·분. 서버(UTC)와 폰(KST)에서 결과가 같도록 "지금"은 인자로 받는다. */
export type KstParts = {
  /** YYYY-MM-DD */
  date: string;
  /** 0=일 ~ 6=토 */
  weekday: number;
  /** 자정부터 지난 분 */
  minutes: number;
};

export function toKst(now: Date): KstParts {
  const k = new Date(now.getTime() + 9 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}`,
    weekday: k.getUTCDay(),
    minutes: k.getUTCHours() * 60 + k.getUTCMinutes(),
  };
}
