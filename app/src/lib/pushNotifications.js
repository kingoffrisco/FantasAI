// Push notification helpers — registers the service worker and manages subscription.
// The VAPID public key would come from your server; using a placeholder here
// since full server-side web push requires a backend endpoint to save subscriptions.

const SW_PATH = '/sw.js';

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register(SW_PATH);
    await navigator.serviceWorker.ready;
    return reg;
  } catch (e) {
    console.warn('SW registration failed:', e);
    return null;
  }
}

export async function getSubscriptionState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  const perm = Notification.permission;
  if (perm === 'denied') return 'denied';
  try {
    const reg  = await navigator.serviceWorker.ready;
    const sub  = await reg.pushManager.getSubscription();
    return sub ? 'subscribed' : perm === 'granted' ? 'granted' : 'default';
  } catch { return 'error'; }
}

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  const result = await Notification.requestPermission();
  return result; // 'granted' | 'denied' | 'default'
}

// Show a local (non-push) notification for immediate feedback
export function showLocalNotification(title, body, tag = 'fantasai') {
  if (Notification.permission !== 'granted') return;
  navigator.serviceWorker.ready.then(reg => {
    reg.showNotification(title, { body, icon: '/favicon.svg', tag });
  }).catch(() => new Notification(title, { body }));
}

// Subscribe to real push notifications
// NOTE: In production you'd pass your VAPID public key and send the subscription
// endpoint to your server. Here we subscribe and store locally as a demo.
export async function subscribeToPush(vapidPublicKey) {
  if (!vapidPublicKey) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(vapidPublicKey),
    });
    return sub;
  } catch (e) {
    console.warn('Push subscribe failed:', e);
    return null;
  }
}

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}
