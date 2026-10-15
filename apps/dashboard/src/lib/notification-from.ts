/**
 * Sender mark on a notification payload (`payload.from`).
 * Absent for system notices (ops alerts, digests) — no avatar then.
 */
import { openEntityPath } from './open-entity'

export type NotificationFromKind = 'user' | 'agent' | 'contact'

export type NotificationFrom = {
  kind: NotificationFromKind
  id?: string | null
  name: string
  email?: string | null
  avatar_url?: string | null
  avatar_kind?: string | null
  avatar_icon?: string | null
  avatar_color?: string | null
  avatar_shape?: string | null
  avatar_image_url?: string | null
  host?: string | null
}

function stringField(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  return null
}

export function parseNotificationFrom(payload: Record<string, unknown> | null | undefined): NotificationFrom | null {
  const raw = payload?.from
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const kind = stringField(row.kind)?.toLowerCase()
  const name = stringField(row.name)
  if (!name || (kind !== 'user' && kind !== 'agent' && kind !== 'contact')) return null
  return {
    kind,
    id: stringField(row.id),
    name,
    email: stringField(row.email),
    avatar_url: stringField(row.avatar_url),
    avatar_kind: stringField(row.avatar_kind),
    avatar_icon: stringField(row.avatar_icon),
    avatar_color: stringField(row.avatar_color),
    avatar_shape: stringField(row.avatar_shape),
    avatar_image_url: stringField(row.avatar_image_url),
    host: stringField(row.host),
  }
}

/** Deep link for a sender name when we know who they are. */
export function notificationFromHref(from: NotificationFrom): string | null {
  if (!from.id) return null
  if (from.kind === 'agent') return openEntityPath({ type: 'agent', id: from.id })
  if (from.kind === 'contact') return openEntityPath({ type: 'contact', id: from.id })
  if (from.kind === 'user') return openEntityPath({ type: 'user', id: from.id })
  return null
}
