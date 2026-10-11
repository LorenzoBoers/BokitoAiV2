/**
 * Which bulk actions make sense for the folder (and optional quick filter)
 * the operator is looking at. Hide no-ops such as Close in Closed.
 */

export type BulkPrimaryDisposition = 'close' | 'reopen' | 'not_spam'

export type BulkActionsVisibility = {
  /** Main-bar status action; null when none belongs up front. */
  primary: BulkPrimaryDisposition | null
  showClose: boolean
  showReopen: boolean
  /** "Mark as spam" — hidden in Spam where every row already is. */
  showSpam: boolean
  /** Pin in the main bar. */
  showPin: boolean
  /** Unpin under More actions (or promoted when the list is Pinned). */
  showUnpin: boolean
  showRead: boolean
  showUnread: boolean
}

/** Folder queues that lock every row to one status. */
export function bulkActionsVisibility(
  queue: string | null | undefined,
  quickFilter: string | null | undefined = 'all',
): BulkActionsVisibility {
  const filter = quickFilter || 'all'
  const pinnedOnly = filter === 'pinned'
  const unreadOnly = filter === 'unread'

  const base: BulkActionsVisibility = {
    primary: 'close',
    showClose: true,
    showReopen: false,
    showSpam: true,
    showPin: !pinnedOnly,
    showUnpin: true,
    showRead: true,
    showUnread: !unreadOnly,
  }

  switch (queue) {
    case 'closed':
      return {
        ...base,
        primary: 'reopen',
        showClose: false,
        showReopen: true,
        showSpam: true,
      }
    case 'spam':
      return {
        ...base,
        primary: 'not_spam',
        showClose: false,
        showReopen: true,
        showSpam: false,
      }
    case 'scheduled':
      // Dated rows can be open or closed until their moment.
      return {
        ...base,
        primary: 'close',
        showClose: true,
        showReopen: true,
        showSpam: true,
      }
    case 'open':
    case 'for_you':
    case 'unassigned':
    case 'all':
      return base
    default:
      // Unknown or mixed folders (e.g. a project without a sub-queue): keep every action.
      return {
        ...base,
        primary: 'close',
        showClose: true,
        showReopen: true,
        showSpam: true,
      }
  }
}
