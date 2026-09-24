/** 단톡방 API 클라이언트. (담당: 한승원) */
import type { RoomView } from '@/server/chat-service';
import { request } from './api';

export const fetchRoom = (roomId: string) => request<RoomView>(`/api/gatherings/${roomId}/messages`);

export const sendMessage = (roomId: string, text: string) =>
  request<RoomView>(`/api/gatherings/${roomId}/messages`, { method: 'POST', body: JSON.stringify({ text }) });
