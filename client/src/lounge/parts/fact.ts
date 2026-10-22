import { GENDER_LABEL, admissionLabel } from '../../../../shared/lounge';
import type { Gender } from '../../../../shared/lounge';

/**
 * 상대를 소개하는 사실 한 줄: "남 · AI응용학과 · 21학번". 학과·입학년도는 연동한 학교 계정에서 읽어 온 것이고,
 * 성별은 학교 계정에서 읽었거나(못 읽었으면) 본인이 내 정보에서 고른 값이다.
 */
export function factLine(u: { department?: string; admissionYear?: number | null; gender?: Gender | null }): string {
  const parts: string[] = [];
  if (u.gender) parts.push(GENDER_LABEL[u.gender]);
  if (u.department) parts.push(u.department);
  const adm = admissionLabel(u.admissionYear ?? 0);
  if (adm) parts.push(adm);
  return parts.join(' · ');
}
