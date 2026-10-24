/*
 * 상상Book-E 서비스 워커 — 폰 알림(웹 푸시)만 맡는다. 화면·데이터를 따로 저장(캐시)하지는 않는다.
 * 서버(server/lounge/services/push.ts)가 { title, body, url, tag } 를 보낸다.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || '상상Book-E';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      // 오른쪽 그림: 알림 종류별 사이트 아이콘 (밥 먹자 = 수저). 없으면 캐릭터
      icon: data.icon || '/brand/mark-192.png',
      badge: '/brand/mark-64.png',
      tag: data.tag,
      renotify: Boolean(data.tag),
      timestamp: Date.now(),
      vibrate: [80, 40, 80],
      data: { url: data.url || '/' },
    }),
  );
});

// 알림을 누르면 열려 있는 앱 창으로 가서 그 화면을 열고, 없으면 새로 연다
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin) {
          return w.focus().then(() => w.navigate(url));
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
