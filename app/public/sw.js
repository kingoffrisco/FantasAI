// FantasAI Service Worker — Push Notifications
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = { title: 'FantasAI', body: 'You have a new notification.' };
  try { data = event.data ? event.data.json() : data; } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'FantasAI', {
      body: data.body ?? '',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: data.tag ?? 'fantasai',
      data: data.url ? { url: data.url } : undefined,
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      const existing = clients.find(c => c.url === url && 'focus' in c);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});
