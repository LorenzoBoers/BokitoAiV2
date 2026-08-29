import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Filter, Tag, X } from 'lucide-react'
import type { InboxListQuickFilter } from '../../context/InboxCommunicationContext'
import type { BulkThreadAction, InboxThread, ThreadId } from '../../lib/inbox-api'
import { listScrollStorageKey } from '../../lib/inbox-ops'
import { readInboxDensity, writeInboxDensity } from '../../lib/inbox-prefs'
import { agentRunsPath } from '../../lib/messages-paths'
import { threadNeedsReply } from '../../lib/message-composer'
import { cn } from '../../lib/utils'
import { useMembers } from '../../hooks/useMembers'
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
  /** Tag folder this list belongs to (`/communication/tag/{tag}`), if any. */
  activeTag?: string | null
  /** Open a tag's folder; omit to make tag chips non-interactive. */
  onTagOpen?: (tag: string) => void
  /** Leave the tag folder (back to all communication). */
  onLeaveTag?: () => void
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
  activeTag = null,
  onTagOpen,
  onLeaveTag,
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const channelOptions = useMemo(() => {
    const values = new Set<string>()
    for (const thread of allThreads) {
      if (thread.channel) values.add(thread.channel)
    }
    return [...values].sort()
  }, [allThreads])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !scrollKey) return
    const key = listScrollStorageKey(scrollKey)
    try {
      const saved = sessionStorage.getItem(key)
      if (saved) el.scrollTop = Number(saved) || 0
    } catch {
      // ignore
    }
    const onScroll = () => {
      try {
        sessionStorage.setItem(key, String(el.scrollTop))
      } catch {
        // ignore
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [scrollKey])

  useEffect(() => {
    if (!onLoadMore || !hasMore) return
    const node = sentinelRef.current
    const root = scrollRef.current
    if (!node || !root) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingMore) onLoadMore()
      },
      { root, rootMargin: '120px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [onLoadMore, hasMore, loadingMore, threads.length])

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

      {activeTag ? (
        <div className="flex items-center gap-1.5 border-b border-border/40 bg-accent/5 px-3 py-1.5">
          <Tag size={11} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-text-heading">
            {activeTag}
          </span>
          {onLeaveTag ? (
            <button
              type="button"
              aria-label={t('threadList.clearLabelFilter')}
              onClick={onLeaveTag}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
            >
              <X size={11} />
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        title={
          !hasMore && total != null && total > 0 && threads.length > 0 && allThreads.length >= total
            ? t('threadList.allLoaded', { total })
            : undefined
        }
        className={cn('flex-1 overflow-y-auto min-h-0 p-1.5', density === 'compact' ? 'space-y-0' : 'space-y-0.5')}
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
                    : quickFilter === 'needsDecision'
                      ? t('threadList.emptyNeedsDecision')
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
                  {quickFilter === 'needsDecision' ? (
                    <Link
                      to={agentRunsPath('awaiting-decision')}
                      className="text-[11px] font-medium text-ai-ink hover:underline"
                    >
                      {t('threadList.openDecisionsQueue')}
                    </Link>
                  ) : null}
                </div>
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
              onSnooze={onSnooze}
              onDelete={onDelete}
              deleting={String(deletingThreadId) === String(thread.id)}
              variant={variant}
              checked={bulkSelectedIds?.has(String(thread.id))}
              onToggleChecked={onToggleBulkSelect}
              selectionActive={selectionActive}
              onTagClick={onTagOpen}
              activeTag={activeTag}
              assigneeName={
                thread.assignedToUserId != null
                  ? memberNames.get(String(thread.assignedToUserId)) ?? null
                  : null
              }
              compact={density === 'compact'}
            />
          ))
        )}
        {hasMore && onLoadMore && threads.length > 0 ? <div ref={sentinelRef} className="h-4" /> : null}
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
      </div>
    </div>
  )
}
