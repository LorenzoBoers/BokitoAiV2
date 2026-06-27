import { Mail } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { inboxPath, leafFromPath, leafKey, leafPath, type HubLeaf, type InboxQueue } from '../lib/messages-paths'
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
  type MessageAttachment,
  type PatchThreadInput,
  type ThreadFilters,
  type ThreadId,
} from '../lib/inbox-api'

type View = NonNullable<ThreadFilters['view']>

const INBOX_QUEUE_TO_VIEW: Record<InboxQueue, View> = {
  all: 'all',
  mine: 'mine',
  open: 'all_open',
  unassigned: 'unassigned',
  closed: 'closed',
}

const RUNS_QUEUE_TO_VIEW: Record<string, View> = {
  all: 'internal',
  updates: 'updates',
  results: 'results',
  'awaiting-decision': 'awaiting_decision',
}

type LeafConfig = {
  filters: Omit<ThreadFilters, 'search' | 'projectId'>
  mode: 'customer' | 'agent'
  variant: 'customer' | 'direct'
}

/** Map the active sidebar leaf to thread filters and rendering mode. */
function configForLeaf(leaf: HubLeaf): LeafConfig {
  switch (leaf.type) {
    case 'inbox':
      return {
        filters: { folder: 'inbox', view: INBOX_QUEUE_TO_VIEW[leaf.queue] },
        mode: 'customer',
        variant: 'customer',
      }
    case 'runs':
      return {
        filters: { folder: 'internal', view: RUNS_QUEUE_TO_VIEW[leaf.queue] ?? 'internal' },
        mode: 'agent',
        variant: 'customer',
      }
    case 'channel': {
      if (leaf.channelKey === 'email') {
        return {
          filters: {
            folder: 'external',
            view: 'all',
            connectionId: leaf.connectionId ? Number(leaf.connectionId) : undefined,
          },
          mode: 'customer',
          variant: 'customer',
        }
      }
      if (leaf.channelKey === 'agent') {
        return { filters: { folder: 'internal', view: 'internal' }, mode: 'agent', variant: 'customer' }
      }
      const channel =
        leaf.channelKey === 'webchat' ? 'widget' : leaf.channelKey === 'internal' ? 'internal' : leaf.channelKey
      return {
        filters: { view: 'all', channel },
        mode: leaf.channelKey === 'internal' ? 'agent' : 'customer',
        variant: 'customer',
      }
    }
    case 'view':
      return { filters: { folder: 'inbox', view: 'all', tag: leaf.key }, mode: 'customer', variant: 'customer' }
    case 'label':
      return { filters: { folder: 'inbox', view: 'all', tag: leaf.key }, mode: 'customer', variant: 'customer' }
    default:
      // assistant/agent chats are handled by DirectCommunication
      return { filters: { folder: 'inbox', view: 'all' }, mode: 'customer', variant: 'customer' }
  }
}

function threadFitsInboxQueue(thread: InboxThread, queue: InboxQueue, userId: number | null): boolean {
  switch (queue) {
    case 'all':
      return true
    case 'mine':
      return thread.status === 'open' && thread.assignedToUserId === userId
    case 'open':
      return thread.status === 'open'
    case 'unassigned':
      return thread.status === 'open' && thread.assignedToUserId == null
    case 'closed':
      return thread.status === 'closed'
    default:
      return true
  }
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

/**
 * Thread-list surface of the Communication hub: renders whichever leaf is
 * active in the sidebar (inbox queue, agent runs, channel, view or label)
 * as thread list + conversation + context panel.
 */
export default function Communication() {
  const { t } = useTranslation('communication')
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const { threadId: threadIdParam } = useParams<{ threadId?: string }>()
  const navigate = useNavigate()
  const { user, token } = useAuth()
  const { refresh: refreshNavBadges } = useNavBadges()
  const currentUserId = user?.id ?? null

  const leaf = useMemo<HubLeaf>(
    () => leafFromPath(location.pathname) ?? { type: 'inbox', queue: 'all' },
    [location.pathname],
  )
  const { filters: leafFilters, mode, variant } = useMemo(() => configForLeaf(leaf), [leaf])

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
  } = useThreads({ ...leafFilters, search, projectId }, pinnedIds)

  const listContextKey = `${leafKey(leaf)}:${projectId ?? ''}`

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
    toggleTakeover,
  } = useThreadDetail(selectedThreadId, pinnedIds)

  useEffect(() => {
    if (detail?.thread && !detail.thread.hasUnread) {
      void refreshNavBadges()
    }
  }, [detail?.thread?.id, detail?.thread?.hasUnread, refreshNavBadges])

  const handleSelectThread = useCallback(
    (id: ThreadId, replace = false) => {
      setThreadReadState(id, false)
      navigate(`${leafPath(leaf, String(id))}${inboxQuery}`, replace ? { replace: true } : undefined)
      void refreshNavBadges()
    },
    [leaf, navigate, setThreadReadState, refreshNavBadges, inboxQuery],
  )

  const firstThreadId = filteredThreads[0]?.id ?? null

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

  const handleToggleTakeover = useCallback(async () => {
    if (selectedThreadId == null || !detail) return
    try {
      await toggleTakeover(Boolean(detail.thread.aiPaused))
    } catch {
      // Optimistic state is reverted inside the hook; surface nothing here.
    }
  }, [selectedThreadId, detail, toggleTakeover])

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
          navigate(`${leafPath(leaf)}${inboxQuery}`)
        }
        void refreshNavBadges()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Delete failed.')
      } finally {
        setDeletingThreadId(null)
      }
    },
    [token, removeThread, pinnedIds, removePin, selectedThreadId, leaf, navigate, refreshNavBadges, inboxQuery],
  )

  const handleDetailDelete = useCallback(async () => {
    if (selectedThreadId == null) return
    await handleDeleteThread(selectedThreadId, detail?.thread.emailSubject)
  }, [selectedThreadId, detail?.thread.emailSubject, handleDeleteThread])

  // When a thread's status changes so it no longer fits the active inbox
  // queue (e.g. closed while viewing Open), hop to the All queue.
  const redirectCheckedForThreadRef = useRef<ThreadId | null>(null)
  useEffect(() => {
    if (selectedThreadId == null) {
      redirectCheckedForThreadRef.current = null
      return
    }
    if (leaf.type !== 'inbox') return
    if (!detail) return
    if (String(detail.thread.id) !== String(selectedThreadId)) return
    if (redirectCheckedForThreadRef.current === selectedThreadId) return

    redirectCheckedForThreadRef.current = selectedThreadId

    if (threadFitsInboxQueue(detail.thread, leaf.queue, currentUserId)) return
    navigate(`${inboxPath('all', String(detail.thread.id))}${inboxQuery}`, { replace: true })
  }, [detail, selectedThreadId, leaf, currentUserId, navigate, inboxQuery])

  const handlePatch = useCallback(
    async (input: PatchThreadInput) => {
      await patch(input)
      void refreshThreads()
      void refreshNavBadges()
    },
    [patch, refreshThreads, refreshNavBadges],
  )

  const handleReply = useCallback(
    async (
      bodyText: string,
      action: 'send' | 'send_and_close' | 'send_and_pending',
      format?: 'email' | 'plain',
      attachments?: MessageAttachment[],
    ) => {
      await reply({ bodyText, action, format, attachments })
      void refreshThreads()
    },
    [reply, refreshThreads],
  )

  const handleNote = useCallback(
    async (bodyText: string, attachments?: MessageAttachment[]) => {
      await addNote(bodyText, attachments)
      void refreshThreads()
    },
    [addNote, refreshThreads],
  )

  const handleDecisionResolved = useCallback(() => {
    void refreshDetail()
    void refreshThreads()
    void refreshNavBadges()
  }, [refreshDetail, refreshThreads, refreshNavBadges])

  const handleThreadUpdated = handleDecisionResolved

  // "Ask assistant": open a fresh assistant chat pre-filled with this
  // thread's context so the user can reason about it with their AI.
  const handleAskAssistant = useCallback(() => {
    if (!detail) return
    const subject = detail.thread.emailSubject || detail.thread.contactName || 'this thread'
    const prefill = `Help me with the thread "${subject}" (thread id ${detail.thread.id}). Summarize what happened and suggest the next step.`
    navigate(`/communication/new?prefill=${encodeURIComponent(prefill)}`)
  }, [detail, navigate])

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

  const showEmptyMailboxState =
    (leaf.type === 'inbox' || (leaf.type === 'channel' && leaf.channelKey === 'email')) &&
    enabledConnections.length === 0 &&
    threadsReady &&
    threads.length === 0

  if (showEmptyMailboxState) {
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
          to="/settings/channels"
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
          variant={variant}
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
          onToggleTakeover={detail ? handleToggleTakeover : undefined}
          onDelete={detail ? handleDetailDelete : undefined}
          deleting={String(deletingThreadId) === String(selectedThreadId)}
          onToggleContact={detail ? toggleContactPanel : undefined}
          contactOpen={showContactPanel}
          onDecisionResolved={handleDecisionResolved}
          mode={mode}
          onAskAssistant={detail ? handleAskAssistant : undefined}
        />
        {detail && showContactPanel ? (
          <AgentThreadPanel thread={detail.thread} onClose={toggleContactPanel} onThreadUpdated={handleThreadUpdated} />
        ) : null}
      </div>
    </div>
  )
}
