import { randomUUID } from 'node:crypto';
import { all, run } from '../../db.js';
import type { InboxNotification } from '../../../shared/notifications.js';

export async function saveNotification(userId: string, message: { title: string; body: string; url: string; tag?: string }): Promise<void> {
  await run(`INSERT INTO lounge_notifications (id, user_id, title, body, url, tag) VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), Number(userId), message.title, message.body, message.url, message.tag ?? null]);
}

export async function notificationsFor(userId: string): Promise<InboxNotification[]> {
  return all<InboxNotification>(`SELECT id, title, body, url, created_at AS "createdAt" FROM lounge_notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`, [Number(userId)]);
}
