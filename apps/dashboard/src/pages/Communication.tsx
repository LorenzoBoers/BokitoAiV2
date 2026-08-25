import { Bot, Mail, MessageSquare } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  agentRunsPath,
  inboxPath,
  leafFromPath,
  leafKey,
  leafPath,
  type HubLeaf,
  type InboxQueue,
  type RunsQueue,
} from '../lib/messages-paths'
import ThreadList from '../components/inbox/ThreadList'
import ThreadDetail from '../components/inbox/ThreadDetail'
import AgentThreadPanel from '../components/inbox/AgentThreadPanel'
import ComposeEmailModal, { type ComposePrefill } from '../components/inbox/ComposeEmailModal'
import { isInternalThread } from '../lib/message-composer'
import OnboardingChecklist, { useOnboardingStatus } from '../components/onboarding/OnboardingChecklist'
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
  type BulkThreadAction,
  type InboxThread,
  type MessageAttachment,
  type PatchThreadInput,
  type ThreadFilters,
  type ThreadId,
} from '../lib/inbox-api'
import { bulkUpdateSignalThreads, cancelScheduledMessage } from '../lib/signals-api'

/** Soft-undo window for outbound email replies (server caps at 600s). */
const UNDO_SEND_SECONDS = 15

type View = NonNullable<ThreadFilters['view']>

const INBOX_QUEUE_TO_VIEW: Record<InboxQueue, View> = {
  all: 'all',
  mine: 'mine',
  open: 'all_open',
  unassigned: 'unassigned',
  snoozed: 'snoozed',
  closed: 'closed',
  spam: 'spam',
}

const RUNS_QUEUE_TO_VIEW: Record<string, View> = {
  all: 'internal',
  updates: 'updates',
  results: 'results',
  'awaiting-decision': 'awaiting_decision',
}

const ACTIVITY_CHIPS: ReadonlyArray<{ queue: RunsQueue; labelKey: string }> = [
  { queue: 'all', labelKey: 'runsChips.all' },
  { queue: 'updates', labelKey: 'runsChips.updates' },
  { queue: 'results', labelKey: 'runsChips.results' },
  { queue: 'awaiting-decision', labelKey: 'runsChips.decisions' },
]

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
      // Decisions can sit on email/widget threads as well as internal run
      // threads — do not scope that queue to folder=internal or Cockpit's
      // "Awaiting decision" count will open an empty list.
      if (leaf.queue === 'awaiting-decision') {
        return {
          filters: { view: 'awaiting_decision' },
          mode: 'agent',
          variant: 'customer',
        }
      }
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
    default:
      // assistant/agent chats are handled by DirectCommunication
      return { filters: { folder: 'inbox', view: 'all' }, mode: 'customer', variant: 'customer' }
  }
}

function threadFitsInboxQueue(thread: InboxThread, queue: InboxQueue, userId: number | null): boolean {
  switch (queue) {
    case 'all':
      // Mirrors view=all server-side: closing moves a thread out of "All".
      return thread.status !== 'closed' && thread.status !== 'spam'
    case 'mine':
      return thread.status === 'open' && thread.assignedToUserId === userId
    case 'open':
      return thread.status === 'open'
    case 'unassigned':
      return thread.status === 'open' && thread.assignedToUserId == null
    case 'snoozed':
      return thread.status === 'pending'
    case 'closed':
      return thread.status === 'closed'
    case 'spam':
      return thread.status === 'spam'
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

  useEffect(() => {
    if (leaf.type === 'inbox' && leaf.queue === 'snoozed') {
      navigate(inboxPath('all', threadIdParam) + location.search, { replace: true })
    }
  }, [leaf, navigate, threadIdParam, location.search])

  const { filters: leafFilters, mode, variant } = useMemo(() => configForLeaf(leaf), [leaf])

  const projectId = searchParams.get('project_id')?.trim() || undefined
  const agentIdFilter = searchParams.get('agent')?.trim() || undefined

  const inboxQuery = useMemo(() => {
    const params = new URLSearchParams()
    if (projectId) params.set('project_id', projectId)
    if (agentIdFilter) params.set('agent', agentIdFilter)
    const query = params.toString()
    return query ? `?${query}` : ''
  }, [projectId, agentIdFilter])

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

  const {
    status: onboardingStatus,
    error: onboardingError,
    retry: retryOnboarding,
    dismissed: onboardingDismissed,
    dismiss: dismissOnboarding,
  } = useOnboardingStatus()

  const enabledConnections = connections.filter(
    (c) => c.status !== 'revoked' && c.isEnabled !== false,
  )

  const { pinnedIds, addPin, removePin } = usePinnedIds()

  // Label filter: set by clicking a tag chip in the list, cleared via the
  // filter pill. Server-side (`GET /signals?tag=`).
  const [tagFilter, setTagFilter] = useState<string | null>(null)

  const {
    threads,
    loading: threadsLoading,
    loadingMore: threadsLoadingMore,
    threadsReady,
    error: threadsError,
    total: threadsTotal,
    hasMore: threadsHaveMore,
    loadMore: loadMoreThreads,
    refresh: refreshThreads,
    setThreadReadState,
    removeThread,
  } = useThreads(
    { ...leafFilters, search, projectId, agentId: agentIdFilter, tag: tagFilter ?? undefined },
    pinnedIds,
  )

  const listContextKey = `${leafKey(leaf)}:${projectId ?? ''}:${agentIdFilter ?? ''}`

  useEffect(() => {
    setSearch('')
    resetQuickFilter()
    setTagFilter(null)
  }, [listContextKey, setSearch, resetQuickFilter])

  // Bulk selection lives per list context; switching leaves clears it.
  const [bulkSelectedIds, setBulkSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  useEffect(() => {
    setBulkSelectedIds(new Set())
  }, [listContextKey])

  const handleToggleBulkSelect = useCallback((id: ThreadId) => {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev)
      const key = String(id)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const handleClearBulkSelection = useCallback(() => setBulkSelectedIds(new Set()), [])

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
    updateNote,
    deleteNote,
    markUnread,
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

  // Compose (new outbound email) + forward. Forward pre-fills the compose
  // modal with the quoted thread content; sending creates a new thread.
  const [composeOpen, setComposeOpen] = useState(false)
  const [composePrefill, setComposePrefill] = useState<ComposePrefill | null>(null)
  const openCompose = useCallback(() => {
    setComposePrefill(null)
    setComposeOpen(true)
  }, [])
  const handleComposeSent = useCallback(
    (threadId: string) => {
      void refreshThreads()
      if (threadId) navigate(inboxPath('all', threadId))
    },
    [refreshThreads, navigate],
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
    } catch (err) {
      if (next) removePin(selectedThreadId)
      else addPin(selectedThreadId)
      const raw = err instanceof Error ? err.message : ''
      toast.error(
        raw === 'UNPIN_FAILED'
          ? t('actions.unpinError')
          : raw && raw !== 'PIN_FAILED'
            ? raw
            : t('actions.pinError'),
      )
    }
  }, [selectedThreadId, detail, togglePin, addPin, removePin, t])

  const handleToggleTakeover = useCallback(async () => {
    if (selectedThreadId == null || !detail) return
    try {
      await toggleTakeover(Boolean(detail.thread.aiPaused))
    } catch (err) {
      const raw = err instanceof Error ? err.message : ''
      toast.error(
        raw === 'RESUME_FAILED'
          ? t('actions.resumeError')
          : raw && raw !== 'TAKEOVER_FAILED'
            ? raw
            : t('actions.takeoverError'),
      )
    }
  }, [selectedThreadId, detail, toggleTakeover, t])

  const handleDeleteThread = useCallback(
    async (id: ThreadId, subject?: string) => {
      if (!token) return
      const label = subject?.trim() || t('actions.deleteFallback', { id })
      if (!window.confirm(t('actions.deleteConfirm', { label }))) {
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
        toast.error(err instanceof Error ? err.message : t('actions.deleteFailed'))
      } finally {
        setDeletingThreadId(null)
      }
    },
    [token, removeThread, pinnedIds, removePin, selectedThreadId, leaf, navigate, refreshNavBadges, inboxQuery, t],
  )

  const handleDetailDelete = useCallback(async () => {
    if (selectedThreadId == null) return
    await handleDeleteThread(selectedThreadId, detail?.thread.emailSubject)
  }, [selectedThreadId, detail?.thread.emailSubject, handleDeleteThread])

  // Set while a resolve action (close/spam/snooze) is advancing to the next
  // thread, so the queue-mismatch redirect below does not fight the advance.
  const advancingRef = useRef(false)

  // When a thread's status changes so it no longer fits the active inbox
  // queue (e.g. closed while viewing Open), hop to the All queue.
  const redirectCheckedForThreadRef = useRef<ThreadId | null>(null)
  useEffect(() => {
    if (selectedThreadId == null) {
      redirectCheckedForThreadRef.current = null
      return
    }
    if (advancingRef.current) return
    if (leaf.type !== 'inbox') return
    if (!detail) return
    if (String(detail.thread.id) !== String(selectedThreadId)) return
    if (redirectCheckedForThreadRef.current === selectedThreadId) return

    redirectCheckedForThreadRef.current = selectedThreadId

    if (threadFitsInboxQueue(detail.thread, leaf.queue, currentUserId)) return
    navigate(`${inboxPath('all', String(detail.thread.id))}${inboxQuery}`, { replace: true })
  }, [detail, selectedThreadId, leaf, currentUserId, navigate, inboxQuery])

  // Front/Intercom-style advance: resolving a conversation moves you to the
  // next one in the visible list (or the previous one at the end of the
  // list), instead of staying on a thread that visually barely changed.
  const advanceToNextThread = useCallback(
    (fromId: ThreadId) => {
      const idx = filteredThreads.findIndex((t) => String(t.id) === String(fromId))
      const next =
        idx >= 0
          ? filteredThreads[idx + 1] ?? filteredThreads[idx - 1]
          : filteredThreads.find((t) => String(t.id) !== String(fromId))
      if (next && String(next.id) !== String(fromId)) {
        handleSelectThread(next.id, true)
      } else {
        navigate(`${leafPath(leaf)}${inboxQuery}`, { replace: true })
      }
    },
    [filteredThreads, handleSelectThread, navigate, leaf, inboxQuery],
  )

  const handlePatch = useCallback(
    async (input: PatchThreadInput) => {
      const resolving =
        input.status === 'closed' || input.status === 'spam' || input.status === 'pending'
      const fromId = selectedThreadId
      if (resolving) advancingRef.current = true
      try {
        await patch(input)
        void refreshThreads()
        void refreshNavBadges()
        if (resolving && fromId != null) {
          if (input.status === 'closed') toast.success(t('threadResolved.closed'))
          else if (input.status === 'spam') toast.success(t('threadResolved.spam'))
          else toast.success(t('threadResolved.snoozed'))
          advanceToNextThread(fromId)
          // Evict the row immediately instead of waiting for the refetch or
          // the websocket update; closed/spam never fit the queue they were
          // resolved from (they have dedicated queues).
          if (
            (input.status === 'closed' || input.status === 'spam') &&
            !(leaf.type === 'inbox' && leaf.queue === input.status)
          ) {
            removeThread(fromId)
          }
        }
      } finally {
        advancingRef.current = false
      }
    },
    [patch, refreshThreads, refreshNavBadges, selectedThreadId, advanceToNextThread, removeThread, leaf, t],
  )

  const handleBulkAction = useCallback(
    async (action: BulkThreadAction, assigneeId?: number) => {
      if (!token || bulkSelectedIds.size === 0) return
      setBulkBusy(true)
      try {
        const updated = await bulkUpdateSignalThreads(
          token,
          [...bulkSelectedIds],
          action,
          assigneeId,
        )
        toast.success(t('actions.bulkUpdated', { count: updated }))
        setBulkSelectedIds(new Set())
        void refreshThreads()
        void refreshNavBadges()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('actions.bulkFailed'))
      } finally {
        setBulkBusy(false)
      }
    },
    [token, bulkSelectedIds, refreshThreads, refreshNavBadges, t],
  )

  const handleReply = useCallback(
    async (
      bodyText: string,
      action: 'send' | 'send_and_close' | 'send_and_pending',
      format?: 'email' | 'plain',
      attachments?: MessageAttachment[],
      snoozeMinutes?: number,
      extras?: { cc?: string; bcc?: string },
    ) => {
      // Email replies get a short soft-undo window: the backend schedules
      // delivery and the toast can cancel before the scheduler sends it.
      // Chat/widget/internal stay instant.
      const undoable = detail?.thread.channel === 'email'
      const msg = await reply({
        bodyText,
        action,
        format,
        attachments,
        snoozeMinutes,
        cc: extras?.cc,
        bcc: extras?.bcc,
        sendAfterSeconds: undoable ? UNDO_SEND_SECONDS : undefined,
      })
      void refreshThreads()
      if (undoable && msg?.id && token) {
        const messageId = String(msg.id)
        toast(t('undoSend.scheduled'), {
          duration: UNDO_SEND_SECONDS * 1000,
          action: {
            label: t('undoSend.undo'),
            onClick: () => {
              void cancelScheduledMessage(token, messageId)
                .then(() => {
                  void refreshDetail()
                  void refreshThreads()
                  toast.success(
                    t('undoSend.cancelled'),
                  )
                })
                .catch(() =>
                  toast.error(
                    t('undoSend.tooLate'),
                  ),
                )
            },
          },
        })
      }
    },
    [reply, refreshThreads, detail?.thread.channel, token, t, refreshDetail],
  )

  const handleNote = useCallback(
    async (bodyText: string, attachments?: MessageAttachment[]) => {
      await addNote(bodyText, attachments)
      void refreshThreads()
    },
    [addNote, refreshThreads],
  )

  const handleForward = useCallback(() => {
    if (!detail) return
    const subjectRaw = detail.thread.emailSubject || ''
    const subject = /^fwd:/i.test(subjectRaw) ? subjectRaw : `Fwd: ${subjectRaw}`.trim()
    // Quote the latest real message (skip internal notes and decision cards).
    const source = [...detail.messages]
      .reverse()
      .find((m) => m.direction !== 'internal' && (m.bodyText || m.bodyPreview))
    const quoted = (source?.bodyText || source?.bodyPreview || '')
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')
    const header = source
      ? `---------- Forwarded message ----------\nFrom: ${source.fromAddress || 'unknown'}\nSubject: ${subjectRaw}\n\n`
      : ''
    setComposePrefill({ subject, body: header || quoted ? `\n\n${header}${quoted}` : '' })
    setComposeOpen(true)
  }, [detail])

  const handleUpdateNote = useCallback(
    async (messageId: string, bodyText: string) => {
      await updateNote(messageId, bodyText)
      void refreshThreads()
    },
    [updateNote, refreshThreads],
  )

  const handleDeleteNote = useCallback(
    async (messageId: string) => {
      await deleteNote(messageId)
      void refreshThreads()
    },
    [deleteNote, refreshThreads],
  )

  const handleDetailMarkUnread = useCallback(async () => {
    if (selectedThreadId == null) return
    try {
      await markUnread()
      setThreadReadState(selectedThreadId, true)
      void refreshNavBadges()
      toast.success(t('actions.markedUnread'))
    } catch (err) {
      const raw = err instanceof Error ? err.message : ''
      toast.error(raw && raw !== 'MARK_UNREAD_FAILED' ? raw : t('actions.markUnreadError'))
    }
  }, [selectedThreadId, markUnread, setThreadReadState, refreshNavBadges, t])

  const handleDecisionResolved = useCallback(() => {
    void refreshDetail()
    void refreshThreads()
    void refreshNavBadges()
  }, [refreshDetail, refreshThreads, refreshNavBadges])

  const handleThreadUpdated = handleDecisionResolved

  // "Ask assistant" on internal agent threads opens a fresh standalone chat.
  // External threads use the inline agent session launcher inside ThreadDetail.
  const handleAskAssistant = useCallback(() => {
    if (!detail || !isInternalThread(detail.thread)) return
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

  const isInboxEmpty =
    (leaf.type === 'inbox' || (leaf.type === 'channel' && leaf.channelKey === 'email')) &&
    threadsReady &&
    threads.length === 0 &&
    // An active search with zero hits is "no results", not a first-run empty.
    search.trim().length === 0

  if (isInboxEmpty) {
    if (onboardingStatus && !onboardingStatus.completed && !onboardingDismissed) {
      return (
        <div className="h-full min-h-0 overflow-y-auto">
          <OnboardingChecklist status={onboardingStatus} onDismiss={dismissOnboarding} />
        </div>
      )
    }
    if (onboardingError && !onboardingDismissed) {
      return (
        <div className="h-full min-h-0 flex flex-col items-center justify-center gap-3 py-8 px-4 text-center">
          <p className="text-sm text-status-error">
            {onboardingError === 'LOAD_FAILED' ? t('onboarding.loadError') : onboardingError}
          </p>
          <button
            type="button"
            onClick={retryOnboarding}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover/60"
          >
            {t('onboarding.retry')}
          </button>
        </div>
      )
    }
    if (enabledConnections.length === 0) {
      return (
        <div className="h-full min-h-0 flex flex-col items-center justify-center py-8 px-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center mb-4">
            <Mail size={28} className="text-accent" />
          </div>
          <h2 className="text-lg font-semibold text-text-heading">{t('noActiveMailboxTitle')}</h2>
          <p className="text-sm text-text-secondary mt-2 max-w-sm">
            {t('noActiveMailboxDescription')}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Link
              to="/settings/channels"
              className="rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-accent-fg hover:bg-accent-hover"
            >
              {t('openEmailSettings')}
            </Link>
            <Link
              to="/settings/setup"
              className="rounded-lg border border-border/60 px-3.5 py-2 text-sm font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
            >
              {t('onboarding.openGuide')}
            </Link>
          </div>
        </div>
      )
    }
    return (
      <div className="h-full min-h-0 flex flex-col items-center justify-center py-8 px-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center mb-4">
          <MessageSquare size={28} className="text-accent" />
        </div>
        <h2 className="text-lg font-semibold text-text-heading">{t('onboarding.emptyInboxTitle')}</h2>
        <p className="text-sm text-text-secondary mt-2 max-w-sm">{t('onboarding.emptyInboxBody')}</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Link
            to="/communication/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-accent-fg hover:bg-accent-hover"
          >
            <Bot size={14} />
            {t('onboarding.startChat')}
          </Link>
          <Link
            to="/settings/setup"
            className="rounded-lg border border-border/60 px-3.5 py-2 text-sm font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
          >
            {t('onboarding.openGuide')}
          </Link>
          <Link
            to="/ai/assistant/external/installation"
            className="rounded-lg border border-border/60 px-3.5 py-2 text-sm font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
          >
            {t('onboarding.installWidget')}
          </Link>
        </div>
      </div>
    )
  }

  const runsQueue: RunsQueue = leaf.type === 'runs' ? leaf.queue : 'all'
  const showActivityChips = leaf.type === 'runs' || (leaf.type === 'channel' && leaf.channelKey === 'agent')

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md">
      {showActivityChips ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/40 px-3 py-2">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
            {t('runsChips.heading')}
          </span>
          {ACTIVITY_CHIPS.map((chip) => {
            const active = runsQueue === chip.queue
            return (
              <Link
                key={chip.queue}
                to={agentRunsPath(chip.queue)}
                className={
                  active
                    ? 'rounded-full bg-accent/15 px-2.5 py-0.5 text-[12px] font-medium text-accent'
                    : 'rounded-full bg-bg-hover/60 px-2.5 py-0.5 text-[12px] text-text-secondary hover:text-text-primary'
                }
              >
                {t(chip.labelKey)}
              </Link>
            )
          })}
        </div>
      ) : null}
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
          bulkSelectedIds={mode === 'customer' ? bulkSelectedIds : undefined}
          onToggleBulkSelect={mode === 'customer' ? handleToggleBulkSelect : undefined}
          onBulkAction={mode === 'customer' ? (a, uid) => void handleBulkAction(a, uid) : undefined}
          onClearBulkSelection={mode === 'customer' ? handleClearBulkSelection : undefined}
          bulkBusy={bulkBusy}
          activeTag={tagFilter}
          onTagSelect={mode === 'customer' ? setTagFilter : undefined}
          total={threadsTotal}
          hasMore={threadsHaveMore}
          loadingMore={threadsLoadingMore}
          onLoadMore={() => void loadMoreThreads()}
          onCompose={mode === 'customer' && enabledConnections.length > 0 ? openCompose : undefined}
          emptyLabel={leaf.type === 'runs' ? t('threadList.emptyRuns') : undefined}
          emptyHint={
            leaf.type === 'runs' ? (
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                <Link
                  to="/agents"
                  className="rounded-md border border-border/60 px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
                >
                  {t('threadList.openAgents')}
                </Link>
                <Link
                  to="/communication/new"
                  className="rounded-md border border-border/60 px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
                >
                  {t('onboarding.startChat')}
                </Link>
              </div>
            ) : mode === 'customer' && threads.length === 0 && !threadsLoading ? (
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                <Link
                  to="/settings/setup"
                  className="rounded-md border border-border/60 px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
                >
                  {t('onboarding.openGuide')}
                </Link>
                <Link
                  to="/settings/channels"
                  className="rounded-md border border-border/60 px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
                >
                  {t('threadChrome.openEmailSettings')}
                </Link>
                <Link
                  to="/communication/new"
                  className="rounded-md border border-border/60 px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
                >
                  {t('onboarding.startChat')}
                </Link>
              </div>
            ) : undefined
          }
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
          onUpdateNote={handleUpdateNote}
          onDeleteNote={handleDeleteNote}
          onMarkUnread={detail ? handleDetailMarkUnread : undefined}
          onRefresh={refreshDetail}
          onTogglePin={handleDetailTogglePin}
          onToggleTakeover={detail ? handleToggleTakeover : undefined}
          onDelete={detail ? handleDetailDelete : undefined}
          deleting={String(deletingThreadId) === String(selectedThreadId)}
          onToggleContact={detail ? toggleContactPanel : undefined}
          onBack={() => navigate(`${leafPath(leaf)}${inboxQuery}`)}
          contactOpen={showContactPanel}
          onDecisionResolved={handleDecisionResolved}
          mode={mode}
          onAskAssistant={detail ? handleAskAssistant : undefined}
          onForward={
            detail && detail.thread.channel === 'email' && enabledConnections.length > 0
              ? handleForward
              : undefined
          }
        />
        {detail && showContactPanel ? (
          <AgentThreadPanel thread={detail.thread} onClose={toggleContactPanel} onThreadUpdated={handleThreadUpdated} />
        ) : null}
      </div>
      <ComposeEmailModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onSent={handleComposeSent}
        prefill={composePrefill}
      />
    </div>
  )
}
