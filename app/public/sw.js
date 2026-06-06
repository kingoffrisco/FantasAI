// FantasAI Service Worker — Push Notifications
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = { title: 'FantasAI', body: 'You have a new notification.' };
  try { data = event.data ? event.data.json() : data; } catch {}

  const title = data.title ?? 'FantasAI';
  const opts = {
    body:  data.body ?? '',
    icon:  '/favicon.svg',
    badge: '/favicon.svg',
    tag:   data.tag ?? 'fantasai',
    requireInteraction: false,
    data:  data.url ? { url: data.url } : undefined,
  };

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const notify = self.registration.showNotification(title, opts);
      const msg = { type: 'PUSH_RECEIVED', title, body: data.body ?? '' };
      // BroadcastChannel: reliable in Firefox/Safari even when clients.matchAll returns empty
      try { const bc = new BroadcastChannel('fantasai-push'); bc.postMessage(msg); bc.close(); } catch {}
      // Fallback: direct postMessage for Chrome
      clients.forEach(c => c.postMessage(msg));
      return notify;
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      const existing = clients.find(c => 'focus' in c);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});
