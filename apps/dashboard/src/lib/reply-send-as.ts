/** Send-as choice for approved reply suggestions.
 *
 * Order of precedence for the selector's initial value:
 * 1. the operator's own last choice (localStorage),
 * 2. the tenant default (`reply_send_as` from AI communication settings),
 * 3. "user".
 */

import { getAiCommunicationSettings, type ReplySendAs } from './inbox-api'

const STORAGE_KEY = 'bokito.replySendAs'

let tenantDefaultPromise: Promise<ReplySendAs> | null = null

function normalize(value: unknown): ReplySendAs | null {
  return value === 'user' || value === 'agent' ? value : null
}

export function rememberedSendAs(): ReplySendAs | null {
  try {
    return normalize(localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

export function rememberSendAs(value: ReplySendAs): void {
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // Storage unavailable (private mode): the tenant default still applies.
  }
}

/** Tenant default, fetched once per session. */
export function tenantDefaultSendAs(token: string): Promise<ReplySendAs> {
  if (!tenantDefaultPromise) {
    tenantDefaultPromise = getAiCommunicationSettings(token)
      .then((settings) => settings.replySendAs)
      .catch(() => 'user' as ReplySendAs)
  }
  return tenantDefaultPromise
}

/** Invalidate the cached tenant default (call after saving settings). */
export function resetTenantDefaultSendAs(): void {
  tenantDefaultPromise = null
}
