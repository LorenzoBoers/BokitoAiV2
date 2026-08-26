/** Collapse identical notification cards that keep firing for the same wait. */

export type NotificationLike = {
  id: string
  kind: string
  title: string
  body: string
  status: string
  payload: Record<string, unknown>
  createdAt: string
}

export type GroupedNotification<T extends NotificationLike> = T & {
  count: number
  ids: string[]
}

export function notificationGroupKey(item: NotificationLike): string {
  const payload = item.payload
  const signalId = typeof payload.signal_id === 'string' ? payload.signal_id : ''
  const changeId = typeof payload.platform_change_id === 'string' ? payload.platform_change_id : ''
  const agentId = typeof payload.agent_id === 'string' ? payload.agent_id : ''
  return [item.kind, item.title.trim().toLowerCase(), signalId || changeId || agentId].join('|')
}

export function collapseNotifications<T extends NotificationLike>(items: T[]): GroupedNotification<T>[] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = notificationGroupKey(item)
    const list = groups.get(key)
    if (list) list.push(item)
    else groups.set(key, [item])
  }
  return [...groups.values()].map((list) => {
    const newest = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? list[0]
    return { ...newest, count: list.length, ids: list.map((item) => item.id) }
  })
}
