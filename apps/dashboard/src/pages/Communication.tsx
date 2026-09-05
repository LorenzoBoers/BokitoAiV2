import { Bot, Mail, MessageSquare } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  agentRunsPath,
  decisionsPath,
  inboxPath,
  newConversationPath,
  leafFromPath,
  leafKey,
  leafPath,
  tagPath,
  type HubLeaf,
  type RunsQueue,
  type SubQueue,
} from '../lib/messages-paths'
import {
  configForLeaf,
  mergeHubThreadFilters,
  threadFitsChannelLeaf,
  threadFitsTagLeaf,
} from '../lib/hub-list-filters'
import { SplitPane, SplitRow } from '../components/ui/SplitRow'
import ThreadList from '../components/inbox/ThreadList'
import ThreadDetail from '../components/inbox/ThreadDetail'
import AgentThreadPanel from '../components/inbox/AgentThreadPanel'
import ComposeEmailModal, { type ComposePrefill } from '../components/inbox/ComposeEmailModal'
import InboxShortcutHelp from '../components/inbox/InboxShortcutHelp'
import { composeEmailPath, parseComposeIntent } from '../lib/compose-intent'
import { writeLastInboxQueue } from '../lib/inbox-prefs'
import { nextUnreadId, parseQuickFilterParam, toggleOrRangeSelect } from '../lib/inbox-ops'
import { snoozeUntilIso, SNOOZE_PRESETS, toLocalDateTimeValue } from '../lib/snooze'
import {
  focusInboxReply,
  scrollActiveThreadIntoView,
  useInboxListShortcuts,
} from '../hooks/useInboxListShortcuts'
import {
  dedicatedInboxQueueForStatus,
  pickRemainingInboxThread,
  resolvedStatusLeavesInboxQueue,
  threadFitsInboxQueue,
} from '../lib/inbox-queue'
import {
  customersFirst,
  customersOnly,
  isInternalThread,
  pickPreferredInboxThread,
  threadHubPath,
  threadNeedsReply,
} from '../lib/message-composer'
import { InboxSplitSkeleton } from '../components/ui/skeleton'
import { PageGuideBanner } from '../components/layout/PageGuideBanner'
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
  patchThread as apiPatchThread,
  pinThread as apiPinThread,
  unpinThread as apiUnpinThread,
  deleteThread as apiDeleteThread,
  type BulkThreadAction,
  type InboxThread,
  asMessageAttachments,
  type MessageAttachment,
  type PatchThreadInput,
  type ThreadId,
} from '../lib/inbox-api'
import { bulkUpdateSignalThreads, cancelScheduledMessage } from '../lib/signals-api'
import { listAgents } from '../lib/agents-api'
import { listProjects } from '../lib/projects-api'

/** Soft-undo window for outbound email replies (server caps at 600s). */
const UNDO_SEND_SECONDS = 15

const ACTIVITY_CHIPS: ReadonlyArray<{ queue: RunsQueue; labelKey: string }> = [
  { queue: 'all', labelKey: 'runsChips.all' },
  { queue: 'updates', labelKey: 'runsChips.updates' },
  { queue: 'results', labelKey: 'runsChips.results' },
]

function applyQuickFilter(threads: InboxThread[], quickFilter: InboxListQuickFilter): InboxThread[] {
  switch (quickFilter) {
    case 'unread':
      return threads.filter((t) => t.hasUnread)
    case 'needsReply':
      return threads.filter((t) => threadNeedsReply(t))
    case 'needsDecision':
      return threads.filter((t) => t.hasOpenDecision)
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
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const { threadId: threadIdParam } = useParams<{ threadId?: string }>()
  const navigate = useNavigate()
  const { user, token, logout } = useAuth()
  const { refresh: refreshNavBadges } = useNavBadges()
  const currentUserId = user?.id ?? null

  const leaf = useMemo<HubLeaf>(
    () => leafFromPath(location.pathname) ?? { type: 'inbox', queue: 'all' },
    [location.pathname],
  )

  const { filters: leafFilters, mode, variant } = useMemo(() => configForLeaf(leaf), [leaf])

  const projectId = searchParams.get('project_id')?.trim() || undefined
  const agentIdFilter = searchParams.get('agent')?.trim() || undefined
  const [scopeName, setScopeName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!agentIdFilter && !projectId) {
      setScopeName(null)
      return
    }
    void (async () => {
      try {
        if (agentIdFilter) {
          const rows = await listAgents()
          if (!cancelled) setScopeName(rows.find((row) => row.id === agentIdFilter)?.name ?? null)
          return
        }
        const rows = await listProjects()
        if (!cancelled) setScopeName(rows.find((row) => row.id === projectId)?.name ?? null)
      } catch {
        if (!cancelled) setScopeName(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [agentIdFilter, projectId])

  const scopeLabel = agentIdFilter
    ? t('threadList.scopeAgent', { name: scopeName || t('threadList.scopeAgentFallback') })
    : projectId
      ? t('threadList.scopeProject', { name: scopeName || t('threadList.scopeProjectFallback') })
      : null

  // A tag has exactly one surface: its folder under Tags. Clicking a tag chip
  // in the list navigates there, so the URL, the sidebar, and the list agree.
  const activeTag = leaf.type === 'tag' ? leaf.tag : null

  const openTagFolder = useCallback(
    (tag: string) => {
      navigate(tagPath(tag))
    },
    [navigate],
  )

  const leaveTagFolder = useCallback(() => {
    navigate(inboxPath(leaf.type === 'tag' ? leaf.queue ?? 'open' : 'open'))
  }, [leaf, navigate])

  const clearScope = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    next.delete('agent')
    next.delete('project_id')
    const query = next.toString()
    navigate(`${leafPath(leaf, threadIdParam ?? undefined)}${query ? `?${query}` : ''}`, {
      replace: true,
    })
  }, [leaf, navigate, searchParams, threadIdParam])

  useEffect(() => {
    void refreshNavBadges()
  }, [refreshNavBadges])

  const selectedThreadId: ThreadId | null = threadIdParam ?? null
  const [skipMarkRead, setSkipMarkRead] = useState(false)

  const { search, setSearch, listSearch, quickFilter, setQuickFilter } = useInboxCommunication()
  const inboxQuery = useMemo(() => {
    const params = new URLSearchParams()
    if (projectId) params.set('project_id', projectId)
    if (agentIdFilter) params.set('agent', agentIdFilter)
    if (quickFilter !== 'all') params.set('filter', quickFilter)
    const query = params.toString()
    return query ? `?${query}` : ''
  }, [projectId, agentIdFilter, quickFilter])
  const [deletingThreadId, setDeletingThreadId] = useState<ThreadId | null>(null)
  // Contact context panel: open by default; closing it only lasts for the
  // current browser session (sessionStorage), so it returns on the next visit.
  const [showContactPanel, setShowContactPanel] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    const stored = window.sessionStorage.getItem('inbox.contactPanel.open')
    return stored === null ? true : stored === '1'
  })

  const toggleContactPanel = useCallback(() => {
    setShowContactPanel((prev) => {
      const next = !prev
      try {
        window.sessionStorage.setItem('inbox.contactPanel.open', next ? '1' : '0')
      } catch {
        // ignore storage failures (private mode etc.)
      }
      return next
    })
  }, [])

  const {
    activeConnections,
    setupNeededConnections,
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

  const enabledConnections = activeConnections
  const mailboxNeedsSetup =
    enabledConnections.length === 0 && setupNeededConnections.length > 0

  const { pinnedIds, addPin, removePin } = usePinnedIds()

  const [assigneeFilter, setAssigneeFilter] = useState<number | null>(null)
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null)
  const [channelFilter, setChannelFilter] = useState<string | null>(null)
  const [customSnoozeOpen, setCustomSnoozeOpen] = useState(false)
  const [customSnoozeValue, setCustomSnoozeValue] = useState(toLocalDateTimeValue)
  const lastBulkAnchorId = useRef<string | null>(null)

  const applyQuickFilterChange = useCallback(
    (value: InboxListQuickFilter) => {
      if (value === 'needsDecision') {
        navigate(decisionsPath())
        return
      }
      setQuickFilter(value)
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        if (value === 'all') next.delete('filter')
        else next.set('filter', value)
        return next
      }, { replace: true })
    },
    [navigate, setQuickFilter, setSearchParams],
  )

  const urlFilter = searchParams.get('filter')
  useEffect(() => {
    const fromUrl = parseQuickFilterParam(urlFilter)
    if (fromUrl === 'needsDecision') {
      navigate(decisionsPath(), { replace: true })
      return
    }
    if (fromUrl) setQuickFilter(fromUrl)
  }, [urlFilter, setQuickFilter, navigate])

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
    mergeHubThreadFilters(leaf, leafFilters, {
      search: listSearch,
      projectId,
      agentId: agentIdFilter,
      unread: mode === 'customer' && quickFilter === 'unread',
      needsReply: mode === 'customer' && quickFilter === 'needsReply',
      needsDecision: mode === 'customer' && quickFilter === 'needsDecision',
      pinnedOnly: mode === 'customer' && quickFilter === 'pinned',
      assigneeId: assigneeFilter,
      channelFilter,
    }),
    pinnedIds,
  )

  // Inbox channel chip is leaf-local; clear when leaving inbox so it cannot
  // leak into a later merge if leaf typing regresses.
  useEffect(() => {
    if (leaf.type !== 'inbox') setChannelFilter(null)
  }, [leaf.type])

  // Customer list chips (Needs reply / Unread / …) must not stick on Agent-runs
  // or assistant leaves — they hide runs and show the wrong empty copy.
  useEffect(() => {
    if (mode === 'customer') return
    if (quickFilter === 'all') return
    setQuickFilter('all')
    setSearchParams((prev) => {
      if (!prev.has('filter')) return prev
      const next = new URLSearchParams(prev)
      next.delete('filter')
      return next
    }, { replace: true })
  }, [mode, quickFilter, setQuickFilter, setSearchParams])

  const listContextKey = `${leafKey(leaf)}:${projectId ?? ''}:${agentIdFilter ?? ''}`

  useEffect(() => {
    if (leaf.type === 'inbox' && leaf.queue) writeLastInboxQueue(leaf.queue)
  }, [leaf])

  // Bulk selection lives per list context; switching leaves clears it.
  const [bulkSelectedIds, setBulkSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  useEffect(() => {
    setBulkSelectedIds(new Set())
    lastBulkAnchorId.current = null
  }, [listContextKey])

  const handleClearBulkSelection = useCallback(() => {
    lastBulkAnchorId.current = null
    setBulkSelectedIds(new Set())
  }, [])

  const filteredThreads = useMemo(() => {
    let next = mode === 'customer' ? applyQuickFilter(threads, quickFilter) : threads
    if (priorityFilter) next = next.filter((thread) => thread.priority === priorityFilter)
    if (leaf.type !== 'inbox') return next
    if (leaf.queue === 'open') return customersOnly(next)
    return customersFirst(next)
  }, [threads, quickFilter, priorityFilter, leaf, mode])

  const handleToggleBulkSelect = useCallback(
    (id: ThreadId, shiftKey = false) => {
      const orderedIds = filteredThreads.map((thread) => String(thread.id))
      setBulkSelectedIds((prev) => {
        const result = toggleOrRangeSelect(
          orderedIds,
          prev,
          String(id),
          lastBulkAnchorId.current,
          shiftKey,
        )
        lastBulkAnchorId.current = result.anchor
        return result.next
      })
    },
    [filteredThreads],
  )

  const handleSelectAllLoaded = useCallback(() => {
    const ids = filteredThreads.map((thread) => String(thread.id))
    setBulkSelectedIds(new Set(ids))
    lastBulkAnchorId.current = ids[ids.length - 1] ?? null
  }, [filteredThreads])

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
  } = useThreadDetail(selectedThreadId, pinnedIds, { skipMarkRead })

  useEffect(() => {
    if (!detailError || selectedThreadId == null || detailLoading) return
    const msg = detailError.toLowerCase()
    if (!msg.includes('404') && !msg.includes('not found')) return
    navigate(`${leafPath(leaf)}${inboxQuery}`, { replace: true })
  }, [detailError, selectedThreadId, detailLoading, leaf, inboxQuery, navigate])

  useEffect(() => {
    if (detail?.thread && !detail.thread.hasUnread) {
      void refreshNavBadges()
    }
  }, [detail?.thread?.id, detail?.thread?.hasUnread, refreshNavBadges])

  const handleSelectThread = useCallback(
    (id: ThreadId, replace = false, opts?: { markRead?: boolean }) => {
      if (opts?.markRead !== false) {
        setSkipMarkRead(false)
        setThreadReadState(id, false)
        void refreshNavBadges()
      }
      navigate(`${leafPath(leaf, String(id))}${inboxQuery}`, replace ? { replace: true } : undefined)
      scrollActiveThreadIntoView()
    },
    [leaf, navigate, setThreadReadState, refreshNavBadges, inboxQuery],
  )

  // Legacy ?compose=1 deep-links land on the draft surface (create-on-send).
  // Forward from a thread still uses the compose modal via openCompose().
  const incomingCompose = parseComposeIntent(searchParams)
  useEffect(() => {
    if (!incomingCompose) return
    navigate(
      composeEmailPath({
        to: incomingCompose.to,
        subject: incomingCompose.subject,
        body: incomingCompose.body,
        connectionId: incomingCompose.connectionId,
      }),
      { replace: true },
    )
  }, [incomingCompose, navigate])

  const [composeOpen, setComposeOpen] = useState(false)
  const [composePrefill, setComposePrefill] = useState<ComposePrefill | null>(null)
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false)
  const openCompose = useCallback(() => {
    setComposePrefill(null)
    setComposeOpen(true)
  }, [])

  const handleComposeSent = useCallback(
    (threadId: string) => {
      void refreshThreads()
      if (threadId) navigate(inboxPath('open', threadId))
    },
    [refreshThreads, navigate],
  )

  const firstThreadId = pickPreferredInboxThread(filteredThreads)?.id ?? null

  useEffect(() => {
    if (composeOpen) return
    if (threadIdParam || !threadsReady || firstThreadId == null) return
    setSkipMarkRead(true)
    handleSelectThread(firstThreadId, true, { markRead: false })
  }, [composeOpen, threadIdParam, threadsReady, firstThreadId, listContextKey, handleSelectThread])

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

  const handleMarkAllLoadedRead = useCallback(async () => {
    const unread = filteredThreads.filter((thread) => thread.hasUnread)
    if (!token || unread.length === 0) return
    for (const thread of unread) setThreadReadState(thread.id, false)
    try {
      const updated = await bulkUpdateSignalThreads(
        token,
        unread.map((thread) => String(thread.id)),
        'read',
      )
      toast.success(t('actions.bulkUpdated', { count: updated }))
      void refreshNavBadges()
    } catch (err) {
      void refreshThreads()
      toast.error(err instanceof Error ? err.message : t('actions.bulkFailed'))
    }
  }, [filteredThreads, token, setThreadReadState, refreshNavBadges, refreshThreads, t])

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

  const handleListSnooze = useCallback(
    async (id: ThreadId) => {
      if (!token) return
      const tomorrow = SNOOZE_PRESETS.find((preset) => preset.key === 'tomorrow')
      try {
        await apiPatchThread(token, id, {
          status: 'pending',
          snoozedUntil: tomorrow ? snoozeUntilIso(tomorrow) : null,
        })
        toast.success(t('threadResolved.snoozed'))
        void refreshThreads()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('actions.patchError'))
      }
    },
    [token, refreshThreads, t],
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

  // Set while a resolve action (close/spam/snooze) is leaving the current
  // thread, so the queue-mismatch effect below does not fight the advance.
  const advancingRef = useRef(false)

  const leaveResolvedThread = useCallback(
    (fromId: ThreadId, status?: InboxThread['status']) => {
      const remaining = pickRemainingInboxThread(filteredThreads, fromId)
      if (remaining) {
        handleSelectThread(remaining.id, true)
        requestAnimationFrame(() => {
          focusInboxReply()
        })
      } else {
        navigate(`${leafPath(leaf)}${inboxQuery}`, { replace: true })
      }
      const dedicated = status ? dedicatedInboxQueueForStatus(status) : 'closed'
      if (!(leaf.type === 'inbox' && dedicated != null && leaf.queue === dedicated)) {
        removeThread(fromId)
      }
    },
    [filteredThreads, handleSelectThread, navigate, leaf, inboxQuery, removeThread],
  )

  // When a thread no longer fits the active inbox (closed while on Open),
  // stay on that box and open the first remaining thread — or the empty box.
  const redirectCheckedForThreadRef = useRef<string | null>(null)
  useEffect(() => {
    if (selectedThreadId == null) {
      redirectCheckedForThreadRef.current = null
      return
    }
    if (advancingRef.current) return
    if (!detail) return
    if (String(detail.thread.id) !== String(selectedThreadId)) return
    const leafKeyPart = leaf.type === 'inbox' ? leaf.queue : leaf.type
    const fitKey = `${selectedThreadId}:${detail.thread.status}:${leafKeyPart}`
    if (redirectCheckedForThreadRef.current === fitKey) return

    redirectCheckedForThreadRef.current = fitKey

    if (leaf.type === 'inbox') {
      if (leaf.queue === 'open' && isInternalThread(detail.thread)) {
        navigate(`${agentRunsPath('all', String(detail.thread.id))}${inboxQuery}`, { replace: true })
        return
      }
      const inboxQueue = leaf.queue ?? 'all'
      if (threadFitsInboxQueue(detail.thread, inboxQueue, currentUserId)) return
      if (resolvedStatusLeavesInboxQueue(detail.thread.status, inboxQueue)) {
        const dedicated = dedicatedInboxQueueForStatus(detail.thread.status)
        if (dedicated) {
          navigate(`${inboxPath(dedicated, String(detail.thread.id))}${inboxQuery}`, { replace: true })
          return
        }
        advancingRef.current = true
        try {
          leaveResolvedThread(selectedThreadId, detail.thread.status)
        } finally {
          advancingRef.current = false
        }
        return
      }
      const destQueue =
        detail.thread.status === 'open' && !isInternalThread(detail.thread) ? 'open' : 'all'
      navigate(`${inboxPath(destQueue, String(detail.thread.id))}${inboxQuery}`, { replace: true })
      return
    }

    // Channel / tag leaves: wrong-scope deep links hop to the thread's hub home.
    if (leaf.type === 'channel' && !threadFitsChannelLeaf(detail.thread, leaf)) {
      navigate(`${threadHubPath(detail.thread)}${inboxQuery}`, { replace: true })
      return
    }
    if (leaf.type === 'tag' && !threadFitsTagLeaf(detail.thread, leaf)) {
      navigate(`${threadHubPath(detail.thread)}${inboxQuery}`, { replace: true })
      return
    }

    if (
      (detail.thread.status === 'closed' || detail.thread.status === 'spam') &&
      !filteredThreads.some((thread) => String(thread.id) === String(selectedThreadId))
    ) {
      advancingRef.current = true
      try {
        leaveResolvedThread(selectedThreadId, detail.thread.status)
      } finally {
        advancingRef.current = false
      }
    }
  }, [
    detail,
    selectedThreadId,
    leaf,
    currentUserId,
    navigate,
    inboxQuery,
    filteredThreads,
    leaveResolvedThread,
  ])

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
          const undoReopen = () => {
            if (!token) return
            void apiPatchThread(token, fromId, { status: 'open' }).then(() => {
              navigate(`${leafPath(leaf, String(fromId))}${inboxQuery}`)
              void refreshThreads()
              void refreshNavBadges()
            })
          }
          if (input.status === 'closed') {
            toast.success(t('threadResolved.closed'), {
              action: { label: t('undoSend.undo'), onClick: undoReopen },
            })
          } else if (input.status === 'spam') {
            toast.success(t('threadResolved.spam'), {
              action: { label: t('undoSend.undo'), onClick: undoReopen },
            })
          } else {
            toast.success(t('threadResolved.snoozed'), {
              action: { label: t('undoSend.undo'), onClick: undoReopen },
            })
          }
          leaveResolvedThread(fromId, input.status)
        }
      } finally {
        advancingRef.current = false
      }
    },
    [
      patch,
      refreshThreads,
      refreshNavBadges,
      selectedThreadId,
      leaveResolvedThread,
      t,
      token,
      navigate,
      leaf,
      inboxQuery,
    ],
  )

  useInboxListShortcuts({
    dialogOpen: composeOpen,
    helpOpen: shortcutHelpOpen,
    onCloseHelp: () => setShortcutHelpOpen(false),
    onOpenHelp: () => setShortcutHelpOpen(true),
    selectedThreadId,
    threadIds: filteredThreads.map((thread) => thread.id),
    onSelect: handleSelectThread,
    onEscapeList: () => {
      if (selectedThreadId != null) navigate(`${leafPath(leaf)}${inboxQuery}`)
    },
    onClose: () => {
      void handlePatch({ status: 'closed' })
    },
    onUnread: () => {
      if (selectedThreadId != null) void handleListMarkUnread(selectedThreadId)
    },
    onMarkRead: () => {
      if (selectedThreadId != null) void handleListMarkRead(selectedThreadId)
    },
    onJumpUnread: (direction) => {
      const next = nextUnreadId(filteredThreads, selectedThreadId, direction)
      if (next != null) handleSelectThread(next)
    },
    onSelectAll: mode === 'customer' ? handleSelectAllLoaded : undefined,
    onAssign: () => {
      if (!currentUserId) return
      const current =
        filteredThreads.find((thread) => String(thread.id) === String(selectedThreadId)) ??
        detail?.thread
      if (current?.assignedToUserId === currentUserId) {
        void handlePatch({ assignedToUserId: 0 })
      } else {
        void handlePatch({ assignedToUserId: currentUserId })
      }
    },
    onAssignPicker: () => {
      document.getElementById('inbox-assignee-trigger')?.click()
    },
    onPin: () => {
      const current = filteredThreads.find((thread) => String(thread.id) === String(selectedThreadId))
      if (selectedThreadId != null && current) {
        void handleListTogglePin(selectedThreadId, current.isPinned)
      }
    },
    onReply: () => {
      const status = detail?.thread.status
      if (status === 'closed' || status === 'spam') {
        void handlePatch({ status: 'open' }).then(() => {
          window.setTimeout(() => {
            if (!focusInboxReply()) toast.message(t('shortcuts.replyBlocked'))
          }, 80)
        })
        return
      }
      if (!focusInboxReply()) toast.message(t('shortcuts.replyBlocked'))
    },
    onCompose: mode === 'customer' ? openCompose : undefined,
    onNewChat: mode === 'customer' ? () => navigate(newConversationPath()) : undefined,
    onSnooze: () => {
      void handlePatch({ status: 'pending', snoozedUntil: snoozeUntilIso(SNOOZE_PRESETS[0]) })
    },
    onSnoozeCustom: () => {
      setCustomSnoozeValue(toLocalDateTimeValue())
      setCustomSnoozeOpen(true)
    },
    onToggleSelect: () => {
      if (selectedThreadId != null) handleToggleBulkSelect(selectedThreadId)
    },
    onCopyLink: () => {
      const current =
        filteredThreads.find((thread) => String(thread.id) === String(selectedThreadId)) ??
        detail?.thread
      if (!current) return
      void navigator.clipboard.writeText(`${window.location.origin}${threadHubPath(current)}`).then(
        () => toast.success(t('threadChrome.linkCopied')),
        () => toast.error(t('threadChrome.copyLink')),
      )
    },
    onCopyId: () => {
      if (selectedThreadId == null) return
      void navigator.clipboard.writeText(String(selectedThreadId)).then(
        () => toast.success(t('threadChrome.threadIdCopied')),
        () => toast.error(t('threadChrome.copyThreadId')),
      )
    },
    onDigitFilter: (digit) => {
      if (digit === 5) {
        navigate(decisionsPath())
        return
      }
      const next =
        digit === 1
          ? 'all'
          : digit === 2
            ? 'needsReply'
            : digit === 3
              ? 'unread'
              : 'pinned'
      applyQuickFilterChange(next)
    },
  })

  const handleBulkAction = useCallback(
    async (action: BulkThreadAction, assigneeId?: number) => {
      if (!token || bulkSelectedIds.size === 0) return
      setBulkBusy(true)
      try {
        const tomorrow = SNOOZE_PRESETS.find((preset) => preset.key === 'tomorrow')
        const updated = await bulkUpdateSignalThreads(
          token,
          [...bulkSelectedIds],
          action,
          assigneeId,
          action === 'snooze'
            ? { snoozedUntil: tomorrow ? snoozeUntilIso(tomorrow) : null }
            : undefined,
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

  const handleBulkPin = useCallback(
    async (nextPinned: boolean) => {
      if (!token || bulkSelectedIds.size === 0) return
      setBulkBusy(true)
      try {
        await Promise.all(
          [...bulkSelectedIds].map((id) => (nextPinned ? apiPinThread(token, id) : apiUnpinThread(token, id))),
        )
        toast.success(t('actions.bulkUpdated', { count: bulkSelectedIds.size }))
        setBulkSelectedIds(new Set())
        void refreshThreads()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('actions.bulkFailed'))
      } finally {
        setBulkBusy(false)
      }
    },
    [token, bulkSelectedIds, refreshThreads, t],
  )

  const handleReply = useCallback(
    async (
      bodyText: string,
      action: 'send' | 'send_and_close' | 'send_and_pending',
      format?: 'email' | 'plain',
      attachments?: MessageAttachment[],
      snoozeMinutes?: number,
      extras?: { cc?: string; bcc?: string; channelAccountId?: string },
    ) => {
      // Email replies get a short soft-undo window: the backend schedules
      // delivery and the toast can cancel before the scheduler sends it.
      // Chat/widget/internal stay instant.
      const undoable = detail?.thread.channel === 'email'
      const resolving = action === 'send_and_close' || action === 'send_and_pending'
      const fromId = selectedThreadId
      if (resolving) advancingRef.current = true
      try {
        const msg = await reply({
          bodyText,
          action,
          format,
          attachments,
          snoozeMinutes,
          cc: extras?.cc,
          bcc: extras?.bcc,
          channelAccountId: extras?.channelAccountId,
          sendAfterSeconds: undoable ? UNDO_SEND_SECONDS : undefined,
        })
        void refreshThreads()
        void refreshDetail()
        if (resolving && fromId != null) {
          if (!undoable) {
            toast.success(
              action === 'send_and_close' ? t('threadResolved.closed') : t('threadResolved.snoozed'),
            )
          }
          leaveResolvedThread(fromId, action === 'send_and_pending' ? 'pending' : 'closed')
        }
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
        if (detail && !detail.thread.aiPaused) {
          try {
            await toggleTakeover(false)
          } catch {
            // Reply already left; takeover is best-effort so AI stops drafting.
          }
        }
      } finally {
        if (resolving) advancingRef.current = false
      }
    },
    [
      reply,
      refreshThreads,
      detail,
      token,
      t,
      refreshDetail,
      selectedThreadId,
      leaveResolvedThread,
      toggleTakeover,
    ],
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
      .find((m) => m.direction !== 'internal' && (m.bodyText || m.bodyPreview || m.bodyHtml))
    const quoted = (source?.bodyText || source?.bodyPreview || '')
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')
    const header = source
      ? t('compose.forwardedHeader', {
          from: source.fromAddress || t('compose.unknownSender'),
          subject: subjectRaw || t('compose.noSubject'),
        })
      : ''
    setComposePrefill({
      subject,
      body: header || quoted ? `\n\n${header}${quoted}` : '',
      attachments: asMessageAttachments(source?.attachments ?? null),
    })
    setComposeOpen(true)
  }, [detail, t])

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

  const handleDecisionResolved = useCallback(
    (info?: { closed?: boolean }) => {
      if (info?.closed && selectedThreadId != null) {
        advancingRef.current = true
        try {
          leaveResolvedThread(selectedThreadId, 'closed')
        } finally {
          advancingRef.current = false
        }
      }
      void refreshDetail()
      void refreshThreads()
      void refreshNavBadges()
    },
    [leaveResolvedThread, refreshDetail, refreshNavBadges, refreshThreads, selectedThreadId],
  )

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
    return <InboxSplitSkeleton />
  }

  if (connectionsError) {
    return (
      <div className="flex h-full flex-col items-start justify-center gap-3 px-4 py-8">
        <p className="text-sm text-status-error">{connectionsError}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover/60"
        >
          {t('onboarding.retry')}
        </button>
      </div>
    )
  }

  if (needsOrganisation) {
    return (
      <div className="flex h-full max-w-md flex-col items-start justify-center gap-3 px-4 py-8">
        <p className="text-sm text-text-muted">{t('missingOrganisation')}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover/60"
          >
            {t('onboarding.retry')}
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover/60"
          >
            {t('signOut')}
          </button>
        </div>
      </div>
    )
  }

  const isInboxEmpty =
    (leaf.type === 'inbox' || (leaf.type === 'channel' && leaf.channelKey === 'email')) &&
    threadsReady &&
    threads.length === 0 &&
    // An active search, a list chip, or an open thread is not a first-run empty.
    // Needs reply / Unread can empty the list and must not swap in the setup checklist.
    search.trim().length === 0 &&
    quickFilter === 'all' &&
    selectedThreadId == null

  if (isInboxEmpty) {
    if (onboardingStatus && !onboardingStatus.completed && !onboardingDismissed) {
      return (
        <div className="h-full min-h-0 overflow-y-auto">
          <OnboardingChecklist
            status={onboardingStatus}
            onDismiss={dismissOnboarding}
            onStatusRefresh={retryOnboarding}
          />
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
          {enabledConnections.length === 0 ? (
            <Link
              to="/settings/channels"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3.5 py-2 text-sm font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
            >
              <Mail size={14} />
              {t('openEmailSettings')}
            </Link>
          ) : (
            <button
              type="button"
              onClick={openCompose}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3.5 py-2 text-sm font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
            >
              <Mail size={14} />
              {t('threadList.compose')}
            </button>
          )}
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
      {!(onboardingStatus && !onboardingStatus.completed && !onboardingDismissed) ? (
      <PageGuideBanner
        page="communication"
        variant={leaf.type === 'runs' ? 'runs' : leaf.type === 'decisions' ? 'decisions' : undefined}
        className="mx-3 mt-3 shrink-0 md:hidden"
      />
      ) : null}
      {showActivityChips ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/40 px-3 py-2">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
            {t('runsChips.heading')}
          </span>
          <span className="mr-2 hidden text-[11px] font-normal normal-case tracking-normal text-text-muted sm:inline">
            {t('runsChips.subtitle')}
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
      <SplitRow
        storageKey="bokito.split.inbox"
        minFlex={360}
        resetHint={t('split.resetHint')}
        className="min-h-0 flex-1"
      >
        <SplitPane
          id="list"
          defaultWidth={288}
          minWidth={220}
          maxWidth={520}
          label={t('split.list')}
          className={selectedThreadId != null ? 'hidden md:flex' : 'flex'}
        >
          <ThreadList
            threads={filteredThreads}
            allThreads={threads}
            loading={!threadsReady}
            lastMailboxSyncAt={
              enabledConnections.length === 0
                ? undefined
                : enabledConnections.reduce<string | null>((latest, row) => {
                    if (!row.lastSyncAt) return latest
                    if (!latest || row.lastSyncAt > latest) return row.lastSyncAt
                    return latest
                  }, null)
            }
            error={threadsError}
            onRetry={() => void refreshThreads()}
            selectedId={selectedThreadId}
            quickFilter={quickFilter}
            onQuickFilterChange={applyQuickFilterChange}
            onSelectThread={handleSelectThread}
            onMarkRead={handleListMarkRead}
            onMarkUnread={handleListMarkUnread}
            onTogglePin={handleListTogglePin}
            onSnooze={mode === 'customer' ? handleListSnooze : undefined}
            onDelete={(id) => void handleDeleteThread(id, threads.find((t) => t.id === id)?.emailSubject)}
            deletingThreadId={deletingThreadId}
            variant={variant}
            bulkSelectedIds={mode === 'customer' ? bulkSelectedIds : undefined}
            onToggleBulkSelect={mode === 'customer' ? handleToggleBulkSelect : undefined}
            onSelectAll={mode === 'customer' ? handleSelectAllLoaded : undefined}
            onMarkAllRead={mode === 'customer' ? () => void handleMarkAllLoadedRead() : undefined}
            onBulkAction={mode === 'customer' ? (a, uid) => void handleBulkAction(a, uid) : undefined}
            onBulkPin={mode === 'customer' ? (next) => void handleBulkPin(next) : undefined}
            onClearBulkSelection={mode === 'customer' ? handleClearBulkSelection : undefined}
            bulkBusy={bulkBusy}
            scrollKey={leafKey(leaf)}
            assigneeFilter={assigneeFilter}
            onAssigneeFilter={setAssigneeFilter}
            priorityFilter={priorityFilter}
            onPriorityFilter={setPriorityFilter}
            channelFilter={leaf.type === 'inbox' ? channelFilter : undefined}
            onChannelFilter={leaf.type === 'inbox' ? setChannelFilter : undefined}
            activeTag={activeTag}
            onTagOpen={mode === 'customer' ? openTagFolder : undefined}
            onLeaveTag={activeTag ? leaveTagFolder : undefined}
            scopeLabel={scopeLabel}
            onClearScope={agentIdFilter || projectId ? clearScope : undefined}
            total={threadsTotal}
            hasMore={threadsHaveMore}
            loadingMore={threadsLoadingMore}
            onLoadMore={() => void loadMoreThreads()}
            onCompose={mode === 'customer' && enabledConnections.length > 0 ? openCompose : undefined}
            emptyLabel={
              search.trim()
                ? t('threadList.emptySearch', { query: search.trim() })
                : agentIdFilter || projectId
                ? t('threadList.emptyScoped')
                : leaf.type === 'decisions'
                  ? t('threadList.emptyDecisions')
                  : leaf.type === 'runs'
                  ? t('threadList.emptyRuns')
                  : leaf.type === 'inbox' && leaf.queue === 'snoozed'
                    ? t('threadList.emptySnoozed')
                    : undefined
            }
            emptyHint={
              search.trim() ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="mt-2 text-[11px] font-medium text-accent hover:underline"
                >
                  {t('inboxSearchClear')}
                </button>
              ) : agentIdFilter || projectId ? (
                <button
                  type="button"
                  onClick={clearScope}
                  className="mt-2 text-[11px] font-medium text-accent hover:underline"
                >
                  {t('threadList.clearScope')}
                </button>
              ) : leaf.type === 'inbox' && leaf.queue === 'snoozed' ? (
                <div className="mt-2 flex flex-col items-center gap-2">
                  <p className="text-[11px] text-text-muted">{t('threadList.emptySnoozedHint')}</p>
                  <Link
                    to={inboxPath('open')}
                    className="rounded-md border border-border/60 px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
                  >
                    {t('threadList.openInbox')}
                  </Link>
                </div>
              ) : leaf.type === 'decisions' ? (
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                  <p className="w-full text-[11px] text-text-muted">{t('threadList.emptyDecisionsHint')}</p>
                  <Link
                    to={inboxPath('open')}
                    className="rounded-md border border-border/60 px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
                  >
                    {t('threadList.openInbox')}
                  </Link>
                  <Link
                    to="/agents"
                    className="rounded-md border border-border/60 px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
                  >
                    {t('threadList.openAgents')}
                  </Link>
                </div>
              ) : leaf.type === 'runs' ? (
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                  <Link
                    to="/agents"
                    className="rounded-md border border-border/60 px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
                  >
                    {t('threadList.openAgents')}
                  </Link>
                  <Link
                    to="/agenda"
                    className="rounded-md border border-border/60 px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
                  >
                    {t('threadList.openAgenda')}
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
        </SplitPane>
        <SplitPane id="main" defaultWidth={0} minWidth={0} maxWidth={0} flex>
          <ThreadDetail
            detail={detail}
            loading={detailLoading}
            error={detailError === 'THREAD_LOAD_FAILED' ? t('threadChrome.loadError') : detailError}
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
            canSendEmail={enabledConnections.length > 0}
            mailboxNeedsSetup={mailboxNeedsSetup}
            onForward={
              detail && detail.thread.channel === 'email' && enabledConnections.length > 0
                ? handleForward
                : undefined
            }
          />
        </SplitPane>
        {/* Must be a direct SplitPane child: SplitRow ignores anything else
            (a wrapping fragment would silently drop the whole pane). */}
        {detail && showContactPanel ? (
          <SplitPane
            id="context"
            defaultWidth={288}
            minWidth={240}
            maxWidth={420}
            label={t('split.context')}
            className="hidden lg:flex"
            handleClassName="hidden lg:block"
          >
            <AgentThreadPanel
              thread={detail.thread}
              onClose={toggleContactPanel}
              onThreadUpdated={handleThreadUpdated}
            />
          </SplitPane>
        ) : null}
      </SplitRow>
      {/* Mobile/tablet: same context panel as a slide-over. */}
      {detail && showContactPanel ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label={t('split.closeContext')}
            onClick={toggleContactPanel}
          />
          <div className="absolute inset-y-0 right-0 w-[min(100%,20rem)] overflow-y-auto border-l border-border/60 bg-bg-surface shadow-overlay">
            <AgentThreadPanel
              thread={detail.thread}
              onClose={toggleContactPanel}
              onThreadUpdated={handleThreadUpdated}
            />
          </div>
        </div>
      ) : null}
      <ComposeEmailModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onSent={handleComposeSent}
        prefill={composePrefill}
      />
      <InboxShortcutHelp open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />
      {customSnoozeOpen ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-4"
          role="dialog"
          aria-modal="true"
          aria-label={t('snooze.customTitle')}
          onClick={() => setCustomSnoozeOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border/60 bg-bg-surface p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-[13px] font-semibold text-text-heading">{t('snooze.customTitle')}</h2>
            <p className="mt-1 text-[12px] text-text-muted">{t('snooze.customHint')}</p>
            <input
              type="datetime-local"
              value={customSnoozeValue}
              onChange={(event) => setCustomSnoozeValue(event.target.value)}
              className="mt-3 h-9 w-full rounded-md border border-border/60 bg-bg-elevated px-2 text-[13px] text-text-primary"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCustomSnoozeOpen(false)}
                className="rounded-md px-2.5 py-1 text-[12px] text-text-muted hover:bg-bg-hover hover:text-text-primary"
              >
                {t('decisionCard.cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  const wake = new Date(customSnoozeValue)
                  if (Number.isNaN(wake.getTime()) || wake.getTime() <= Date.now()) {
                    toast.error(t('snooze.customInvalid'))
                    return
                  }
                  setCustomSnoozeOpen(false)
                  void handlePatch({ status: 'pending', snoozedUntil: wake.toISOString() })
                }}
                className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-accent-fg"
              >
                {t('snooze.customApply')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
