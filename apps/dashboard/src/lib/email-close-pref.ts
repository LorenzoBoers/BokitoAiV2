import { appRoutes } from '../api/routes'
import { APP_API_BASE } from './api.config'

const STORAGE_KEY = 'bokito-close-email-on-send'
export const CLOSE_EMAIL_ON_SEND_EVENT = 'bokito-close-email-on-send'

export function readCachedCloseEmailOnSend(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function writeCachedCloseEmailOnSend(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // ignore private-mode / quota
  }
  window.dispatchEvent(new CustomEvent(CLOSE_EMAIL_ON_SEND_EVENT, { detail: enabled }))
}

export async function fetchCloseEmailOnSend(token: string): Promise<boolean> {
  const res = await fetch(`${APP_API_BASE}${appRoutes.me.preferences}`, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'include',
  })
  if (!res.ok) return readCachedCloseEmailOnSend()
  const data = (await res.json()) as { close_email_on_send?: unknown }
  const enabled = data.close_email_on_send === true
  writeCachedCloseEmailOnSend(enabled)
  return enabled
}

export async function persistCloseEmailOnSend(token: string, enabled: boolean): Promise<void> {
  const res = await fetch(`${APP_API_BASE}${appRoutes.me.preferences}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ close_email_on_send: enabled }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  writeCachedCloseEmailOnSend(enabled)
}
