import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Filter, X } from 'lucide-react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type { InboxListQuickFilter } from '../../context/InboxCommunicationContext'
import type { BulkThreadAction, InboxMember, InboxThread, ThreadId } from '../../lib/inbox-api'
import { listScrollStorageKey } from '../../lib/inbox-ops'
import { readInboxDensity, writeInboxDensity } from '../../lib/inbox-prefs'
import { cn } from '../../lib/utils'
import { useMembers } from '../../hooks/useMembers'
import { useTeams } from '../../hooks/useTeams'
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
  /** Communication folder queue so bulk actions hide no-ops (e.g. Close in Closed). */
  listQueue?: string | null
  scrollKey?: string
  assigneeFilter?: number | null
  onAssigneeFilter?: (id: number | null) => void
  priorityFilter?: string | null
  onPriorityFilter?: (value: string | null) => void
  /** Visible scope when the list is filtered by project. */
  scopeLabel?: string | null
  onClearScope?: () => void
  /** Extra strip under the filters (for example bulk decision actions). */
  banner?: ReactNode
  /** Total thread count for the current folder (server-side). */
  total?: number | null
  /** True when more pages exist beyond the loaded threads. */
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
  emptyLabel?: string
  emptyHint?: ReactNode
  onRetry?: () => void
  lastMailboxSyncAt?: string | null
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
  listQueue = null,
  scrollKey,
  assigneeFilter = null,
  onAssigneeFilter,
  priorityFilter = null,
  onPriorityFilter,
  scopeLabel = null,
  onClearScope,
  banner = null,
  total = null,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  emptyLabel,
  emptyHint,
  onRetry,
  lastMailboxSyncAt,
}: Props) {
  const { t } = useTranslation('communication')
  const { t: tn } = useTranslation('nav')
  const [density, setDensity] = useState(readInboxDensity)
  const counts = buildFilterCounts(allThreads)
  const selectionActive = (bulkSelectedIds?.size ?? 0) > 0
  // Compact rows expand meta on hover; during bulk select that shifts every
  // checkbox target. Force the open layout for the whole list while selecting.
  const compactRows = density === 'compact' && !selectionActive
  const toggleDensity = () => {
    const next = density === 'compact' ? 'comfortable' : 'compact'
    setDensity(next)
    writeInboxDensity(next)
  }
  const { members } = useMembers()
  const { teams } = useTeams()
  const memberNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of members) map.set(String(m.id), m.name || m.email)
    return map
  }, [members])
  const memberPresence = useMemo(() => {
    const map = new Map<string, InboxMember['presence']>()
    for (const m of members) map.set(String(m.id), m.presence)
    return map
  }, [members])
  const teamsById = useMemo(() => {
    const map = new Map(teams.map((team) => [team.id, team]))
    return map
  }, [teams])
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const scrollTopRef = useRef(0)
  const restoredRef = useRef(false)
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
    (index: number, thread: InboxThread) => {
      const owner = thread.owner
      let assigneeName: string | null = null
      let assigneePresence: InboxMember['presence'] | import('../../lib/teams-api').PresenceStatus | undefined
      let assigneeKind: 'user' | 'agent' | 'team' | null = null
      let assigneeSeed: string | null = null
      let assigneeEmail: string | null = null
      let assigneeAvatarUrl: string | null = null
      let assigneeAvatarKind: string | null = null
      let assigneeAvatarIcon: string | null = null
      let assigneeAvatarColor: string | null = null
      let assigneeAvatarImageUrl: string | null = null

      if (thread.assignedToUserId != null) {
        const member = members.find((m) => m.id === thread.assignedToUserId)
        assigneeKind = 'user'
        assigneeName = member?.name ?? memberNames.get(String(thread.assignedToUserId)) ?? null
        assigneePresence = memberPresence.get(String(thread.assignedToUserId))
        assigneeEmail = member?.email ?? null
        assigneeAvatarUrl = member?.avatarUrl ?? null
      } else if (owner?.kind === 'team' && owner.teamId) {
        const team = teamsById.get(owner.teamId)
        if (team) {
          assigneeKind = 'team'
          assigneeName = team.system ? tn(`teamPage.system.${team.kind}`) : team.name
          assigneePresence = team.presence?.status
          assigneeSeed = team.id
          assigneeAvatarKind = team.avatar_kind ?? null
          assigneeAvatarIcon = team.avatar_icon ?? null
          assigneeAvatarColor = team.avatar_color ?? null
          assigneeAvatarImageUrl = team.avatar_image_url ?? null
        }
      } else if (owner?.kind === 'agent' && (thread.agentName || owner.agentId)) {
        assigneeKind = 'agent'
        assigneeName = thread.agentName ?? null
        assigneeSeed = owner.agentId
      }

      return (
      <div className={cn(compactRows ? 'pb-0' : 'pb-0.5')}>
        <ThreadListItem
          thread={thread}
          isSelected={String(thread.id) === String(selectedId)}
          onSelect={onSelectThread}
          onMarkRead={onMarkRead}
          onMarkUnread={onMarkUnread}
          onTogglePin={onTogglePin}
          onClose={onClose}
          onDelete={onDelete}
          deleting={String(deletingThreadId) === String(thread.id)}
          variant={variant}
          checked={bulkSelectedIds?.has(String(thread.id))}
          onToggleChecked={onToggleBulkSelect}
          selectionActive={selectionActive}
          assigneeName={assigneeName}
          assigneePresence={assigneePresence}
          assigneeKind={assigneeKind}
          assigneeSeed={assigneeSeed}
          assigneeEmail={assigneeEmail}
          assigneeAvatarUrl={assigneeAvatarUrl}
          assigneeAvatarKind={assigneeAvatarKind}
          assigneeAvatarIcon={assigneeAvatarIcon}
          assigneeAvatarColor={assigneeAvatarColor}
          assigneeAvatarImageUrl={assigneeAvatarImageUrl}
          compact={compactRows}
          enterIndex={index}
        />
      </div>
      )
    },
    [
      compactRows,
      selectedId,
      onSelectThread,
      onMarkRead,
      onMarkUnread,
      onTogglePin,
      onClose,
      onDelete,
      deletingThreadId,
      variant,
      bulkSelectedIds,
      onToggleBulkSelect,
      selectionActive,
      members,
      memberNames,
      memberPresence,
      teamsById,
      tn,
    ],
  )

  const footer = useCallback(() => {
    if (!hasMore || !onLoadMore || threads.length === 0) return null
    return (
      <button
        type="button"
        onClick={onLoadMore}
        disabled={loadingMore}
        className="mt-1 mb-1 w-full rounded-md border border-border/60 bg-bg-surface px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-60"
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
          listQueue={listQueue}
          quickFilter={quickFilter}
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
        />
      )}

      {scopeLabel && onClearScope ? (
        <div className="flex items-center gap-1.5 border-b border-border/40 bg-accent/5 px-3 py-1.5">
          <Filter size={11} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate-fade text-xs font-medium text-text-heading">
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

      {banner}

      <div className="flex min-h-0 flex-1 flex-col p-1.5">
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
                  className="mt-2 text-xs font-medium text-accent hover:underline"
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
                  : quickFilter === 'pinned'
                    ? t('threadList.emptyPinned')
                    : emptyLabel ?? t('threadList.empty')}
              </p>
              {quickFilter !== 'all' ? (
                <div className="mt-2 flex flex-col items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onQuickFilterChange('all')}
                    className="text-xs font-medium text-accent hover:underline"
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
