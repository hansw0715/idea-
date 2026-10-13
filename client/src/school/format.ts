/** 학교 연동 화면에서 쓰는 표시용 도우미 (문장·이름·날짜). 학번·비밀번호는 다루지 않는다. */

/**
 * 이름을 가려서 보여 준다: "박민재" → "박○재". 연동한 계정이 맞는지 알아볼 수 있을 만큼만 보이고,
 * 화면을 어깨너머로 보는 사람에게는 이름이 드러나지 않는다. (서버의 라운지 이름 가림과 같은 규칙이다.)
 */
export function maskName(name: string): string {
  const chars = Array.from(name.trim());
  if (chars.length === 0) return '';
  if (chars.length === 1) return chars[0];
  if (chars.length === 2) return chars[0] + '○';
  return chars[0] + '○'.repeat(chars.length - 2) + chars[chars.length - 1];
}

/** 받침 유무에 맞는 조사 "로/으로" ("AI응용학과" → "AI응용학과로", "융합전공" → "융합전공으로") */
export function withRo(word: string): string {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const jong = (code - 0xac00) % 28;
    // 받침이 없거나 ㄹ(8)이면 "로"
    return jong === 0 || jong === 8 ? `${word}로` : `${word}으로`;
  }
  return `${word}로`;
}

/** 연동 성공 화면의 확인 문장. 예: "박○재님, AI응용학과로 확인했어요" */
export function verifiedLine(name: string, department: string): string {
  const who = maskName(name);
  const dept = department.trim();
  const head = who ? `${who}님, ` : '';
  return dept ? `${head}${withRo(dept)} 확인했어요` : `${head}학교 계정으로 확인했어요`;
}

/** "2026년 10월 8일" (한국 시간 기준) */
export function formatLinkedDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Seoul',
  }).format(date);
}

/** 학교 예약 시스템 키 → 사람이 읽는 이름 (docs/school/00-design.md §2.2). 모르면 키 그대로 */
const SYSTEM_LABELS: Record<string, string> = {
  'cncschool/1': '상상파크(연구관)',
  'cncschool/2': '상상파크 플러스(공학관)',
  'cncschool/4': '디지털 스튜디오',
  'cncschool/5': '실기 수업 콘텐츠 제작실',
  'cncschool/6': '미디어 콘텐츠 제작실',
  'cncschool/7': '코딩라운지 세미나실',
  'onestop/16': '상상베이스(상상관 B2)',
  'hsel/14': '학술정보관',
};

export const systemLabel = (key: string): string => SYSTEM_LABELS[key] ?? key;

export const DAY_LABELS = ['월요일', '화요일', '수요일', '목요일', '금요일'] as const;

/** 신청 상태 글자 → 배지 색. 색만으로 전달하지 않도록 글자는 항상 함께 보인다 */
export function statusTone(status: string): 'success' | 'info' | 'danger' | 'gray' {
  if (/취소|반려|거부|거절|불가/.test(status)) return 'danger';
  if (/승인|완료|확정|허가|사용/.test(status)) return 'success';
  if (/대기|접수|신청|진행|확인/.test(status)) return 'info';
  return 'gray';
}
