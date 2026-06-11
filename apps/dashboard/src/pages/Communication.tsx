import { Mail } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import ThreadList from '../components/inbox/ThreadList'
import ThreadDetail from '../components/inbox/ThreadDetail'
import AgentThreadPanel from '../components/inbox/AgentThreadPanel'
import { useAuth } from '../context/AuthContext'
import { useNavBadges } from '../context/NavBadgeContext'
import {
  useInboxCommunication,
  type InboxListQuickFilter,
} from '../context/InboxCommunicationContext'
import { useMailboxConnections } from '../hooks/useMailboxConnections'
import { useThreads } from '../hooks/useThreads'
import { useThreadDetail } from '../hooks/useThreadDetail'
import { usePinnedIds } from '../hooks/usePinnedIds'
import {
  markThreadRead as apiMarkThreadRead,
  markThreadUnread as apiMarkThreadUnread,
  pinThread as apiPinThread,
  unpinThread as apiUnpinThread,
  deleteThread as apiDeleteThread,
  type InboxThread,
  type PatchThreadInput,
  type ThreadFilters,
  type ThreadId,
} from '../lib/inbox-api'

type View = NonNullable<ThreadFilters['view']>

const QUEUE_TO_VIEW: Record<string, View> = {
  all: 'all_open',
  all_open: 'all_open',
  my: 'mine',
  mine: 'mine',
  unassigned: 'unassigned',
  pending: 'pending',
  closed: 'closed',
  spam: 'spam',
  out: 'outbound',
  outbound: 'outbound',
  pinned: 'pinned',
  created: 'mine',
  'awaiting-decision': 'awaiting_decision',
  awaiting_decision: 'awaiting_decision',
  updates: 'updates',
  results: 'results',
}

const VIEW_TO_QUEUE: Record<View, string> = {
  all_open: 'all',
  mine: 'my',
  unassigned: 'unassigned',
  pending: 'pending',
  closed: 'closed',
  spam: 'spam',
  outbound: 'out',
  pinned: 'pinned',
  awaiting_decision: 'awaiting-decision',
  updates: 'updates',
  results: 'results',
  external: 'all',
  internal: 'all',
}

const INTERNAL_ONLY_VIEWS: View[] = ['awaiting_decision', 'updates', 'results']

function isThreadInQueue(thread: InboxThread, view: View, userId: number | null): boolean {
  switch (view) {
    case 'all_open':
      return thread.status === 'open'
    case 'mine':
      return thread.status === 'open' && thread.assignedToUserId === userId
    case 'unassigned':
      return thread.status === 'open' && thread.assignedToUserId == null
    case 'pending':
      return thread.status === 'pending'
    case 'closed':
      return thread.status === 'closed'
    case 'spam':
      return thread.status === 'spam'
    case 'outbound':
      return true
    case 'pinned':
      return thread.isPinned
    case 'awaiting_decision':
    case 'updates':
    case 'results':
    case 'external':
    case 'internal':
      return true
    default:
      return true
  }
}

function getCanonicalView(thread: InboxThread): View {
  if (thread.status === 'closed') return 'closed'
  if (thread.status === 'spam') return 'spam'
  if (thread.status === 'pending') return 'pending'
  return 'all_open'
}

function applyQuickFilter(threads: InboxThread[], quickFilter: InboxListQuickFilter): InboxThread[] {
  switch (quickFilter) {
    case 'unread':
      return threads.filter((t) => t.hasUnread)
    case 'pinned':
      return threads.filter((t) => t.isPinned)
    default:
      return threads
  }
}

export default function Communication() {
  const { t } = useTranslation('communication')
  const [searchParams] = useSearchParams()
  const { queue, channelId, threadId: threadIdParam } = useParams<{
    queue: string
    channelId?: string
    threadId?: string
  }>()
  const navigate = useNavigate()
  const { user, token } = useAuth()
  const { refresh: refreshNavBadges } = useNavBadges()
  const currentUserId = user?.id ?? null

  const projectId = searchParams.get('project_id')?.trim() || undefined

  const inboxQuery = useMemo(() => {
    const params = new URLSearchParams()
    if (projectId) params.set('project_id', projectId)
    const query = params.toString()
    return query ? `?${query}` : ''
  }, [projectId])

  useEffect(() => {
    void refreshNavBadges()
  }, [refreshNavBadges])

  const view: View = (queue ? QUEUE_TO_VIEW[queue] : undefined) ?? 'all_open'
  const connectionId = channelId ? Number(channelId) : undefined
  const selectedThreadId: ThreadId | null = threadIdParam ?? null

  const { search, setSearch, quickFilter, setQuickFilter, resetQuickFilter } = useInboxCommunication()
  const [deletingThreadId, setDeletingThreadId] = useState<ThreadId | null>(null)
  const [showContactPanel, setShowContactPanel] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    const stored = window.localStorage.getItem('inbox.contactPanel.open')
    return stored === null ? true : stored === '1'
  })

  const toggleContactPanel = useCallback(() => {
    setShowContactPanel((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem('inbox.contactPanel.open', next ? '1' : '0')
      } catch {
        // ignore storage failures (private mode etc.)
      }
      return next
    })
  }, [])

  const {
    connections,
    loading: connectionsLoading,
    error: connectionsError,
    needsOrganisation,
  } = useMailboxConnections()

  const enabledConnections = connections.filter(
    (c) => c.status !== 'revoked' && c.isEnabled !== false,
  )

  const { pinnedIds, addPin, removePin } = usePinnedIds()

  const {
    threads,
    loading: threadsLoading,
    threadsReady,
    error: threadsError,
    refresh: refreshThreads,
    setThreadReadState,
    removeThread,
  } = useThreads({ view, search, connectionId, projectId }, pinnedIds)

  const listContextKey = `${channelId ?? 'all'}:${queue ?? 'all'}:${projectId ?? ''}`

  useEffect(() => {
    setSearch('')
    resetQuickFilter()
  }, [listContextKey, setSearch, resetQuickFilter])

  const filteredThreads = useMemo(
    () => applyQuickFilter(threads, quickFilter),
    [threads, quickFilter],
  )

  const {
    detail,
    loading: detailLoading,
    error: detailError,
    saving,
    refresh: refreshDetail,
    patch,
    reply,
    addNote,
    togglePin,
  } = useThreadDetail(selectedThreadId, pinnedIds)

  useEffect(() => {
    if (detail?.thread && !detail.thread.hasUnread) {
      void refreshNavBadges()
    }
  }, [detail?.thread?.id, detail?.thread?.hasUnread, refreshNavBadges])

  const handleSelectThread = useCallback(
    (id: ThreadId, replace = false) => {
      setThreadReadState(id, false)
      const base = channelId
        ? `/messages/ch/${channelId}/${queue ?? 'all'}`
        : `/messages/${queue ?? 'all'}`
      navigate(`${base}/t/${encodeURIComponent(String(id))}${inboxQuery}`, replace ? { replace: true } : undefined)
      void refreshNavBadges()
    },
    [channelId, queue, navigate, setThreadReadState, refreshNavBadges, inboxQuery],
  )

  const firstThreadInView =
    filteredThreads.find((t) => isThreadInQueue(t, view, currentUserId)) ?? null
  const firstThreadId = firstThreadInView?.id ?? null

  useEffect(() => {
    if (threadIdParam || !threadsReady || firstThreadId == null) return
    handleSelectThread(firstThreadId, true)
  }, [threadIdParam, threadsReady, firstThreadId, listContextKey, handleSelectThread])

  const handleListMarkRead = useCallback(
    async (id: ThreadId) => {
      if (!token) return
      setThreadReadState(id, false)
      try {
        await apiMarkThreadRead(token, id)
        void refreshNavBadges()
      } catch {
        setThreadReadState(id, true)
      }
    },
    [token, setThreadReadState, refreshNavBadges],
  )

  const handleListMarkUnread = useCallback(
    async (id: ThreadId) => {
      if (!token) return
      setThreadReadState(id, true)
      try {
        await apiMarkThreadUnread(token, id)
        void refreshNavBadges()
      } catch {
        setThreadReadState(id, false)
      }
    },
    [token, setThreadReadState, refreshNavBadges],
  )

  const handleListTogglePin = useCallback(
    async (id: ThreadId, currentPinned: boolean) => {
      if (!token) return
      const next = !currentPinned
      if (next) addPin(id)
      else removePin(id)
      try {
        if (next) {
          await apiPinThread(token, id)
        } else {
          await apiUnpinThread(token, id)
        }
      } catch {
        if (next) removePin(id)
        else addPin(id)
      }
    },
    [token, addPin, removePin],
  )

  const handleDetailTogglePin = useCallback(async () => {
    if (selectedThreadId == null || !detail) return
    const current = detail.thread.isPinned
    const next = !current
    if (next) addPin(selectedThreadId)
    else removePin(selectedThreadId)
    try {
      await togglePin(current)
    } catch {
      if (next) removePin(selectedThreadId)
      else addPin(selectedThreadId)
    }
  }, [selectedThreadId, detail, togglePin, addPin, removePin])

  const handleDeleteThread = useCallback(
    async (id: ThreadId, subject?: string) => {
      if (!token) return
      const label = subject?.trim() || `thread #${id}`
      if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) {
        return
      }

      setDeletingThreadId(id)
      try {
        await apiDeleteThread(token, id)
        removeThread(id)
        if (pinnedIds.some((pinnedId) => String(pinnedId) === String(id))) removePin(id)
        if (String(selectedThreadId) === String(id)) {
          const base = channelId
            ? `/messages/ch/${channelId}/${queue ?? 'all'}`
            : `/messages/${queue ?? 'all'}`
          navigate(`${base}${inboxQuery}`)
        }
        void refreshNavBadges()
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Delete failed.')
      } finally {
        setDeletingThreadId(null)
      }
    },
    [token, removeThread, pinnedIds, removePin, selectedThreadId, channelId, queue, navigate, refreshNavBadges, inboxQuery],
  )

  const handleDetailDelete = useCallback(async () => {
    if (selectedThreadId == null) return
    await handleDeleteThread(selectedThreadId, detail?.thread.emailSubject)
  }, [selectedThreadId, detail?.thread.emailSubject, handleDeleteThread])

  const redirectCheckedForThreadRef = useRef<ThreadId | null>(null)
  useEffect(() => {
    if (selectedThreadId == null) {
      redirectCheckedForThreadRef.current = null
      return
    }
    if (!detail) return
    if (String(detail.thread.id) !== String(selectedThreadId)) return
    if (redirectCheckedForThreadRef.current === selectedThreadId) return
    if (INTERNAL_ONLY_VIEWS.includes(view)) return

    redirectCheckedForThreadRef.current = selectedThreadId

    const thread = detail.thread
    const fits = isThreadInQueue(thread, view, currentUserId)
    const channelMatches = !connectionId || connectionId === thread.emailConnectionId
    if (fits && channelMatches) return
    const canonical = getCanonicalView(thread)
    const targetQueueSegment = VIEW_TO_QUEUE[canonical]
    const targetChannelId = channelMatches ? channelId : null
    const base = targetChannelId
      ? `/messages/ch/${targetChannelId}/${targetQueueSegment}`
      : `/messages/${targetQueueSegment}`
    navigate(`${base}/t/${encodeURIComponent(String(thread.id))}${inboxQuery}`, { replace: true })
  }, [detail, selectedThreadId, view, channelId, connectionId, currentUserId, navigate, inboxQuery])

  const handlePatch = useCallback(
    async (input: PatchThreadInput) => {
      await patch(input)
      void refreshThreads()
      void refreshNavBadges()
    },
    [patch, refreshThreads, refreshNavBadges],
  )

  const handleReply = useCallback(
    async (bodyText: string, action: 'send' | 'send_and_close' | 'send_and_pending') => {
      await reply({ bodyText, action })
      void refreshThreads()
    },
    [reply, refreshThreads],
  )

  const handleNote = useCallback(
    async (bodyText: string) => {
      await addNote(bodyText)
      void refreshThreads()
    },
    [addNote, refreshThreads],
  )

  const handleDecisionResolved = useCallback(() => {
    void refreshDetail()
    void refreshThreads()
    void refreshNavBadges()
  }, [refreshDetail, refreshThreads, refreshNavBadges])

  if (connectionsLoading) {
    return <div className="h-full py-6 text-sm text-text-muted">{t('loadingMailboxes')}</div>
  }

  if (connectionsError) {
    return <div className="h-full py-6 text-sm text-status-error">{connectionsError}</div>
  }

  if (needsOrganisation) {
    return (
      <div className="h-full py-6 text-sm text-text-muted max-w-md">
        {t('missingOrganisation')}
      </div>
    )
  }

  if (enabledConnections.length === 0 && threadsReady && threads.length === 0) {
    return (
      <div className="h-full min-h-0 flex flex-col items-center justify-center py-8 px-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center mb-4">
          <Mail size={28} className="text-accent" />
        </div>
        <h2 className="text-lg font-semibold text-text-heading">{t('noActiveMailboxTitle')}</h2>
        <p className="text-sm text-text-secondary mt-2 max-w-sm">
          {t('noActiveMailboxDescription')}
        </p>
        <Link
          to="/settings/inbox"
          className="mt-5 text-sm font-medium text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-sm"
        >
          {t('openEmailSettings')}
        </Link>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ThreadList
          threads={filteredThreads}
          allThreads={threads}
          loading={threadsLoading}
          error={threadsError}
          selectedId={selectedThreadId}
          quickFilter={quickFilter}
          onQuickFilterChange={setQuickFilter}
          onSelectThread={handleSelectThread}
          onMarkRead={handleListMarkRead}
          onMarkUnread={handleListMarkUnread}
          onTogglePin={handleListTogglePin}
          onDelete={(id) => void handleDeleteThread(id, threads.find((t) => t.id === id)?.emailSubject)}
          deletingThreadId={deletingThreadId}
        />
        <ThreadDetail
          detail={detail}
          loading={detailLoading}
          error={detailError}
          saving={saving}
          threadId={selectedThreadId}
          onPatch={handlePatch}
          onReply={handleReply}
          onNote={handleNote}
          onRefresh={refreshDetail}
          onTogglePin={handleDetailTogglePin}
          onDelete={detail ? handleDetailDelete : undefined}
          deleting={String(deletingThreadId) === String(selectedThreadId)}
          onToggleContact={detail ? toggleContactPanel : undefined}
          contactOpen={showContactPanel}
          onDecisionResolved={handleDecisionResolved}
        />
        {detail && showContactPanel ? (
          <AgentThreadPanel thread={detail.thread} onClose={toggleContactPanel} />
        ) : null}
      </div>
    </div>
  )
}
