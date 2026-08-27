export type NotificationChannelKey = 'desktop' | 'email' | 'slack'

export type NotificationPrefRow = {
  id: string
  label: string
  channels: { desktop?: boolean; email?: boolean; slack?: boolean }
}

/** Only categories the backend actually enforces. Labels stay English for persist. */
export const DEFAULT_NOTIFICATION_ROWS: NotificationPrefRow[] = [
  {
    id: 'assigned-to-me',
    label: 'When a conversation is assigned to you',
    channels: { desktop: true, email: false },
  },
  {
    id: 'mentions',
    label: 'When you are mentioned in conversations',
    channels: { desktop: true, email: false },
  },
  {
    id: 'decisions',
    label: 'When an agent needs your decision on an assigned conversation',
    channels: { desktop: true, email: false, slack: false },
  },
  {
    id: 'ops-run-failed',
    label: 'When an agent run or trigger fails',
    channels: { desktop: true, email: false },
  },
  {
    id: 'ops-channel-disconnect',
    label: 'When a connected channel stops syncing',
    channels: { desktop: true, email: false },
  },
  {
    id: 'billing-alerts',
    label: 'When LLM spend reaches 80% or 100% of the budget',
    channels: { desktop: true, email: false },
  },
  {
    id: 'digest-daily',
    label: 'Daily email digest (open threads, pending decisions, agent activity)',
    channels: { email: false },
  },
  {
    id: 'digest-weekly',
    label: 'Weekly email digest',
    channels: { email: false },
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
