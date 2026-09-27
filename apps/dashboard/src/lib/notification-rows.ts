export type NotificationChannelKey = 'desktop' | 'email' | 'push'

export type NotificationPrefRow = {
  id: string
  label: string
  channels: { desktop?: boolean; email?: boolean; push?: boolean }
}

/**
 * Ping triggers (decision / mentioned / assigned) plus opt-in email digests.
 * Channel choice (desktop / email / push) stays; ops/handoff alerts always fire.
 */
export const DEFAULT_NOTIFICATION_ROWS: NotificationPrefRow[] = [
  {
    id: 'assigned-to-me',
    label: 'When a conversation is assigned to you',
    channels: { desktop: true, email: false, push: true },
  },
  {
    id: 'mentions',
    label: 'When you are mentioned in conversations',
    channels: { desktop: true, email: false, push: true },
  },
  {
    id: 'decisions',
    label: 'When a decision needs you',
    channels: { desktop: true, email: false, push: true },
  },
  {
    id: 'handoff',
    label: 'When a customer asks for a human',
    channels: { desktop: true, email: false, push: true },
  },
  {
    id: 'digest-daily',
    label: 'Daily email digest',
    channels: { desktop: false, email: false, push: false },
  },
  {
    id: 'digest-weekly',
    label: 'Weekly email digest',
    channels: { desktop: false, email: false, push: false },
  },
]

const KNOWN_ROW_IDS = new Set(DEFAULT_NOTIFICATION_ROWS.map((row) => row.id))
const DEFAULT_BY_ID = new Map(DEFAULT_NOTIFICATION_ROWS.map((row) => [row.id, row]))

export function canonicalizeNotificationRows(incoming: NotificationPrefRow[]): NotificationPrefRow[] {
  return incoming
    .filter((row) => KNOWN_ROW_IDS.has(row.id))
    .map((row) => {
      const fallback = DEFAULT_BY_ID.get(row.id)!
      return { ...fallback, channels: { ...fallback.channels, ...row.channels } }
    })
}

export function pauseAllDesktop(rows: NotificationPrefRow[]): NotificationPrefRow[] {
  return rows.map((row) =>
    row.channels.desktop === undefined ? row : { ...row, channels: { ...row.channels, desktop: false } },
  )
}

export function restoreDefaultNotificationRows(): NotificationPrefRow[] {
  return DEFAULT_NOTIFICATION_ROWS.map((row) => ({
    ...row,
    channels: { ...row.channels },
  }))
}

export function desktopEnabledCount(rows: NotificationPrefRow[]): number {
  return rows.reduce((acc, row) => acc + (row.channels.desktop ? 1 : 0), 0)
}
