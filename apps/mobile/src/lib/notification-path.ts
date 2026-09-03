export type NotificationData = {
  signal_id?: string
  message_id?: string
  decision_id?: string
  agent_id?: string
  contact_id?: string
  platform_change_id?: string
  trigger_id?: string
  account_id?: string
  channel?: string
  folder?: string
  kind?: string
}

export type NotificationRoute =
  | { type: 'app'; path: '/(tabs)/home' | '/(tabs)/inbox' | '/(tabs)/decisions' | `/thread/${string}` }
  | { type: 'web'; path: string }

function isInternalPayload(data: NotificationData): boolean {
  const channel = (data.channel ?? '').toLowerCase()
  return data.folder === 'internal' || channel === 'internal' || channel === 'assistant'
}

export function resolveNotificationRoute(data: NotificationData | undefined): NotificationRoute {
  if (!data) return { type: 'app', path: '/(tabs)/home' }

  if (data.signal_id) {
    // A decision push carries its card: open the thread on that message.
    const suffix = data.message_id ? `?message=${encodeURIComponent(data.message_id)}` : ''
    return { type: 'app', path: `/thread/${data.signal_id}${suffix}` }
  }

  if (
    data.decision_id ||
    data.kind === 'decision' ||
    data.kind === 'decision_request' ||
    (data.kind ?? '').startsWith('decision')
  ) {
    // No thread yet (or none sent): the queue is the only place to act.
    return { type: 'app', path: '/(tabs)/decisions' }
  }

  if (data.platform_change_id) return { type: 'web', path: '/settings/govern?tab=drafts' }
  if (data.agent_id) return { type: 'web', path: `/agents/${data.agent_id}` }
  if (data.contact_id) return { type: 'web', path: `/contacts/${data.contact_id}` }
  if (data.trigger_id) return { type: 'web', path: '/agenda' }

  if (data.kind === 'ops_alert') {
    if (data.account_id) return { type: 'web', path: '/settings/channels' }
    return { type: 'app', path: isInternalPayload(data) ? '/(tabs)/inbox' : '/(tabs)/inbox' }
  }

  if (
    data.kind === 'message' ||
    data.kind === 'assigned' ||
    data.kind === 'assignment' ||
    data.kind === 'mention' ||
    data.kind === 'handoff' ||
    data.kind === 'status_update'
  ) {
    return { type: 'app', path: '/(tabs)/inbox' }
  }

  return { type: 'app', path: '/(tabs)/home' }
}

/** App-only path used by existing callers and tests. Web-only kinds land on Home. */
export function pathFromNotificationData(
  data: NotificationData | undefined,
): '/(tabs)/home' | '/(tabs)/inbox' | '/(tabs)/decisions' | `/thread/${string}` {
  const route = resolveNotificationRoute(data)
  return route.type === 'app' ? route.path : '/(tabs)/home'
}
