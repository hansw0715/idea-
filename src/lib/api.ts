/** 클라이언트에서 API를 부르는 얇은 래퍼. (담당: 한승원) */
import type { AppError } from '@/shared/types';
import type { GatheringView, PublicUser } from '@/shared/view';
import type { GatheringKind, GatheringMeta, SlotSpec } from '@/domain/gathering';

export class ApiError extends Error {
  constructor(public readonly error: AppError) {
    super(error.message);
  }
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error ?? { code: 'INVALID', message: '요청에 실패했습니다.' });
  }
  return data as T;
}

export const fetchGatherings = (kind: GatheringKind) =>
  request<{ gatherings: GatheringView[] }>(`/api/gatherings?kind=${kind}`).then((d) => d.gatherings);

export const fetchMe = () => request<{ me: PublicUser | null; users: PublicUser[] }>('/api/me');

export const switchUser = (userId: string) =>
  request<{ me: PublicUser }>('/api/me', { method: 'POST', body: JSON.stringify({ userId }) });

export type CreateGatheringBody = {
  kind: GatheringKind;
  title: string;
  body: string;
  place: string;
  meetAt: string;
  joinDeadline: string;
  joinPolicy: 'auto' | 'approval';
  slots: SlotSpec[];
  meta?: GatheringMeta;
};

export const createGathering = (body: CreateGatheringBody) =>
  request<{ gathering: GatheringView }>('/api/gatherings', {
    method: 'POST',
    body: JSON.stringify(body),
  }).then((d) => d.gathering);

type ActionBody = Record<string, unknown>;

export const act = (id: string, action: string, body: ActionBody = {}) =>
  request<{ gathering: GatheringView }>(`/api/gatherings/${id}/${action}`, {
    method: 'POST',
    body: JSON.stringify(body),
  }).then((d) => d.gathering);
