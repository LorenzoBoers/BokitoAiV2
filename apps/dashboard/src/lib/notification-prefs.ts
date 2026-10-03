export type NotificationChannel = 'inapp' | 'push' | 'email'
export type NotificationTier = '1' | '2' | '3'
export type ChannelSwitches = Record<NotificationChannel, boolean>

export type NotificationCategoryRow = { id: string; channels: ChannelSwitches }

export type NotificationPrefs = {
  tiers: Record<NotificationTier, ChannelSwitches>
  rows: NotificationCategoryRow[]
}

export const NOTIFICATION_TIERS: NotificationTier[] = ['1', '2', '3']
export const NOTIFICATION_CHANNELS: NotificationChannel[] = ['inapp', 'push', 'email']

/** Tier 2 and 3 never push; tier 3 email is the daily digest. Mirrors `services/notify.py`. */
export const TIER_ALLOWED: Record<NotificationTier, NotificationChannel[]> = {
  '1': ['inapp', 'push', 'email'],
  '2': ['inapp', 'email'],
  '3': ['inapp', 'email'],
}

export const CATEGORY_IDS = ['assigned-to-me', 'mentions', 'decisions', 'handoff', 'digest-weekly'] as const

/** Channels a category row can switch; the weekly digest is email only. */
export const CATEGORY_ALLOWED: Record<string, NotificationChannel[]> = {
  'assigned-to-me': ['inapp', 'push', 'email'],
  mentions: ['inapp', 'push', 'email'],
  decisions: ['inapp', 'push', 'email'],
  handoff: ['inapp', 'push', 'email'],
  'digest-weekly': ['email'],
}

const on = (inapp: boolean, push: boolean, email: boolean): ChannelSwitches => ({ inapp, push, email })

export function defaultNotificationPrefs(): NotificationPrefs {
  return {
    tiers: { '1': on(true, true, false), '2': on(true, false, false), '3': on(true, false, false) },
    rows: [
      { id: 'assigned-to-me', channels: on(true, true, false) },
      { id: 'mentions', channels: on(true, true, false) },
      { id: 'decisions', channels: on(true, true, false) },
      { id: 'handoff', channels: on(true, true, false) },
      { id: 'digest-weekly', channels: on(false, false, false) },
    ],
  }
}

function switches(raw: unknown, fallback: ChannelSwitches): ChannelSwitches {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<NotificationChannel, unknown>>
  return {
    inapp: typeof value.inapp === 'boolean' ? value.inapp : fallback.inapp,
    push: typeof value.push === 'boolean' ? value.push : fallback.push,
    email: typeof value.email === 'boolean' ? value.email : fallback.email,
  }
}

/** Fill gaps from the defaults and drop unknown categories. */
export function normalizeNotificationPrefs(raw: unknown): NotificationPrefs {
  const defaults = defaultNotificationPrefs()
  const data = (raw && typeof raw === 'object' ? raw : {}) as {
    tiers?: Record<string, unknown>
    rows?: Array<{ id?: unknown; channels?: unknown }>
  }
  const tiers = { ...defaults.tiers }
  for (const tier of NOTIFICATION_TIERS) tiers[tier] = switches(data.tiers?.[tier], defaults.tiers[tier])
  const rows = defaults.rows.map((row) => {
    const stored = Array.isArray(data.rows) ? data.rows.find((r) => r?.id === row.id) : undefined
    return { id: row.id, channels: switches(stored?.channels, row.channels) }
  })
  return { tiers, rows }
}

export function setTierChannel(
  prefs: NotificationPrefs,
  tier: NotificationTier,
  channel: NotificationChannel,
  value: boolean,
): NotificationPrefs {
  return { ...prefs, tiers: { ...prefs.tiers, [tier]: { ...prefs.tiers[tier], [channel]: value } } }
}

export function setCategoryChannel(
  prefs: NotificationPrefs,
  id: string,
  channel: NotificationChannel,
  value: boolean,
): NotificationPrefs {
  return {
    ...prefs,
    rows: prefs.rows.map((row) => (row.id === id ? { ...row, channels: { ...row.channels, [channel]: value } } : row)),
  }
}
