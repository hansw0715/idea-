import { DEPARTMENT_BOARDS } from './boards.js';
import type { DepartmentBoard } from './types.js';

/** 비교용 이름: 공백·가운뎃점·괄호 설명을 지운다 ("미래 모빌리티학과" = "미래모빌리티학과") */
function norm(s: string): string {
  return s
    .replace(/\([^)]*\)/g, '')
    .replace(/[\s·ㆍ・.&]/g, '')
    .toLowerCase();
}

/** 트랙·전공은 학부보다 구체적이다 ("기계전자공학부 전자트랙" → 전자트랙 게시판) */
const isTrack = (name: string): number => (/(트랙|전공)$/.test(name) ? 1 : 0);

/**
 * 포털에 적힌 소속(예: "AI응용학과", "컴퓨터공학부", "사회과학부 국제무역트랙")에 맞는 공지 게시판을 찾는다.
 * 1) 이름이 같은 것 2) 소속 글자 안에 들어 있는 이름 중 트랙·전공, 그다음 가장 긴 것 순서로 고른다.
 */
export function findDepartmentBoard(
  department: string,
  boards: DepartmentBoard[] = DEPARTMENT_BOARDS,
): DepartmentBoard | null {
  const target = norm(department);
  if (!target) return null;
  const exact = boards.find((b) => norm(b.name) === target);
  if (exact) return exact;
  const contained = boards
    .filter((b) => norm(b.name).length >= 3 && target.includes(norm(b.name)))
    .sort((a, b) => isTrack(b.name) - isTrack(a.name) || norm(b.name).length - norm(a.name).length);
  return contained[0] ?? null;
}
