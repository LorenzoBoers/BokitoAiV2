import { loadPreferences, setPref } from './preferences'

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
  try {
    const data = await loadPreferences(token)
    const enabled = data.close_email_on_send === true
    writeCachedCloseEmailOnSend(enabled)
    return enabled
  } catch {
    return readCachedCloseEmailOnSend()
  }
}

export async function persistCloseEmailOnSend(token: string, enabled: boolean): Promise<void> {
  await setPref('close_email_on_send', enabled, token)
  writeCachedCloseEmailOnSend(enabled)
}
