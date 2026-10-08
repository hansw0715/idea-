import { admissionLabel } from '../../../../shared/lounge';

/**
 * 상대를 소개하는 사실 한 줄: "AI응용학과 · 21학번". 값은 연동한 학교 계정에서 읽어 온 것이다
 * (학과·입학년도) — 사용자가 직접 적은 말이 아니다.
 */
export function factLine(u: { department?: string; admissionYear?: number | null }): string {
  const parts: string[] = [];
  if (u.department) parts.push(u.department);
  const adm = admissionLabel(u.admissionYear ?? 0);
  if (adm) parts.push(adm);
  return parts.join(' · ');
}
