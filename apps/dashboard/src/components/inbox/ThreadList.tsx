import { Tag, X } from 'lucide-react'
import type { InboxListQuickFilter } from '../../context/InboxCommunicationContext'
import type { BulkThreadAction, InboxThread, ThreadId } from '../../lib/inbox-api'
import BulkActionsBar from './BulkActionsBar'
import ThreadListItem from './ThreadListItem'
import ThreadListQuickFilters from './ThreadListQuickFilters'

type Props = {
  threads: InboxThread[]
  allThreads: InboxThread[]
  loading: boolean
  error: string | null
  selectedId: ThreadId | null
  quickFilter: InboxListQuickFilter
  onQuickFilterChange: (filter: InboxListQuickFilter) => void
  onSelectThread: (id: ThreadId) => void
  onMarkRead: (id: ThreadId) => void
  onMarkUnread: (id: ThreadId) => void
  onTogglePin: (id: ThreadId, currentPinned: boolean) => void
  onDelete: (id: ThreadId) => void
  deletingThreadId?: ThreadId | null
  variant?: 'customer' | 'direct'
  /** Bulk selection: omit to hide checkboxes (e.g. direct/assistant lists). */
  bulkSelectedIds?: ReadonlySet<string>
  onToggleBulkSelect?: (id: ThreadId) => void
  onBulkAction?: (action: BulkThreadAction, assigneeId?: number) => void
  onClearBulkSelection?: () => void
  bulkBusy?: boolean
  /** Active label filter (server-side `?tag=`); null shows all threads. */
  activeTag?: string | null
  /** Set/clear the label filter; omit to make tag chips non-interactive. */
  onTagSelect?: (tag: string | null) => void
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
  variant = 'customer',
  bulkSelectedIds,
  onToggleBulkSelect,
  onBulkAction,
  onClearBulkSelection,
  bulkBusy = false,
  activeTag = null,
  onTagSelect,
}: Props) {
  const counts = buildFilterCounts(allThreads)
  const selectionActive = (bulkSelectedIds?.size ?? 0) > 0

  return (
    <div className="flex flex-col h-full min-h-0 w-72 shrink-0 border-r border-border/50 bg-bg-surface">
      {selectionActive && onBulkAction && onClearBulkSelection ? (
        <BulkActionsBar
          count={bulkSelectedIds?.size ?? 0}
          busy={bulkBusy}
          onAction={onBulkAction}
          onClear={onClearBulkSelection}
        />
      ) : (
        <ThreadListQuickFilters value={quickFilter} onChange={onQuickFilterChange} counts={counts} />
      )}

      {activeTag && onTagSelect ? (
        <div className="flex items-center gap-1.5 border-b border-border/40 bg-accent/5 px-3 py-1.5">
          <Tag size={11} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-text-heading">
            {activeTag}
          </span>
          <button
            type="button"
            aria-label="Clear label filter"
            onClick={() => onTagSelect(null)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
          >
            <X size={11} />
          </button>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto min-h-0 p-1.5 space-y-0.5">
        {threads.length === 0 ? (
          loading ? (
            <div className="py-8 text-center text-xs text-text-muted">Loading...</div>
          ) : error ? (
            <div className="py-4 px-3 text-xs text-status-error">{error}</div>
          ) : (
            <div className="py-8 text-center text-xs text-text-muted">No threads found.</div>
          )
        ) : (
          threads.map((thread) => (
            <ThreadListItem
              key={thread.id}
              thread={thread}
              isSelected={String(thread.id) === String(selectedId)}
              onSelect={onSelectThread}
              onMarkRead={onMarkRead}
              onMarkUnread={onMarkUnread}
              onTogglePin={onTogglePin}
              onDelete={onDelete}
              deleting={String(deletingThreadId) === String(thread.id)}
              variant={variant}
              checked={bulkSelectedIds?.has(String(thread.id))}
              onToggleChecked={onToggleBulkSelect}
              selectionActive={selectionActive}
              onTagClick={onTagSelect ? (tag) => onTagSelect(tag) : undefined}
            />
          ))
        )}
      </div>
    </div>
  )
}
