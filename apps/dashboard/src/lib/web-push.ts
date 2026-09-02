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

/** Current browser subscription, if any (does not prompt). */
export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (!isWebPushSupported()) return null
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return null
  return registration.pushManager.getSubscription()
}

/**
 * Full enable flow: register SW, ask permission, subscribe with the server
 * VAPID key, and store the endpoint server-side. Throws with a readable
 * message when a step fails (caller shows it in the UI).
 */
export async function enableWebPush(token: string): Promise<void> {
  if (!isWebPushSupported()) {
    throw new Error('This browser does not support push notifications.')
  }
  const registration = (await registerServiceWorker()) ?? undefined
  if (!registration) {
    throw new Error('Could not register the notification service worker.')
  }

  const permission = await Notification.requestPermission()
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
