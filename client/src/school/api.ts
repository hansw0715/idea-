/**
 * 학교 연동 API 클라이언트 — `/api/school/*` (서버: server/school/index.ts, 설계: docs/school/00-design.md §4).
 * 오류는 ApiError(status, message, code, data) — `code` 로 분기하고 문구는 errors.ts 가 만든다.
 *
 * 학번·비밀번호(creds)는 이 파일의 호출 인자로만 지나가고, **아래 요청 본문에만** 실린다.
 * 어디에도 저장하거나 기록하지 않는다. (URL·쿼리에 실리는 요청은 하나도 없다.)
 */
import { api } from '../api';
import type {
  BookCancelResult,
  BookPreview,
  BookResult,
  BookSubmitRequest,
  LinkRequest,
  LinkResponse,
  LinkStatus,
  MyReservationsResult,
  SchoolCredentials,
  TimetableImportResult,
  TimetablePreview,
} from '../../../shared/school/types';

const S = '/school';

export const schoolApi = {
  /** 연동 상태와 암호문 (학교에는 요청하지 않는다) */
  getLink: () => api.get<LinkStatus>(`${S}/link`),
  /** 서버가 creds 로 학교에 한 번 로그인해 확인하고, 성공하면 cipher 만 저장한다 */
  link: (body: LinkRequest) => api.post<LinkResponse>(`${S}/link`, body),
  unlink: () => api.del<{ ok: true }>(`${S}/link`),

  timetablePreview: (creds: SchoolCredentials) => api.post<TimetablePreview>(`${S}/timetable/preview`, { creds }),
  timetableImport: (creds: SchoolCredentials) => api.post<TimetableImportResult>(`${S}/timetable/import`, { creds }),

  reservations: (creds: SchoolCredentials) => api.post<MyReservationsResult>(`${S}/reservations`, { creds }),

  bookPreview: (creds: SchoolCredentials, reservationId: number) =>
    api.post<BookPreview>(`${S}/book/preview`, { creds, reservationId }),
  /** 사용자가 미리보기를 보고 명시적으로 누른 한 번에만 부른다. 자동 재전송 금지 */
  bookSubmit: (body: BookSubmitRequest) => api.post<BookResult>(`${S}/book/submit`, body),
  /** 학교에 보낸 신청을 학교 신청내역의 취소로 취소한다. 사용자가 확인창에서 명시적으로 누른 한 번에만 부른다 */
  bookCancel: (creds: SchoolCredentials, reservationId: number) =>
    api.post<BookCancelResult>(`${S}/book/cancel`, { creds, reservationId }),
};
