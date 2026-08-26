import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Filter, Tag, X } from 'lucide-react'
import type { InboxListQuickFilter } from '../../context/InboxCommunicationContext'
import type { BulkThreadAction, InboxThread, ThreadId } from '../../lib/inbox-api'
import { useMembers } from '../../hooks/useMembers'
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
  /** Visible scope when the list is filtered by agent or project. */
  scopeLabel?: string | null
  onClearScope?: () => void
  /** Total thread count for the current folder (server-side). */
  total?: number | null
  /** True when more pages exist beyond the loaded threads. */
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
  /** When set, the header shows a compose button (new outbound email). */
  onCompose?: () => void
  emptyLabel?: string
  emptyHint?: ReactNode
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
  scopeLabel = null,
  onClearScope,
  total = null,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onCompose,
  emptyLabel,
  emptyHint,
}: Props) {
  const { t } = useTranslation('communication')
  const counts = buildFilterCounts(allThreads)
  const selectionActive = (bulkSelectedIds?.size ?? 0) > 0
  const { members } = useMembers()
  const memberNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of members) map.set(String(m.id), m.name || m.email)
    return map
  }, [members])

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col border-r border-border/60 bg-bg-surface"
    >
      {selectionActive && onBulkAction && onClearBulkSelection ? (
        <BulkActionsBar
          count={bulkSelectedIds?.size ?? 0}
          busy={bulkBusy}
          onAction={onBulkAction}
          onClear={onClearBulkSelection}
        />
      ) : (
        <ThreadListQuickFilters
          value={quickFilter}
          onChange={onQuickFilterChange}
          counts={counts}
          onCompose={onCompose}
        />
      )}

      {scopeLabel && onClearScope ? (
        <div className="flex items-center gap-1.5 border-b border-border/40 bg-accent/5 px-3 py-1.5">
          <Filter size={11} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-text-heading">
            {scopeLabel}
          </span>
          <button
            type="button"
            aria-label={t('threadList.clearScope')}
            onClick={onClearScope}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
          >
            <X size={11} />
          </button>
        </div>
      ) : null}

      {activeTag && onTagSelect ? (
        <div className="flex items-center gap-1.5 border-b border-border/40 bg-accent/5 px-3 py-1.5">
          <Tag size={11} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-text-heading">
            {activeTag}
          </span>
          <button
            type="button"
            aria-label={t('threadList.clearLabelFilter')}
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
            <div className="py-8 text-center text-xs text-text-muted">{t('threadList.loading')}</div>
          ) : error ? (
            <div className="py-4 px-3 text-xs text-status-error">{error}</div>
          ) : (
            <div className="px-3 py-8 text-center text-xs text-text-muted">
              <p>
                {quickFilter === 'unread'
                  ? t('threadList.emptyUnread')
                  : quickFilter === 'pinned'
                    ? t('threadList.emptyPinned')
                    : emptyLabel ?? t('threadList.empty')}
              </p>
              {quickFilter !== 'all' ? (
                <button
                  type="button"
                  onClick={() => onQuickFilterChange('all')}
                  className="mt-2 text-[11px] font-medium text-accent hover:underline"
                >
                  {t('threadList.showAllConversations')}
                </button>
              ) : (
                emptyHint
              )}
            </div>
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
              assigneeName={
                thread.assignedToUserId != null
                  ? memberNames.get(String(thread.assignedToUserId)) ?? null
                  : null
              }
            />
          ))
        )}
        {hasMore && onLoadMore && threads.length > 0 ? (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="mt-1 w-full rounded-md border border-border/60 bg-bg-surface px-3 py-2 text-[11.5px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-60"
          >
            {loadingMore
              ? t('threadList.loadingMore')
              : total != null
                ? t('threadList.loadMoreOf', { loaded: allThreads.length, total })
                : t('threadList.loadMore')}
          </button>
        ) : null}
        {!hasMore && total != null && total > 0 && threads.length > 0 && allThreads.length >= total ? (
          <div className="py-2 text-center text-[10.5px] text-text-muted/70">
            {t('threadList.allLoaded', { total })}
          </div>
        ) : null}
      </div>
    </div>
  )
}
