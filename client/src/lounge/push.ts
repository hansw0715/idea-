import { api } from '../api';

/**
 * 폰 알림(웹 푸시) 켜기. 친구 요청·수락, "밥 먹자", 회의 초대를 받으면 폰에 알림이 뜬다.
 * 안드로이드는 브라우저·설치한 앱 모두, 아이폰은 홈 화면에 추가한 앱(iOS 16.4 이상)에서만 된다.
 */

export const pushSupported = (): boolean =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** 'granted' | 'denied' | 'default' | 'unsupported' */
export function pushPermission(): NotificationPermission | 'unsupported' {
  return pushSupported() ? Notification.permission : 'unsupported';
}

/** base64url → Uint8Array (구독 열쇠) */
function keyBytes(base64: string): Uint8Array {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function subscribe(): Promise<boolean> {
  const { key } = await api.get<{ key: string | null }>('/lounge/push/key');
  if (!key) return false;
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) as BufferSource }));
  await api.post('/lounge/push/subscribe', sub.toJSON());
  return true;
}

/** 알림 허락을 묻고 구독한다 (버튼을 누른 순간에 불러야 한다). 켜졌으면 true */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) return false;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;
  return subscribe();
}

/** 이미 허락한 기기면 조용히 구독을 서버와 맞춘다 (로그인한 계정이 바뀌었을 때 등) */
export async function syncPush(): Promise<void> {
  if (pushPermission() !== 'granted') return;
  try {
    await subscribe();
  } catch {
    /* 알림은 덤 — 실패해도 조용히 넘어간다 */
  }
}
