import type { InboxThread } from './inbox-api'
import { isInternalThread } from './message-composer'
import type { InboxQueue } from './messages-paths'

export function threadFitsInboxQueue(
  thread: Pick<InboxThread, 'status' | 'assignedToUserId' | 'channel' | 'folder'>,
  queue: InboxQueue,
  userId: number | null,
): boolean {
  switch (queue) {
    case 'all':
      // Mirrors view=all server-side: closing moves a thread out of "All".
      return thread.status !== 'closed' && thread.status !== 'spam'
    case 'mine':
      return thread.status === 'open' && thread.assignedToUserId === userId
    case 'open':
      return thread.status === 'open' && !isInternalThread(thread)
    case 'unassigned':
      return thread.status === 'open' && thread.assignedToUserId == null
    case 'snoozed':
      return thread.status === 'pending'
    case 'closed':
      return thread.status === 'closed'
    case 'spam':
      return thread.status === 'spam'
    default:
      return true
  }
}

/** Dedicated inbox queue for a parked or resolved status. */
export function dedicatedInboxQueueForStatus(
  status: InboxThread['status'],
): InboxQueue | null {
  if (status === 'closed') return 'closed'
  if (status === 'spam') return 'spam'
  if (status === 'pending') return 'snoozed'
  return null
}

/** True when a resolve/park action should leave the current inbox, not hop away. */
export function resolvedStatusLeavesInboxQueue(
  status: InboxThread['status'],
  queue: InboxQueue,
): boolean {
  const dedicated = dedicatedInboxQueueForStatus(status)
  return dedicated != null && queue !== dedicated
}

/** First remaining conversation in the current box after leaving `fromId`. */
export function pickRemainingInboxThread<T extends { id: string | number }>(
  threads: readonly T[],
  fromId: string | number,
): T | null {
  return threads.find((thread) => String(thread.id) !== String(fromId)) ?? null
}
