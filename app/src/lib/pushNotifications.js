// Push notification helpers — registers SW, manages VAPID subscription, calls worker API.

const VAPID_PUBLIC_KEY = 'BB5G6tXgDIcASUnKlhIQQCX6cDM_CkccGewjfZD2RtAhoq3beRfFmai64O1qUOCrjkD5Q0gm69Cj052OBG_PFVM';
const WORKER_BASE = 'https://api.fantasai.net';
const SW_PATH = '/sw.js';

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData  = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

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

// Returns: 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed'
export async function getSubscriptionState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'subscribed' : 'unsubscribed';
  } catch { return 'unsupported'; }
}

// Request permission, subscribe to push, and save subscription to worker.
// teamId ties this subscription to the owner so commish can target individuals.
// Returns the subscription object or null on failure.
export async function subscribeToPush(teamId = null) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return null;

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  // Save subscription to worker KV, tagging with teamId for targeted sends
  const subJson = sub.toJSON ? sub.toJSON() : { endpoint: sub.endpoint, keys: sub.keys };
  await fetch(`${WORKER_BASE}/api/v1/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...subJson, _teamId: teamId }),
  }).catch(e => console.warn('Push subscribe save failed:', e));

  return sub;
}

// Unsubscribe from push and remove from worker KV.
export async function unsubscribeFromPush() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await fetch(`${WORKER_BASE}/api/v1/push/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
}

// Commish-only: send a push notification to subscribed league members.
// commishKey must match the FANTASAI_KEY worker secret.
// teamIds: array of team IDs to target — null/omitted sends to all subscribers.
export async function sendLeaguePush(title, body, commishKey, url = '/', teamIds = null) {
  const resp = await fetch(`${WORKER_BASE}/api/v1/push/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-FantasAI-Key': commishKey,
    },
    body: JSON.stringify({ title, body, url, tag: 'fantasai-league', teamIds }),
  });
  return resp.json();
}

// Alias kept for layout.jsx compatibility
export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.requestPermission();
}

// Show a local (in-browser) notification — instant feedback, no push required.
export function showLocalNotification(title, body, tag = 'fantasai') {
  if (Notification.permission !== 'granted') return;
  navigator.serviceWorker.ready.then(reg => {
    reg.showNotification(title, { body, icon: '/favicon.svg', tag });
  }).catch(() => new Notification(title, { body }));
}
