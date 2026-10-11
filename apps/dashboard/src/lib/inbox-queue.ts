import type { InboxThread } from './inbox-api'
import { isAgentRunThread } from './message-composer'
import type { InboxQueue } from './messages-paths'

export function threadFitsInboxQueue(
  thread: Pick<InboxThread, 'status' | 'assignedToUserId' | 'channel' | 'folder' | 'owner' | 'turn'> &
    Partial<Pick<InboxThread, 'nextAt' | 'schedule'>>,
  queue: InboxQueue,
  userId: number | null,
): boolean {
  switch (queue) {
    case 'all':
      // Mirrors view=all server-side: closing moves a thread out of "All".
      return thread.status !== 'closed' && thread.status !== 'spam'
    case 'for_you':
      // Team turns and mentions are decided server-side; keep the row.
      return (
        thread.status === 'open' &&
        (thread.assignedToUserId === userId ||
          thread.turn?.userNum === userId ||
          thread.turn?.kind === 'team' ||
          thread.owner?.kind === 'team')
      )
    case 'open':
      // Agent runs stay out unless a person or team must act on them.
      return (
        thread.status === 'open' &&
        (!isAgentRunThread(thread) || thread.turn?.kind === 'user' || thread.turn?.kind === 'team')
      )
    case 'unassigned':
      return thread.status === 'open' && (thread.owner ? thread.owner.kind === 'team' : thread.assignedToUserId == null)
    case 'scheduled':
      return (thread.nextAt != null || thread.schedule != null) && thread.status !== 'spam'
    case 'closed':
      return thread.status === 'closed'
    case 'spam':
      return thread.status === 'spam'
    default:
      return true
  }
}

/** Dedicated inbox queue for a resolved status. */
export function dedicatedInboxQueueForStatus(
  status: InboxThread['status'],
): InboxQueue | null {
  if (status === 'closed') return 'closed'
  if (status === 'spam') return 'spam'
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
