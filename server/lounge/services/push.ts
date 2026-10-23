/**
 * 폰 알림(웹 푸시). 친구 요청·수락, "밥 먹자", 회의 초대를 받은 사람의 폰에 알림을 띄운다.
 *
 *  - 열쇠(VAPID)는 환경 변수 VAPID_PUBLIC_KEY · VAPID_PRIVATE_KEY · VAPID_SUBJECT 에 둔다.
 *    없으면 알림 기능만 조용히 꺼지고(구독 안내도 숨김) 나머지 기능은 그대로 돈다.
 *  - 구독(기기마다 하나)은 lounge_push_subscriptions 에 저장한다. 기기가 구독을 버리면(404·410) 지운다.
 *  - 알림을 못 보내도 원래 요청(친구 요청 등)은 성공으로 끝난다 — 알림은 덤이다.
 */
import webpush from 'web-push';
import { all, run } from '../../db.js';

export type PushMessage = {
  title: string;
  body: string;
  /** 알림을 누르면 열 앱 안 주소 (예: /lounge) */
  url: string;
  /** 같은 tag 의 알림은 새것으로 바뀐다 (여러 번 와도 쌓이지 않게) */
  tag?: string;
  /** 알림 오른쪽 그림 (사이트 아이콘: /brand/notify-meal.png 등). 없으면 캐릭터 */
  icon?: string;
};

type Keys = { publicKey: string; privateKey: string; subject: string };

let configured: Keys | null | undefined;

function keys(): Keys | null {
  if (configured !== undefined) return configured;
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || 'https://sangsang-booke.vercel.app';
  if (!publicKey || !privateKey) {
    configured = null;
    return null;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = { publicKey, privateKey, subject };
  return configured;
}

/** 브라우저가 구독할 때 쓰는 공개 열쇠. 알림이 꺼져 있으면 null */
export const publicKey = (): string | null => keys()?.publicKey ?? null;

type SubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

/** 받은 구독 본문이 브라우저 PushSubscription.toJSON() 모양인지 확인 (https 주소만) */
export function parseSubscription(raw: unknown): SubscriptionInput | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const k = r.keys as Record<string, unknown> | undefined;
  if (typeof r.endpoint !== 'string' || !/^https:\/\/[^\s]{1,2000}$/.test(r.endpoint)) return null;
  if (!k || typeof k.p256dh !== 'string' || typeof k.auth !== 'string') return null;
  if (!/^[A-Za-z0-9_-]{1,200}=*$/.test(k.p256dh) || !/^[A-Za-z0-9_-]{1,100}=*$/.test(k.auth)) return null;
  return { endpoint: r.endpoint, keys: { p256dh: k.p256dh, auth: k.auth } };
}

export async function saveSubscription(userId: string, sub: SubscriptionInput): Promise<void> {
  // 같은 기기(주소)가 다른 계정으로 다시 구독하면 주인을 바꾼다 — 로그아웃 후 다른 사람이 쓰는 경우
  await run(
    `INSERT INTO lounge_push_subscriptions (endpoint, user_id, p256dh, auth)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [sub.endpoint, Number(userId), sub.keys.p256dh, sub.keys.auth],
  );
}

export async function deleteSubscription(userId: string, endpoint: string): Promise<void> {
  await run('DELETE FROM lounge_push_subscriptions WHERE endpoint = ? AND user_id = ?', [endpoint, Number(userId)]);
}

/** 그 사람의 모든 기기로 알림을 보낸다. 실패해도 예외를 던지지 않는다 */
export async function notify(userId: string, message: PushMessage): Promise<void> {
  if (!keys()) return;
  try {
    const subs = await all<{ endpoint: string; p256dh: string; auth: string }>(
      'SELECT endpoint, p256dh, auth FROM lounge_push_subscriptions WHERE user_id = ?',
      [Number(userId)],
    );
    const payload = JSON.stringify(message);
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
            TTL: 60 * 60 * 6,
            urgency: 'high',
          });
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          // 기기가 구독을 버렸다 — 더 보내지 않게 지운다
          if (status === 404 || status === 410) {
            await run('DELETE FROM lounge_push_subscriptions WHERE endpoint = ?', [s.endpoint]);
          }
        }
      }),
    );
  } catch {
    /* 알림은 덤 — 실패해도 원래 요청은 성공으로 둔다 */
  }
}
