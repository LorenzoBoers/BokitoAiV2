/** Browser web-push enrollment on top of the platform push API.
 *
 * The service worker (`public/sw.js`) renders incoming pushes; this module
 * handles registration, permission, and (un)subscribing the browser endpoint
 * against `/api/push/*`. The backend already fans pushes out per user via
 * `send_push_to_user` (thread messages + decisions).
 */

import { appRoutes } from '../api/routes'
import { APP_API_BASE } from './api.config'
import { bokitoGetVapidPublicKey, bokitoSubscribePush, bokitoUnsubscribePush } from './bokito-api'

export function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.register('/sw.js')
  } catch {
    return null
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}

/** Whether the API exposes a VAPID public key (push enabled server-side). */
export async function isWebPushServerConfigured(): Promise<boolean> {
  try {
    const res = await fetch(`${APP_API_BASE}${appRoutes.push.vapidPublicKey}`, {
      credentials: 'include',
    })
    return res.ok
  } catch {
    return false
  }
}

/** Current browser permission for the Notification API. */
export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isWebPushSupported()) return 'unsupported'
  return Notification.permission
}

/** Current browser subscription, if any (does not prompt). */
export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (!isWebPushSupported()) return null
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return null
  return registration.pushManager.getSubscription()
}

/** True when this browser can already receive pushes (permission + endpoint). */
export async function isDevicePushReady(): Promise<boolean> {
  if (getNotificationPermission() !== 'granted') return false
  return (await getCurrentPushSubscription()) != null
}

/**
 * Full enable flow: register SW, ask permission, subscribe with the server
 * VAPID key, and store the endpoint server-side. Throws with a readable
 * message when a step fails (caller shows it in the UI).
 *
 * Call only from a user gesture (toggle click or Enable button). Browsers
 * suppress or ignore a bare permission request on page load.
 */
export async function enableWebPush(token: string): Promise<void> {
  if (!isWebPushSupported()) {
    throw new Error('This browser does not support push notifications.')
  }
  if (Notification.permission === 'denied') {
    throw new Error('Notification permission is blocked in this browser.')
  }
  const registration = (await registerServiceWorker()) ?? undefined
  if (!registration) {
    throw new Error('Could not register the notification service worker.')
  }

  const permission =
    Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.')
  }

  const { public_key: vapidKey } = await bokitoGetVapidPublicKey(token)
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
    }))

  const json = subscription.toJSON()
  await bokitoSubscribePush(token, {
    endpoint: subscription.endpoint,
    keys: (json.keys ?? {}) as Record<string, string>,
  })
}

/** Subscribe this browser when needed. No-op when already ready. */
export async function ensureWebPush(token: string): Promise<boolean> {
  if (await isDevicePushReady()) return true
  await enableWebPush(token)
  return true
}

const PUSH_SOFT_DISMISS_KEY = 'bokito-push-soft-dismissed'

export function isPushSoftPromptDismissed(): boolean {
  try {
    return window.localStorage.getItem(PUSH_SOFT_DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissPushSoftPrompt(): void {
  try {
    window.localStorage.setItem(PUSH_SOFT_DISMISS_KEY, '1')
  } catch {
    // Ignore private-mode storage failures.
  }
}

/** Clear the soft-prompt dismiss so a later Push toggle can ask again. */
export function reopenPushSoftPrompt(): void {
  try {
    window.localStorage.removeItem(PUSH_SOFT_DISMISS_KEY)
  } catch {
    // Ignore private-mode storage failures.
  }
}

/** Unsubscribe this browser and remove the endpoint server-side. */
export async function disableWebPush(token: string): Promise<void> {
  const subscription = await getCurrentPushSubscription()
  if (!subscription) return
  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  try {
    await bokitoUnsubscribePush(token, endpoint)
  } catch {
    // Endpoint removal is best-effort; dead endpoints fail silently server-side.
  }
}
