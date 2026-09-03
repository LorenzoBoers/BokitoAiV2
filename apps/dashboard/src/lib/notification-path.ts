import { activityTerminalPath, decisionsPath, inboxPath, agentRunsPath } from './messages-paths'

export type NotificationPayload = Record<string, unknown>

function stringField(payload: NotificationPayload, key: string): string | null {
  const value = payload[key]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

export function isInternalNotificationPayload(payload: NotificationPayload): boolean {
  const channel = (stringField(payload, 'channel') ?? '').toLowerCase()
  const folder = stringField(payload, 'folder') ?? ''
  return folder === 'internal' || channel === 'internal' || channel === 'assistant'
}

/** Resolve the thread id carried on a notification payload. */
export function notificationSignalId(payload: NotificationPayload): string | null {
  return stringField(payload, 'signal_id') ?? stringField(payload, 'thread_id')
}

/** Route a notification to the surface that owns it. */
export function pathForNotification(input: {
  kind: string
  payload: NotificationPayload
}): string | null {
  const { kind, payload } = input
  const signalId = notificationSignalId(payload)

  if (kind === 'decision_request') {
    if (!signalId) return decisionsPath()
    // `?message=` scrolls straight to the card instead of the thread top,
    // which matters most on mobile where a thread can be long.
    const messageId = stringField(payload, 'message_id')
    return messageId
      ? `${decisionsPath(signalId)}?message=${encodeURIComponent(messageId)}`
      : decisionsPath(signalId)
  }

  if (signalId) {
    if (isInternalNotificationPayload(payload)) {
      return agentRunsPath('all', signalId)
    }
    // Prefer All so pending/unassigned/closed deep links still land on the
    // intended thread; Communication retargets closed/spam/snoozed boxes.
    return inboxPath('all', signalId)
  }

  if (typeof payload.platform_change_id === 'string') return '/settings/govern?tab=drafts'
  if (typeof payload.agent_id === 'string') return `/agents/${payload.agent_id}`
  if (typeof payload.contact_id === 'string') return `/contacts/${payload.contact_id}`
  if (typeof payload.trigger_id === 'string') return '/agenda'

  if (kind === 'ops_alert') {
    if (typeof payload.account_id === 'string') return '/settings/channels'
    return activityTerminalPath()
  }

  if (kind === 'status_update') {
    return isInternalNotificationPayload(payload) ? activityTerminalPath() : inboxPath('all')
  }

  return null
}
