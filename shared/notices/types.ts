/** 학과(또는 트랙·학부)와 그 공지 게시판. scripts/crawl-notice-boards.mjs 가 만든다 */
export interface DepartmentBoard {
  /** 홈페이지 메뉴에 적힌 이름 (공백 없음) — 예: "AI응용학과", "사회과학부", "국제무역트랙" */
  name: string;
  /** 단과대학 사이트 코드 — 예: "CreCon" */
  site: string;
  /** 게시판 번호들. 학부는 아래 트랙 게시판을 모두 묶는다 */
  boards: number[];
  /** 사람이 여는 게시판 화면 주소 */
  url: string;
  /** 자기 게시판이 없어 트랙 게시판을 묶었거나(tracks) 단과대학 공지를 쓴다(college) */
  shared?: 'tracks' | 'college';
}

/** 공지 한 건 */
export interface NoticeItem {
  id: string;
  title: string;
  /** 올린 날짜 YYYY-MM-DD (한국 시간) */
  date: string;
  /** 올린 부서·사람 (없으면 빈 문자열) */
  writer: string;
  /** 원문 주소 */
  url: string;
}

export interface NoticeSection {
  /** 화면에 보일 이름 — "학교 공지", "AI응용학과" */
  name: string;
  /** 게시판 화면 주소 (더 보기) */
  url: string;
  /** 가장 최근에 올라온 공지 (최대 limit 개), 최신순 */
  items: NoticeItem[];
  /** 학교 홈페이지를 읽지 못했으면 true (items 는 빈 배열) */
  failed?: boolean;
}

/** GET /api/notices 응답 */
export interface NoticesResponse {
  /** 학교·학과 공지를 각각 몇 개까지 보여 주는지 (5) */
  limit: number;
  school: NoticeSection;
  /** 내 학과 공지. 학과를 모르거나 게시판을 못 찾으면 null */
  department: NoticeSection | null;
  /** 학교 계정에서 읽은 내 학과 이름. 모르면 '' */
  departmentName: string;
}
