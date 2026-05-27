import type { InboxListQuickFilter } from '../../context/InboxCommunicationContext'
import type { InboxThread } from '../../lib/inbox-api'
import ThreadListItem from './ThreadListItem'
import ThreadListQuickFilters from './ThreadListQuickFilters'

type Props = {
  threads: InboxThread[]
  allThreads: InboxThread[]
  loading: boolean
  error: string | null
  selectedId: number | null
  quickFilter: InboxListQuickFilter
  onQuickFilterChange: (filter: InboxListQuickFilter) => void
  onSelectThread: (id: number) => void
  onMarkRead: (id: number) => void
  onMarkUnread: (id: number) => void
  onTogglePin: (id: number, currentPinned: boolean) => void
  onDelete: (id: number) => void
  deletingThreadId?: number | null
}

function buildFilterCounts(threads: InboxThread[]) {
  return {
    all: threads.length,
    unread: threads.filter((t) => t.hasUnread).length,
    pinned: threads.filter((t) => t.isPinned).length,
  }
}

export default function ThreadList({
  threads,
  allThreads,
  loading,
  error,
  selectedId,
  quickFilter,
  onQuickFilterChange,
  onSelectThread,
  onMarkRead,
  onMarkUnread,
  onTogglePin,
  onDelete,
  deletingThreadId = null,
}: Props) {
  const counts = buildFilterCounts(allThreads)

  return (
    <div className="flex flex-col h-full min-h-0 w-72 shrink-0 border-r border-border/50 bg-bg-surface">
      <ThreadListQuickFilters value={quickFilter} onChange={onQuickFilterChange} counts={counts} />

      <div className="flex-1 overflow-y-auto min-h-0 p-1.5 space-y-0.5">
        {threads.length === 0 ? (
          loading ? (
            <div className="py-8 text-center text-xs text-text-muted">Laden...</div>
          ) : error ? (
            <div className="py-4 px-3 text-xs text-status-error">{error}</div>
          ) : (
            <div className="py-8 text-center text-xs text-text-muted">Geen threads gevonden.</div>
          )
        ) : (
          threads.map((thread) => (
            <ThreadListItem
              key={thread.id}
              thread={thread}
              isSelected={thread.id === selectedId}
              onSelect={onSelectThread}
              onMarkRead={onMarkRead}
              onMarkUnread={onMarkUnread}
              onTogglePin={onTogglePin}
              onDelete={onDelete}
              deleting={deletingThreadId === thread.id}
            />
          ))
        )}
      </div>
    </div>
  )
}
