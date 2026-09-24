/** 밥약 빠른 매칭 · 차단 · 신고 API 클라이언트. (담당: 한승원) */
import type { QuickState } from '@/features/mealdate/service';
import type { Answer } from '@/features/mealdate/quick-match';
import type { PlaceType } from '@/features/mealdate/preset';
import type { ReportReason } from '@/domain/safety/safety';
import type { ReportView } from '@/server/safety-service';
import type { PublicUser } from '@/shared/view';
import { request } from './api';

export const fetchQuick = () => request<QuickState>('/api/meals/quick');

export const requestQuick = (body: {
  date: string;
  placeType: PlaceType;
  size: number;
  bands: string[];
  tags: string[];
}) => request<QuickState>('/api/meals/quick', { method: 'POST', body: JSON.stringify(body) });

export const voteQuick = (roomId: string, bands: string[]) =>
  request<QuickState>('/api/meals/quick', { method: 'PATCH', body: JSON.stringify({ roomId, bands }) });

export const answerQuick = (roomId: string, answer: Answer) =>
  request<QuickState>('/api/meals/quick', { method: 'PATCH', body: JSON.stringify({ roomId, answer }) });

export const cancelQuick = () => request<QuickState>('/api/meals/quick', { method: 'DELETE' });

export const fetchBlocked = () => request<{ blocked: PublicUser[] }>('/api/blocks').then((d) => d.blocked);

export const blockUser = (userId: string) =>
  request<{ ok: true }>('/api/blocks', { method: 'POST', body: JSON.stringify({ userId }) });

export const unblockUser = (userId: string) =>
  request<{ ok: true }>('/api/blocks', { method: 'DELETE', body: JSON.stringify({ userId }) });

export const reportUser = (body: {
  userId: string;
  context: string;
  refId: string | null;
  reason: ReportReason;
  detail: string;
}) => request<{ ok: true }>('/api/reports', { method: 'POST', body: JSON.stringify(body) });

export const fetchReports = () => request<{ reports: ReportView[] }>('/api/admin/reports').then((d) => d.reports);

export const handleReport = (reportId: string, action: 'resolve' | 'dismiss' | 'ban' | 'unban') =>
  request<{ ok: true }>('/api/admin/reports', { method: 'POST', body: JSON.stringify({ reportId, action }) });
