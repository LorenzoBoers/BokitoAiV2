export type NotificationChannel = 'inapp' | 'push' | 'email'
export type NotificationTier = '1' | '2' | '3'
export type ChannelSwitches = Record<NotificationChannel, boolean>

export type NotificationCategoryRow = { id: string; channels: ChannelSwitches }

export type NotificationPrefs = {
  tiers: Record<NotificationTier, ChannelSwitches>
  rows: NotificationCategoryRow[]
  /** Dashboard chime for live notices (same tone as the chat widget). */
  sound: boolean
  /** Bump with `services/notify.py` PREFS_VERSION when defaults override stored rows. */
  version: number
}

/** Mirrors `services/notify.py` PREFS_VERSION — v2 turns new-message on by default. */
export const NOTIFICATION_PREFS_VERSION = 2

export const NOTIFICATION_TIERS: NotificationTier[] = ['1', '2', '3']
export const NOTIFICATION_CHANNELS: NotificationChannel[] = ['inapp', 'push', 'email']

/** Tier 2 and 3 never push; tier 3 email is the daily digest. Mirrors `services/notify.py`. */
export const TIER_ALLOWED: Record<NotificationTier, NotificationChannel[]> = {
  '1': ['inapp', 'push', 'email'],
  '2': ['inapp', 'email'],
  '3': ['inapp', 'email'],
}

export const CATEGORY_IDS = [
  'assigned-to-me',
  'mentions',
  'decisions',
  'handoff',
  'new-message',
  'ops-run-failed',
  'ops-channel-disconnect',
  'billing-alerts',
  'digest-weekly',
] as const

/** Channels a category row can switch. Push stays on tier-1 events; the weekly digest is email only. */
export const CATEGORY_ALLOWED: Record<string, NotificationChannel[]> = {
  'assigned-to-me': ['inapp', 'push', 'email'],
  mentions: ['inapp', 'push', 'email'],
  decisions: ['inapp', 'push', 'email'],
  handoff: ['inapp', 'push', 'email'],
  'new-message': ['inapp', 'push', 'email'],
  'ops-run-failed': ['inapp', 'email'],
  'ops-channel-disconnect': ['inapp', 'email'],
  'billing-alerts': ['inapp', 'push', 'email'],
  'digest-weekly': ['email'],
}

export type NotificationSectionId = 'conversations' | 'workspace' | 'digest'

/** Event groups under the delivery tiers. Order is the settings matrix order. */
export const NOTIFICATION_SECTIONS: { id: NotificationSectionId; rows: string[] }[] = [
  {
    id: 'conversations',
    rows: ['assigned-to-me', 'mentions', 'decisions', 'handoff', 'new-message'],
  },
  {
    id: 'workspace',
    rows: ['ops-run-failed', 'ops-channel-disconnect', 'billing-alerts'],
  },
  { id: 'digest', rows: ['digest-weekly'] },
]

const on = (inapp: boolean, push: boolean, email: boolean): ChannelSwitches => ({ inapp, push, email })

export function defaultNotificationPrefs(): NotificationPrefs {
  return {
    version: NOTIFICATION_PREFS_VERSION,
    tiers: { '1': on(true, true, false), '2': on(true, false, false), '3': on(true, false, false) },
    rows: [
      { id: 'assigned-to-me', channels: on(true, true, false) },
      { id: 'mentions', channels: on(true, true, false) },
      { id: 'decisions', channels: on(true, true, false) },
      { id: 'handoff', channels: on(true, true, false) },
      { id: 'new-message', channels: on(true, true, false) },
      { id: 'ops-run-failed', channels: on(true, false, true) },
      { id: 'ops-channel-disconnect', channels: on(true, false, true) },
      { id: 'billing-alerts', channels: on(true, true, true) },
      { id: 'digest-weekly', channels: on(false, false, false) },
    ],
    sound: true,
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
    version?: unknown
    tiers?: Record<string, unknown>
    rows?: Array<{ id?: unknown; channels?: unknown }>
    sound?: unknown
  }
  const storedVersion = typeof data.version === 'number' ? data.version : 1
  const tiers = { ...defaults.tiers }
  for (const tier of NOTIFICATION_TIERS) tiers[tier] = switches(data.tiers?.[tier], defaults.tiers[tier])
  const rows = defaults.rows.map((row) => {
    const stored = Array.isArray(data.rows) ? data.rows.find((r) => r?.id === row.id) : undefined
    // v2: owned-conversation new-message defaults on (For you attention path).
    if (row.id === 'new-message' && storedVersion < 2) {
      return { id: row.id, channels: { ...defaults.rows.find((r) => r.id === 'new-message')!.channels } }
    }
    const channels = switches(stored?.channels, row.channels)
    if (row.id.startsWith('ops-')) channels.inapp = true
    return { id: row.id, channels }
  })
  return {
    version: NOTIFICATION_PREFS_VERSION,
    tiers,
    rows,
    sound: typeof data.sound === 'boolean' ? data.sound : defaults.sound,
  }
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
  return setCategoryCells(prefs, [id], [channel], value)
}

function allowedFor(id: string, channel: NotificationChannel): boolean {
  return (CATEGORY_ALLOWED[id] ?? []).includes(channel)
}

/** True when every allowed cell in these rows and channels is on. An empty set is off. */
export function categoryCellsOn(
  prefs: NotificationPrefs,
  ids: string[],
  channels: NotificationChannel[],
): boolean {
  const cells: boolean[] = []
  for (const id of ids) {
    const row = prefs.rows.find((item) => item.id === id)
    if (!row) continue
    for (const channel of channels) {
      if (allowedFor(id, channel)) cells.push(row.channels[channel])
    }
  }
  return cells.length > 0 && cells.every(Boolean)
}

/** Set every allowed cell. Channels a row cannot use stay as they are. */
export function setCategoryCells(
  prefs: NotificationPrefs,
  ids: string[],
  channels: NotificationChannel[],
  value: boolean,
): NotificationPrefs {
  const wanted = new Set(ids)
  return {
    ...prefs,
    rows: prefs.rows.map((row) => {
      if (!wanted.has(row.id)) return row
      const next = { ...row.channels }
      for (const channel of channels) {
        if (channel === 'inapp' && row.id.startsWith('ops-')) continue
        if (allowedFor(row.id, channel)) next[channel] = value
      }
      return { ...row, channels: next }
    }),
  }
}

/** True when every allowed cell on these tiers and channels is on. */
export function tierCellsOn(
  prefs: NotificationPrefs,
  tiers: NotificationTier[],
  channels: NotificationChannel[],
): boolean {
  const cells: boolean[] = []
  for (const tier of tiers) {
    for (const channel of channels) {
      if (TIER_ALLOWED[tier].includes(channel)) cells.push(prefs.tiers[tier][channel])
    }
  }
  return cells.length > 0 && cells.every(Boolean)
}

export function setTierCells(
  prefs: NotificationPrefs,
  tiers: NotificationTier[],
  channels: NotificationChannel[],
  value: boolean,
): NotificationPrefs {
  const next = { ...prefs.tiers }
  for (const tier of tiers) {
    const row = { ...next[tier] }
    for (const channel of channels) {
      if (TIER_ALLOWED[tier].includes(channel)) row[channel] = value
    }
    next[tier] = row
  }
  return { ...prefs, tiers: next }
}
