import { Mail, MessageSquare, SquarePen } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  forYouPath,
  inboxPath,
  newConversationPath,
  leafFromPath,
  leafKey,
  leafPath,
  type HubLeaf,
  type SubQueue,
} from '../lib/messages-paths'
import {
  configForLeaf,
  mergeHubThreadFilters,
  threadFitsChannelLeaf,
} from '../lib/hub-list-filters'
import { SplitPane, SplitRow } from '../components/ui/SplitRow'
import DecisionGroupsBanner from '../components/inbox/DecisionGroupsBanner'
import ThreadList from '../components/inbox/ThreadList'
import ThreadDetail from '../components/inbox/ThreadDetail'
import AgentThreadPanel from '../components/inbox/AgentThreadPanel'
import { WhatsNextDialog } from '../components/inbox/WhatsNextDialog'
import { useFollowUpPlanner } from '../components/inbox/useFollowUpPlanner'
import ComposeEmailModal, { type ComposePrefill } from '../components/inbox/ComposeEmailModal'
import InboxShortcutHelp from '../components/inbox/InboxShortcutHelp'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { composeEmailPath, parseComposeIntent } from '../lib/compose-intent'
import { writeLastInboxQueue } from '../lib/inbox-prefs'
import { nextUnreadId, parseQuickFilterParam, toggleOrRangeSelect } from '../lib/inbox-ops'
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
  isAgentRunThread,
  isInternalThread,
  pickPreferredInboxThread,
  threadHubPath,
} from '../lib/message-composer'
import { TicketStageMoveCancelled, loadOpenTickets, resolveOpenTickets } from '../lib/close-thread-signals'
import { useCollectStageFields } from '../components/inbox/TicketStageGate'
import { formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { useConfirm } from '../components/ui/confirm-dialog'
import { InboxSplitSkeleton } from '../components/ui/skeleton'
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
import {
  bulkUpdateSignalThreads,
  cancelScheduledMessage,
  LIST_FILTER_KEYS,
  listFilterFromParams,
  listFilterQuery,
} from '../lib/signals-api'
import { useCommunicationNav } from '../hooks/useCommunicationNav'
import type { AiHandlingMode } from '../lib/ai-handling'

/** Soft-undo window for outbound email replies (server caps at 600s). */
const UNDO_SEND_SECONDS = 15

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
 * active in the sidebar (All communication or a pinned team, narrowed by the
 * channel and agent chips) as thread list + conversation + context panel.
 */
export default function Communication() {
  const { t } = useTranslation('communication')
  const { t: tc } = useTranslation('common')
  const confirm = useConfirm()
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const { threadId: threadIdParam } = useParams<{ threadId?: string }>()
  const navigate = useNavigate()
  const { user, token, logout } = useAuth()
  const collectStageFields = useCollectStageFields()
  const { refresh: refreshNavBadges } = useNavBadges()
  const currentUserId = user?.id ?? null

  const leaf = useMemo<HubLeaf>(
    () => leafFromPath(location.pathname) ?? { type: 'inbox', queue: 'all' },
    [location.pathname],
  )

  const { filters: leafFilters, mode, variant } = useMemo(() => configForLeaf(leaf), [leaf])

  const searchKey = searchParams.toString()
  const folderFilter = useMemo(
    () => listFilterFromParams(new URLSearchParams(searchKey)),
    [searchKey],
  )
  const projectId = folderFilter.project_id
  const categoryId = folderFilter.category_id
  const tagParam = folderFilter.tag
  const stageParam = folderFilter.stage
  const hasFolderFilter = Boolean(projectId || categoryId || tagParam || stageParam)
  const agentParam = searchParams.get('agent')?.trim() || undefined
  const needsDecisionParam = searchParams.get('needs_decision') === '1'
  const { nav: communicationNav } = useCommunicationNav(hasFolderFilter)

  const scopeLabel = useMemo(() => {
    if (!hasFolderFilter) return null
    const onlyProject = projectId && !categoryId && !tagParam && !stageParam
    const onlyTag = tagParam && !projectId && !categoryId && !stageParam
    if (onlyProject) {
      const name = communicationNav.projects.find((row) => row.id === projectId)?.name
      return t('threadList.scopeProject', { name: name ?? t('threadList.scopeProjectFallback') })
    }
    if (onlyTag) return t('threadList.scopeFolder', { name: `#${tagParam}` })
    return t('threadList.scopeFiltered')
  }, [hasFolderFilter, communicationNav.projects, projectId, categoryId, tagParam, stageParam, t])

  const clearScope = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    for (const key of LIST_FILTER_KEYS) next.delete(key)
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

  const { search, setSearch, listSearch, quickFilter, setQuickFilter, resetQuickFilter } =
    useInboxCommunication()
  const inboxQuery = useMemo(() => {
    const params = new URLSearchParams(listFilterQuery(folderFilter))
    if (agentParam) params.set('agent', agentParam)
    if (needsDecisionParam) params.set('needs_decision', '1')
    const query = params.toString()
    return query ? `?${query}` : ''
  }, [folderFilter, agentParam, needsDecisionParam])
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

  /** One context panel in the DOM — desktop split vs mobile drawer, not both. */
  const isLgUp = useMediaQuery('(min-width: 1024px)')

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
  const lastBulkAnchorId = useRef<string | null>(null)

  const applyQuickFilterChange = useCallback(
    (value: InboxListQuickFilter) => {
      setQuickFilter(value)
    },
    [setQuickFilter],
  )

  // `?filter=` is a deep-link input (Cmd+K, old bookmarks), consumed once:
  // unread / pinned apply to this folder; the legacy needs-reply and
  // needs-decision values open For you instead.
  const urlFilter = searchParams.get('filter')
  useEffect(() => {
    const fromUrl = parseQuickFilterParam(urlFilter)
    if (!fromUrl) return
    const next = new URLSearchParams(searchParams)
    next.delete('filter')
    if (fromUrl === 'forYou') {
      navigate(forYouPath(threadIdParam ?? undefined, next), { replace: true })
      return
    }
    setQuickFilter(fromUrl)
    setSearchParams(next, { replace: true })
  }, [urlFilter, setQuickFilter, setSearchParams, navigate, searchParams, threadIdParam])

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
    mergeHubThreadFilters(leafFilters, {
      search: listSearch,
      projectId,
      categoryId,
      tag: tagParam,
      stage: stageParam,
      unread: mode === 'customer' && quickFilter === 'unread',
      pinnedOnly: mode === 'customer' && quickFilter === 'pinned',
      assigneeId: assigneeFilter,
      agentId: agentParam,
      needsDecision: needsDecisionParam,
    }),
    pinnedIds,
  )

  const listContextKey = `${leafKey(leaf)}:${listFilterQuery(folderFilter)}:${agentParam ?? ''}:${needsDecisionParam ? '1' : ''}`

  // The quick filter is per folder: every folder opens on "all", unless the
  // URL that opened it carries a deep-linked filter (consumed above).
  const urlFilterRef = useRef(urlFilter)
  urlFilterRef.current = urlFilter
  useEffect(() => {
    if (parseQuickFilterParam(urlFilterRef.current)) return
    resetQuickFilter()
  }, [listContextKey, resetQuickFilter])

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
    // For you keeps the server order: your own turn first.
    if (leaf.type !== 'inbox' || leaf.queue === 'for_you') return next
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
    loadingOlder,
    hasOlder,
    loadOlder,
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
    changeAiHandling,
    unreadHighlightIds,
  } = useThreadDetail(selectedThreadId, pinnedIds, { skipMarkRead })
  const [aiHandlingSaving, setAiHandlingSaving] = useState(false)

  useEffect(() => {
    if (!detailError || selectedThreadId == null || detailLoading) return
    const msg = detailError.toLowerCase()
    if (!msg.includes('404') && !msg.includes('not found')) return
    navigate(`${leafPath(leaf)}${inboxQuery}`, { replace: true })
  }, [detailError, selectedThreadId, detailLoading, leaf, inboxQuery, navigate])

  const handleSelectThread = useCallback(
    (id: ThreadId, replace = false, opts?: { markRead?: boolean }) => {
      if (opts?.markRead !== false) {
        setSkipMarkRead(false)
        setThreadReadState(id, false)
      }
      navigate(`${leafPath(leaf, String(id))}${inboxQuery}`, replace ? { replace: true } : undefined)
      scrollActiveThreadIntoView()
    },
    [leaf, navigate, setThreadReadState, inboxQuery],
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
  const selectedInFilteredList =
    selectedThreadId != null &&
    filteredThreads.some((thread) => String(thread.id) === String(selectedThreadId))

  // Auto-select the first match. On For you, also replace orphan detail
  // (thread left open from another folder) or clear the pane when empty.
  useEffect(() => {
    if (composeOpen || !threadsReady) return
    if (selectedThreadId == null) {
      if (firstThreadId == null) return
      setSkipMarkRead(true)
      handleSelectThread(firstThreadId, true, { markRead: false })
      return
    }
    if (leaf.queue !== 'for_you' || selectedInFilteredList) return
    if (firstThreadId != null) {
      setSkipMarkRead(true)
      handleSelectThread(firstThreadId, true, { markRead: false })
      return
    }
    navigate(`${leafPath(leaf)}${inboxQuery}`, { replace: true })
  }, [
    composeOpen,
    threadsReady,
    selectedThreadId,
    selectedInFilteredList,
    firstThreadId,
    listContextKey,
    leaf,
    handleSelectThread,
    navigate,
    inboxQuery,
  ])

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

  const handleChangeAiHandling = useCallback(
    async (mode: AiHandlingMode | null, opts: { assignToMe?: boolean; reason?: string } = {}) => {
      if (selectedThreadId == null) return
      setAiHandlingSaving(true)
      try {
        const next = await changeAiHandling(mode, opts)
        if (next) {
          toast.success(
            mode
              ? tc('aiHandling.changed', { mode: tc(`aiHandling.modes.${next.effective}.label`) })
              : tc('aiHandling.cleared', { source: tc(`aiHandling.sources.${next.source}`) }),
          )
        }
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : tc('aiHandling.saveError'))
      } finally {
        setAiHandlingSaving(false)
      }
    },
    [selectedThreadId, changeAiHandling, tc],
  )

  const handleDeleteThread = useCallback(
    async (id: ThreadId, subject?: string) => {
      if (!token) return
      const label = subject?.trim() || t('actions.deleteFallback', { id })
      if (!(await confirm({ description: t('actions.deleteConfirm', { label }), destructive: true }))) {
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
    [token, removeThread, pinnedIds, removePin, selectedThreadId, leaf, navigate, refreshNavBadges, inboxQuery, t, confirm],
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

  const handleListClose = useCallback(
    async (id: ThreadId) => {
      if (!token) return
      try {
        const openTickets = await loadOpenTickets(String(id))
        if (openTickets.length > 0) {
          if (
            !(await confirm({
              description: t('threadChrome.closeWithTicketShortcutConfirm', { count: openTickets.length }),
            }))
          ) {
            return
          }
          if (
            await confirm({
              description: t('threadChrome.closeWithTicketShortcutResolve', { count: openTickets.length }),
            })
          ) {
            try {
              await resolveOpenTickets(openTickets, collectStageFields)
            } catch (err) {
              if (err instanceof TicketStageMoveCancelled) return
              toast.error(formatApiErrorMessage(err, t('threadChrome.closeWithTicketError')))
              return
            }
          }
        }
        await apiPatchThread(token, id, { status: 'closed' })
        const undoReopen = () => {
          void apiPatchThread(token, id, { status: 'open' }).then(() => {
            void refreshThreads()
            void refreshNavBadges()
          })
        }
        toast.success(t('threadResolved.closed'), {
          action: { label: t('undoSend.undo'), onClick: undoReopen },
        })
        void refreshNavBadges()
        if (String(selectedThreadId) === String(id)) {
          leaveResolvedThread(id, 'closed')
        } else {
          const dedicated = dedicatedInboxQueueForStatus('closed')
          if (!(leaf.type === 'inbox' && dedicated != null && leaf.queue === dedicated)) {
            removeThread(id)
          } else {
            void refreshThreads()
          }
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('actions.closeError'))
      }
    },
    [
      token,
      confirm,
      collectStageFields,
      selectedThreadId,
      leaveResolvedThread,
      leaf,
      removeThread,
      refreshThreads,
      refreshNavBadges,
      t,
    ],
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

    // Deep link into the wrong channel folder → jump to All communication.
    if (leaf.type === 'channel' && !threadFitsChannelLeaf(detail.thread, leaf)) {
      navigate(`${inboxPath('open', String(detail.thread.id))}${inboxQuery}`, { replace: true })
      return
    }

    if (leaf.type === 'inbox') {
      const inboxQueue = leaf.queue ?? 'all'
      // For you keeps the open conversation on screen after you answer; it
      // drops out of the list on the next refresh.
      if (inboxQueue === 'for_you' && detail.thread.status === 'open') return
      if (threadFitsInboxQueue(detail.thread, inboxQueue, currentUserId)) return
      if (resolvedStatusLeavesInboxQueue(detail.thread.status, inboxQueue)) {
        // Stay in Open / For you / … — do not follow the thread into Closed or Spam.
        advancingRef.current = true
        try {
          leaveResolvedThread(selectedThreadId, detail.thread.status)
        } finally {
          advancingRef.current = false
        }
        return
      }
      const destQueue =
        detail.thread.status === 'open' && !isAgentRunThread(detail.thread) ? 'open' : 'all'
      navigate(`${inboxPath(destQueue, String(detail.thread.id))}${inboxQuery}`, { replace: true })
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
        if (
          input.assignedToUserId === 0 ||
          (input.assignee?.kind === 'team' && (input.assignee.id == null || input.assignee.id === ''))
        ) {
          toast.success(t('threadChrome.unassignedDone'))
        }
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
          } else if (input.status === 'pending') {
            toast.success(t('threadChrome.markUnread'))
          }
          leaveResolvedThread(fromId, input.status)
        }
      } catch (err) {
        const fallback =
          input.assignee !== undefined || input.assignedToUserId !== undefined
            ? t('threadChrome.assignError')
            : t('threadChrome.patchError')
        toast.error(formatApiErrorMessage(err, fallback))
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

  const followUp = useFollowUpPlanner({
    thread: detail?.thread ?? null,
    onPatch: handlePatch,
    onRefresh: refreshDetail,
  })
  const canPlanFollowUp =
    Boolean(detail) &&
    !isInternalThread(detail!.thread) &&
    detail!.thread.status !== 'closed' &&
    detail!.thread.status !== 'spam'

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
      void (async () => {
        if (selectedThreadId == null) return
        // Same key as Close: in Closed/Spam it reopens (Not spam), like the thread button.
        const status = detail?.thread.status
        if (status === 'closed' || status === 'spam') {
          await handlePatch({ status: 'open' })
          return
        }
        const openTickets = await loadOpenTickets(String(selectedThreadId))
        if (openTickets.length > 0) {
          if (
            !(await confirm({
              description: t('threadChrome.closeWithTicketShortcutConfirm', { count: openTickets.length }),
            }))
          ) {
            return
          }
          if (
            await confirm({
              description: t('threadChrome.closeWithTicketShortcutResolve', { count: openTickets.length }),
            })
          ) {
            try {
              await resolveOpenTickets(openTickets, collectStageFields)
            } catch (err) {
              if (err instanceof TicketStageMoveCancelled) return
              toast.error(formatApiErrorMessage(err, t('threadChrome.closeWithTicketError')))
              return
            }
          }
        }
        await handlePatch({ status: 'closed' })
      })()
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
    onCompose: mode === 'customer' ? () => navigate(newConversationPath({ intent: 'contact' })) : undefined,
    onNewChat: mode === 'customer' ? () => navigate(newConversationPath()) : undefined,
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
      // 1 all · 2 unread · 3 pinned · 4 For you.
      if (digit === 4 || digit === 5) {
        navigate(forYouPath())
        return
      }
      applyQuickFilterChange(digit === 1 ? 'all' : digit === 2 ? 'unread' : 'pinned')
    },
  })

  const handleBulkAction = useCallback(
    async (action: BulkThreadAction, assigneeId?: number) => {
      if (!token || bulkSelectedIds.size === 0) return
      const count = bulkSelectedIds.size
      if (action === 'trash') {
        if (!(await confirm({ description: t('bulkActions.trashConfirm', { count }), destructive: true }))) return
      }
      setBulkBusy(true)
      try {
        const updated = await bulkUpdateSignalThreads(
          token,
          [...bulkSelectedIds],
          action,
          assigneeId,
        )
        toast.success(
          action === 'trash'
            ? t('bulkActions.trashDone', { count: updated })
            : t('actions.bulkUpdated', { count: updated }),
        )
        setBulkSelectedIds(new Set())
        void refreshThreads()
        void refreshNavBadges()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('actions.bulkFailed'))
      } finally {
        setBulkBusy(false)
      }
    },
    [token, bulkSelectedIds, refreshThreads, refreshNavBadges, t, confirm],
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
              action === 'send_and_close' ? t('threadResolved.closed') : t('timeline.events.replySent'),
            )
          }
          if (action === 'send_and_close') leaveResolvedThread(fromId, 'closed')
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
        // A person answering an autonomous conversation takes it over so the
        // AI does not reply next to them. Assisted keeps drafting.
        if (detail?.thread.aiHandling?.effective === 'autonomous') {
          try {
            await changeAiHandling('manual', { assignToMe: true })
          } catch {
            // Reply already left; take over is best-effort.
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
      changeAiHandling,
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

  // Secondary folders (snoozed / spam / closed) use queue empty copy — never the
  // first-run setup checklist (F-63). Setup belongs on Open / new chat only.
  const isSecondaryInboxQueue =
    leaf.type === 'inbox' &&
    (leaf.queue === 'snoozed' || leaf.queue === 'spam' || leaf.queue === 'closed')

  const isInboxEmpty =
    leaf.type === 'inbox' &&
    (leaf.queue === 'all' || leaf.queue === 'open' || leaf.queue == null) &&
    !isSecondaryInboxQueue &&
    threadsReady &&
    threads.length === 0 &&
    // An active search, a list chip, a scoped query, or an open thread is not a first-run empty.
    // Needs reply / Unread can empty the list and must not swap in the setup checklist.
    search.trim().length === 0 &&
    quickFilter === 'all' &&
    !hasFolderFilter &&
    !searchParams.get('agent') &&
    searchParams.get('needs_decision') !== '1' &&
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
        <div className="w-14 h-14 rounded-xl bg-accent/10 flex items-center justify-center mb-4">
          <MessageSquare size={28} className="text-accent" />
        </div>
        <h2 className="text-lg font-semibold text-text-heading">{t('onboarding.emptyInboxTitle')}</h2>
        <p className="text-sm text-text-secondary mt-2 max-w-sm">{t('onboarding.emptyInboxBody')}</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Link
            to="/communication/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-accent-fg hover:bg-accent-hover"
          >
            <SquarePen size={14} />
            {t('onboarding.startConversation')}
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
            <Link
              to={newConversationPath({ intent: 'contact' })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3.5 py-2 text-sm font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
            >
              <Mail size={14} />
              {t('newConversation.intentEmail')}
            </Link>
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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md">
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
            onClose={(id) => void handleListClose(id)}
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
            listQueue={leaf.queue ?? null}
            scrollKey={leafKey(leaf)}
            assigneeFilter={assigneeFilter}
            onAssigneeFilter={setAssigneeFilter}
            priorityFilter={priorityFilter}
            onPriorityFilter={setPriorityFilter}
            scopeLabel={scopeLabel}
            onClearScope={hasFolderFilter ? clearScope : undefined}
            banner={
              needsDecisionParam ? (
                <DecisionGroupsBanner onDismissed={() => void refreshThreads()} />
              ) : null
            }
            total={threadsTotal}
            hasMore={threadsHaveMore}
            loadingMore={threadsLoadingMore}
            onLoadMore={() => void loadMoreThreads()}
            emptyLabel={
              search.trim()
                ? t('threadList.emptySearch', { query: search.trim() })
                : hasFolderFilter || leaf.type === 'channel' || leaf.type === 'agent' || leaf.type === 'team'
                  ? t('threadList.emptyScoped')
                  : leaf.type === 'inbox' && leaf.queue === 'for_you'
                    ? t('threadList.emptyForYou')
                    : leaf.type === 'inbox' && leaf.queue === 'snoozed'
                      ? t('threadList.emptySnoozed')
                      : leaf.type === 'inbox' && leaf.queue === 'spam'
                        ? t('threadList.emptySpam')
                        : leaf.type === 'inbox' && leaf.queue === 'closed'
                          ? t('threadList.emptyClosed')
                          : undefined
            }
            emptyHint={
              search.trim() ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="mt-2 text-xs font-medium text-accent hover:underline"
                >
                  {t('inboxSearchClear')}
                </button>
              ) : hasFolderFilter ? (
                <button
                  type="button"
                  onClick={clearScope}
                  className="mt-2 text-xs font-medium text-accent hover:underline"
                >
                  {t('threadList.clearScope')}
                </button>
              ) : leaf.type === 'inbox' && leaf.queue === 'snoozed' ? (
                <div className="mt-2 flex flex-col items-center gap-2">
                  <p className="text-xs text-text-muted">{t('threadList.emptySnoozedHint')}</p>
                  <Link
                    to={inboxPath('open')}
                    className="rounded-md border border-border/60 px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
                  >
                    {t('threadList.openInbox')}
                  </Link>
                </div>
              ) : leaf.type === 'inbox' && leaf.queue === 'spam' ? (
                <div className="mt-2 flex flex-col items-center gap-2">
                  <p className="text-xs text-text-muted">{t('threadList.emptySpamHint')}</p>
                  <Link
                    to={inboxPath('open')}
                    className="rounded-md border border-border/60 px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
                  >
                    {t('threadList.openInbox')}
                  </Link>
                </div>
              ) : leaf.type === 'inbox' && leaf.queue === 'closed' ? (
                <div className="mt-2 flex flex-col items-center gap-2">
                  <p className="text-xs text-text-muted">{t('threadList.emptyClosedHint')}</p>
                  <Link
                    to={inboxPath('open')}
                    className="rounded-md border border-border/60 px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
                  >
                    {t('threadList.openInbox')}
                  </Link>
                </div>
              ) : leaf.queue === 'for_you' ? (
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                  <p className="w-full text-xs text-text-muted">{t('threadList.emptyForYouHint')}</p>
                  <Link
                    to={inboxPath('open')}
                    className="rounded-md border border-border/60 px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
                  >
                    {t('threadList.openInbox')}
                  </Link>
                </div>
              ) : mode === 'customer' && threads.length === 0 && !threadsLoading ? (
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                  <Link
                    to="/settings/setup"
                    className="rounded-md border border-border/60 px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
                  >
                    {t('onboarding.openGuide')}
                  </Link>
                  <Link
                    to="/settings/channels"
                    className="rounded-md border border-border/60 px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
                  >
                    {t('threadChrome.openEmailSettings')}
                  </Link>
                  <Link
                    to="/communication/new"
                    className="rounded-md border border-border/60 px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
                  >
                    {t('onboarding.startConversation')}
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
            unreadHighlightIds={unreadHighlightIds}
            onPatch={handlePatch}
            onReply={handleReply}
            onNote={handleNote}
            onUpdateNote={handleUpdateNote}
            onDeleteNote={handleDeleteNote}
            onMarkUnread={detail ? handleDetailMarkUnread : undefined}
            onRefresh={refreshDetail}
            hasOlder={hasOlder}
            loadingOlder={loadingOlder}
            onLoadOlder={hasOlder ? loadOlder : undefined}
            onTogglePin={handleDetailTogglePin}
            onChangeAiHandling={detail ? handleChangeAiHandling : undefined}
            aiHandlingSaving={aiHandlingSaving}
            onDelete={
              detail &&
              (detail.thread.status === 'closed' || detail.thread.status === 'spam')
                ? handleDetailDelete
                : undefined
            }
            deleting={String(deletingThreadId) === String(selectedThreadId)}
            onToggleContact={detail ? toggleContactPanel : undefined}
            onBack={() => navigate(`${leafPath(leaf)}${inboxQuery}`)}
            contactOpen={showContactPanel}
            onDecisionResolved={handleDecisionResolved}
            mode={mode}
            onWhatsNext={canPlanFollowUp ? followUp.openPlanner : undefined}
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
        {detail && showContactPanel && isLgUp ? (
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
              saving={saving}
              onPatch={handlePatch}
              onWhatsNext={canPlanFollowUp ? followUp.openPlanner : undefined}
              relatedConversations={detail.relatedConversations}
            />
          </SplitPane>
        ) : null}
      </SplitRow>
      {/* Mobile/tablet: same context panel as a slide-over. */}
      {detail && showContactPanel && !isLgUp ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label={t('split.closeContext')}
            onClick={toggleContactPanel}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[82vh] overflow-y-auto rounded-t-xl border-t border-border/60 bg-bg-surface shadow-overlay sm:inset-y-0 sm:left-auto sm:w-[min(100%,20rem)] sm:max-h-none sm:rounded-none sm:border-l sm:border-t-0">
            <AgentThreadPanel
              thread={detail.thread}
              onClose={toggleContactPanel}
              onThreadUpdated={handleThreadUpdated}
              saving={saving}
              onPatch={handlePatch}
              onWhatsNext={canPlanFollowUp ? followUp.openPlanner : undefined}
              relatedConversations={detail.relatedConversations}
            />
          </div>
        </div>
      ) : null}
      {detail ? (
        <WhatsNextDialog
          open={followUp.open}
          onOpenChange={followUp.setOpen}
          signalId={String(detail.thread.id)}
          defaultTitle={followUp.title}
          saving={followUp.saving}
          onSaveReminder={followUp.save}
          onSignalCreated={refreshDetail}
          onHandledExternally={() => void refreshDetail()}
        />
      ) : null}
      <ComposeEmailModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onSent={handleComposeSent}
        prefill={composePrefill}
      />
      <InboxShortcutHelp open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />
    </div>
  )
}
