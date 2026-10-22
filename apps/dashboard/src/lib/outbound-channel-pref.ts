/**
 * Per-user default outbound mailbox for starting external mail.
 * Roams via `/me/preferences.default_outbound_connection_id`; localStorage
 * mirrors for instant paint before prefs load.
 */

import { loadPreferences, setPref } from './preferences'

const LOCAL_KEY = 'bokito.defaultOutboundConnectionId'

export function readLocalOutboundConnectionId(): number | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

export function writeLocalOutboundConnectionId(id: number | null): void {
  try {
    if (id == null || id <= 0) localStorage.removeItem(LOCAL_KEY)
    else localStorage.setItem(LOCAL_KEY, String(id))
  } catch {
    // ignore
  }
}

export async function fetchOutboundConnectionId(token: string): Promise<number | null> {
  const data = await loadPreferences(token)
  const raw = data.default_outbound_connection_id
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function saveOutboundConnectionId(token: string, id: number | null): Promise<void> {
  writeLocalOutboundConnectionId(id)
  await setPref('default_outbound_connection_id', id, token)
}

/** Pick the best mailbox: preferred id if sendable, else primary, else first. */
export function resolveOutboundConnectionId(
  sendableIds: number[],
  preferred: number | null,
): number | null {
  if (!sendableIds.length) return null
  if (preferred != null && sendableIds.includes(preferred)) return preferred
  return sendableIds[0] ?? null
}
