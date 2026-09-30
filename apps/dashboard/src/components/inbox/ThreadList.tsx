import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Filter, X } from 'lucide-react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type { InboxListQuickFilter } from '../../context/InboxCommunicationContext'
import type { BulkThreadAction, InboxThread, ThreadId } from '../../lib/inbox-api'
import { listScrollStorageKey } from '../../lib/inbox-ops'
import { readInboxDensity, writeInboxDensity } from '../../lib/inbox-prefs'
import { threadNeedsReply } from '../../lib/message-composer'
import { cn } from '../../lib/utils'
import { useMembers } from '../../hooks/useMembers'
import { channelKind } from '../ui/ChannelGlyph'
import { InboxListSkeleton } from '../ui/skeleton'
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
  onSnooze?: (id: ThreadId) => void
  onClose?: (id: ThreadId) => void
  onDelete: (id: ThreadId) => void
  deletingThreadId?: ThreadId | null
  variant?: 'customer' | 'direct'
  /** Bulk selection: omit to hide checkboxes (e.g. direct/assistant lists). */
  bulkSelectedIds?: ReadonlySet<string>
  onToggleBulkSelect?: (id: ThreadId, shiftKey?: boolean) => void
  onSelectAll?: () => void
  onMarkAllRead?: () => void
  onBulkAction?: (action: BulkThreadAction, assigneeId?: number) => void
  onBulkPin?: (nextPinned: boolean) => void
  onClearBulkSelection?: () => void
  bulkBusy?: boolean
  scrollKey?: string
  assigneeFilter?: number | null
  onAssigneeFilter?: (id: number | null) => void
  priorityFilter?: string | null
  onPriorityFilter?: (value: string | null) => void
  channelFilter?: string | null
  onChannelFilter?: (value: string | null) => void
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
  onRetry?: () => void
  lastMailboxSyncAt?: string | null
}

function buildFilterCounts(threads: InboxThread[]) {
  return {
    all: threads.length,
    unread: threads.filter((t) => t.hasUnread).length,
    needsReply: threads.filter((t) => threadNeedsReply(t)).length,
    needsDecision: threads.filter((t) => t.hasOpenDecision).length,
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
  onSnooze,
  onClose,
  onDelete,
  deletingThreadId = null,
  variant = 'customer',
  bulkSelectedIds,
  onToggleBulkSelect,
  onSelectAll,
  onMarkAllRead,
  onBulkAction,
  onBulkPin,
  onClearBulkSelection,
  bulkBusy = false,
  scrollKey,
  assigneeFilter = null,
  onAssigneeFilter,
  priorityFilter = null,
  onPriorityFilter,
  channelFilter = null,
  onChannelFilter,
  scopeLabel = null,
  onClearScope,
  total = null,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onCompose,
  emptyLabel,
  emptyHint,
  onRetry,
  lastMailboxSyncAt,
}: Props) {
  const { t } = useTranslation('communication')
  const [density, setDensity] = useState(readInboxDensity)
  const counts = buildFilterCounts(allThreads)
  const selectionActive = (bulkSelectedIds?.size ?? 0) > 0
  const toggleDensity = () => {
    const next = density === 'compact' ? 'comfortable' : 'compact'
    setDensity(next)
    writeInboxDensity(next)
  }
  const { members } = useMembers()
  const memberNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of members) map.set(String(m.id), m.name || m.email)
    return map
  }, [members])
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const scrollTopRef = useRef(0)
  const restoredRef = useRef(false)
  const channelOptions = useMemo(() => {
    // One option per display kind; prefer the canonical channel string when present
    // so filters match stored Signal.channel values (widget vs customer_widget).
    const byKind = new Map<string, string>()
    for (const thread of allThreads) {
      if (!thread.channel) continue
      const kind = channelKind(thread.channel)
      const current = byKind.get(kind)
      if (!current || (current !== kind && thread.channel === kind)) {
        byKind.set(kind, thread.channel)
      }
    }
    return [...byKind.values()].sort()
  }, [allThreads])

  useEffect(() => {
    restoredRef.current = false
    if (!scrollKey) return
    const key = listScrollStorageKey(scrollKey)
    try {
      const saved = sessionStorage.getItem(key)
      scrollTopRef.current = Number(saved) || 0
    } catch {
      scrollTopRef.current = 0
    }
  }, [scrollKey])

  const handleRangeChanged = useCallback(() => {
    if (!scrollKey) return
    const key = listScrollStorageKey(scrollKey)
    try {
      sessionStorage.setItem(key, String(scrollTopRef.current))
    } catch {
      // ignore
    }
  }, [scrollKey])

  const renderItem = useCallback(
    (index: number, thread: InboxThread) => (
      <div className={cn(density === 'compact' ? 'pb-0' : 'pb-0.5')}>
        <ThreadListItem
          thread={thread}
          isSelected={String(thread.id) === String(selectedId)}
          onSelect={onSelectThread}
          onMarkRead={onMarkRead}
          onMarkUnread={onMarkUnread}
          onTogglePin={onTogglePin}
          onSnooze={onSnooze}
          onClose={onClose}
          onDelete={onDelete}
          deleting={String(deletingThreadId) === String(thread.id)}
          variant={variant}
          checked={bulkSelectedIds?.has(String(thread.id))}
          onToggleChecked={onToggleBulkSelect}
          selectionActive={selectionActive}
          assigneeName={
            thread.assignedToUserId != null
              ? memberNames.get(String(thread.assignedToUserId)) ?? null
              : null
          }
          compact={density === 'compact'}
          enterIndex={index}
        />
      </div>
    ),
    [
      density,
      selectedId,
      onSelectThread,
      onMarkRead,
      onMarkUnread,
      onTogglePin,
      onSnooze,
      onClose,
      onDelete,
      deletingThreadId,
      variant,
      bulkSelectedIds,
      onToggleBulkSelect,
      selectionActive,
      memberNames,
    ],
  )

  const footer = useCallback(() => {
    if (!hasMore || !onLoadMore || threads.length === 0) return null
    return (
      <button
        type="button"
        onClick={onLoadMore}
        disabled={loadingMore}
        className="mt-1 mb-1 w-full rounded-md border border-border/60 bg-bg-surface px-3 py-2 text-[11.5px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-60"
      >
        {loadingMore ? (
          <span className="inline-flex items-center justify-center gap-2">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border border-border border-t-accent" />
            {t('threadList.loadingMore')}
          </span>
        ) : total != null ? (
          t('threadList.loadMoreOf', { loaded: allThreads.length, total })
        ) : (
          t('threadList.loadMore')
        )}
      </button>
    )
  }, [hasMore, onLoadMore, threads.length, loadingMore, t, total, allThreads.length])

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col border-r border-border/60 bg-bg-surface"
    >
      {selectionActive && onBulkAction && onClearBulkSelection ? (
        <BulkActionsBar
          count={bulkSelectedIds?.size ?? 0}
          busy={bulkBusy}
          onAction={onBulkAction}
          onPin={onBulkPin}
          onClear={onClearBulkSelection}
          onSelectAll={onSelectAll}
        />
      ) : (
        <ThreadListQuickFilters
          value={quickFilter}
          onChange={onQuickFilterChange}
          counts={counts}
          countsArePartial={Boolean(hasMore)}
          onCompose={onCompose}
          density={density}
          onToggleDensity={toggleDensity}
          onSelectAll={onSelectAll}
          onMarkAllRead={onMarkAllRead}
          unreadCount={counts.unread}
          lastMailboxSyncAt={lastMailboxSyncAt}
          assigneeFilter={variant === 'customer' ? assigneeFilter : undefined}
          onAssigneeFilter={variant === 'customer' ? onAssigneeFilter : undefined}
          members={members}
          priorityFilter={variant === 'customer' ? priorityFilter : undefined}
          onPriorityFilter={variant === 'customer' ? onPriorityFilter : undefined}
          channelFilter={variant === 'customer' ? channelFilter : undefined}
          onChannelFilter={variant === 'customer' ? onChannelFilter : undefined}
          channelOptions={channelOptions}
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

      <div
        title={
          !hasMore && total != null && total > 0 && threads.length > 0 && allThreads.length >= total
            ? t('threadList.allLoaded', { total })
            : undefined
        }
        className="flex min-h-0 flex-1 flex-col p-1.5"
      >
        {threads.length === 0 ? (
          loading ? (
            <InboxListSkeleton />
          ) : error ? (
            <div className="px-3 py-4 text-center">
              <p className="text-xs text-status-error">{error}</p>
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-2 text-[11px] font-medium text-accent hover:underline"
                >
                  {t('onboarding.retry')}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="px-3 py-8 text-center text-xs text-text-muted">
              <p>
                {quickFilter === 'unread'
                  ? t('threadList.emptyUnread')
                  : quickFilter === 'needsReply'
                    ? t('threadList.emptyNeedsReply')
                    : quickFilter === 'pinned'
                      ? t('threadList.emptyPinned')
                      : emptyLabel ?? t('threadList.empty')}
              </p>
              {quickFilter !== 'all' ? (
                <div className="mt-2 flex flex-col items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onQuickFilterChange('all')}
                    className="text-[11px] font-medium text-accent hover:underline"
                  >
                    {t('threadList.showAllConversations')}
                  </button>
                </div>
              ) : (
                emptyHint
              )}
            </div>
          )
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            className="h-full"
            data={threads}
            computeItemKey={(_index, thread) => String(thread.id)}
            itemContent={renderItem}
            endReached={() => {
              if (hasMore && onLoadMore && !loadingMore) onLoadMore()
            }}
            increaseViewportBy={200}
            components={{ Footer: footer }}
            scrollerRef={(ref) => {
              if (ref && !restoredRef.current && scrollTopRef.current > 0) {
                restoredRef.current = true
                const el = ref as HTMLElement
                requestAnimationFrame(() => {
                  el.scrollTop = scrollTopRef.current
                })
              }
            }}
            onScroll={(e) => {
              scrollTopRef.current = (e.target as HTMLElement).scrollTop
              handleRangeChanged()
            }}
          />
        )}
      </div>
    </div>
  )
}
