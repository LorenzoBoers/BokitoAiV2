import { useCallback, useEffect, useMemo, useState } from 'react'
import InboxShortcutHelp from '../components/inbox/InboxShortcutHelp'
import {
  focusInboxReply,
  scrollActiveThreadIntoView,
  useInboxListShortcuts,
} from '../hooks/useInboxListShortcuts'
import { nextUnreadId } from '../lib/inbox-ops'
import { threadNeedsReply } from '../lib/message-composer'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bot } from 'lucide-react'
import { toast } from 'sonner'
import { SplitPane, SplitRow } from '../components/ui/SplitRow'
import ThreadList from '../components/inbox/ThreadList'
import { AgentChatView, DirectChatEmptyState } from '../components/inbox/AgentChatView'
import AgentThreadPanel from '../components/inbox/AgentThreadPanel'
import { useAuth } from '../context/AuthContext'
import { useNavBadges } from '../context/NavBadgeContext'
import {
  useInboxCommunication,
  type InboxListQuickFilter,
} from '../context/InboxCommunicationContext'
import { usePinnedIds } from '../hooks/usePinnedIds'
import { useThreads } from '../hooks/useThreads'
import { bokitoListChatTargets, type ChatTarget } from '../lib/signals-api'
import {
  deleteThread as apiDeleteThread,
  markThreadRead as apiMarkThreadRead,
  markThreadUnread as apiMarkThreadUnread,
  pinThread as apiPinThread,
  unpinThread as apiUnpinThread,
  type InboxThread,
  type ThreadId,
} from '../lib/inbox-api'
import { agentChatPath, decisionsPath, leafFromPath, leafPath, SUB_QUEUE_TO_VIEW } from '../lib/messages-paths'

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
 * Direct chats with assistants and company agents — same three-pane layout as
 * customer threads: nav target, thread list, chat detail + context panel.
 */
export default function DirectCommunication() {
  const { t } = useTranslation('communication')
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { threadId: threadIdParam, agentId: routeAgentId } = useParams<{
    threadId?: string
    agentId?: string
  }>()
  const { token } = useAuth()
  const { refresh: refreshNavBadges } = useNavBadges()
  const { search, setSearch, listSearch, quickFilter, setQuickFilter } = useInboxCommunication()
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false)

  const leaf = leafFromPath(location.pathname)
  const isAgentScope = leaf?.type === 'agent'
  const agentQueue = leaf?.type === 'agent' ? leaf.queue : undefined
  // 'activity' is routed to the Communication work-log view, never here.
  const listView =
    agentQueue && agentQueue !== 'activity' ? SUB_QUEUE_TO_VIEW[agentQueue] : 'all_open'
  const [targets, setTargets] = useState<ChatTarget[]>([])
  const [targetsLoading, setTargetsLoading] = useState(true)
  const [targetsError, setTargetsError] = useState<string | null>(null)

  const projectId = searchParams.get('project_id')?.trim() || undefined
  const inboxQuery = useMemo(() => {
    const params = new URLSearchParams()
    if (projectId) params.set('project_id', projectId)
    const query = params.toString()
    return query ? `?${query}` : ''
  }, [projectId])

  const loadTargets = useCallback(async () => {
    if (!token) return
    setTargetsLoading(true)
    setTargetsError(null)
    try {
      const data = await bokitoListChatTargets(token)
      setTargets(data.items)
    } catch (err) {
      setTargets([])
      setTargetsError(err instanceof Error ? err.message : t('directChat.loadTargetsError'))
    } finally {
      setTargetsLoading(false)
    }
  }, [token, t])

  useEffect(() => {
    void loadTargets()
  }, [loadTargets])

  const activeAgent: ChatTarget | null = useMemo(() => {
    if (isAgentScope && routeAgentId) {
      return targets.find((row) => row.id === routeAgentId) ?? null
    }
    return null
  }, [isAgentScope, routeAgentId, targets])

  const filterAgentId = isAgentScope ? routeAgentId : undefined

  const listContextKey = `direct:${filterAgentId ?? 'none'}:${listView}:${projectId ?? ''}`

  useEffect(() => {
    setSearch('')
  }, [listContextKey, setSearch])

  const { pinnedIds, addPin, removePin } = usePinnedIds()
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
    {
      view: listView,
      folder: 'assistant',
      agentId: filterAgentId,
      projectId,
      search: listSearch,
      unread: quickFilter === 'unread' || undefined,
      needsReply: quickFilter === 'needsReply' || undefined,
      needsDecision: quickFilter === 'needsDecision' || undefined,
      pinnedOnly: quickFilter === 'pinned' || undefined,
    },
    pinnedIds,
  )

  const filteredThreads = useMemo(
    () => applyQuickFilter(threads, quickFilter),
    [threads, quickFilter],
  )

  const selectedThreadId: ThreadId | null = threadIdParam ?? null
  const selectedThread = useMemo(
    () => threads.find((t) => String(t.id) === String(selectedThreadId)) ?? null,
    [threads, selectedThreadId],
  )

  const [deletingThreadId, setDeletingThreadId] = useState<ThreadId | null>(null)
  // Open by default; a close only lasts for the current browser session.
  const [showContextPanel, setShowContextPanel] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    const stored = window.sessionStorage.getItem('inbox.contactPanel.open')
    return stored === null ? true : stored === '1'
  })

  const toggleContextPanel = useCallback(() => {
    setShowContextPanel((prev) => {
      const next = !prev
      try {
        window.sessionStorage.setItem('inbox.contactPanel.open', next ? '1' : '0')
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  const basePath = useMemo(() => {
    if (leaf?.type === 'agent') {
      return leafPath(leaf)
    }
    if (isAgentScope && routeAgentId) {
      return agentChatPath(routeAgentId)
    }
    return '/communication/new'
  }, [leaf, isAgentScope, routeAgentId])

  const handleSelectThread = useCallback(
    (id: ThreadId, replace = false) => {
      setThreadReadState(id, false)
      navigate(`${basePath}/t/${encodeURIComponent(String(id))}${inboxQuery}`, replace ? { replace: true } : undefined)
      void refreshNavBadges()
      scrollActiveThreadIntoView()
    },
    [basePath, navigate, setThreadReadState, refreshNavBadges, inboxQuery],
  )

  const firstThreadId = filteredThreads[0]?.id ?? null
  useEffect(() => {
    if (threadIdParam || !threadsReady || firstThreadId == null || targetsLoading) return
    handleSelectThread(firstThreadId, true)
  }, [threadIdParam, threadsReady, firstThreadId, listContextKey, handleSelectThread, targetsLoading])

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
        if (next) await apiPinThread(token, id)
        else await apiUnpinThread(token, id)
      } catch {
        if (next) removePin(id)
        else addPin(id)
      }
    },
    [token, addPin, removePin],
  )

  useInboxListShortcuts({
    helpOpen: shortcutHelpOpen,
    onCloseHelp: () => setShortcutHelpOpen(false),
    onOpenHelp: () => setShortcutHelpOpen(true),
    selectedThreadId,
    threadIds: filteredThreads.map((thread) => thread.id),
    onSelect: handleSelectThread,
    onEscapeList: () => {
      if (selectedThreadId != null) navigate(`${basePath}${inboxQuery}`)
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
    onPin: () => {
      const current = filteredThreads.find((thread) => String(thread.id) === String(selectedThreadId))
      if (selectedThreadId != null && current) {
        void handleListTogglePin(selectedThreadId, current.isPinned)
      }
    },
    onReply: () => {
      focusInboxReply()
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
      setQuickFilter(next)
    },
  })

  const handleDeleteThread = useCallback(
    async (id: ThreadId, subject?: string) => {
      if (!token) return
      const label = subject?.trim() || `thread #${id}`
      if (!window.confirm(t('actions.deleteConfirm', { label }))) return

      setDeletingThreadId(id)
      try {
        await apiDeleteThread(token, id)
        removeThread(id)
        if (pinnedIds.some((pinnedId) => String(pinnedId) === String(id))) removePin(id)
        if (String(selectedThreadId) === String(id)) {
          navigate(`${basePath}${inboxQuery}`)
        }
        void refreshNavBadges()
        void refreshThreads()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('directChat.deleteFailed'))
      } finally {
        setDeletingThreadId(null)
      }
    },
    [token, removeThread, pinnedIds, removePin, selectedThreadId, basePath, navigate, refreshNavBadges, refreshThreads, inboxQuery, t],
  )

  const agentLabel = activeAgent?.name ?? t('listItem.assistant')

  if (!targetsLoading && targetsError) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <Bot size={28} className="text-text-muted" />
        <p className="mt-3 text-sm text-text-secondary">{t('directChat.emptyHint')}</p>
        <p className="mt-1 text-sm text-status-error">{targetsError}</p>
        <button
          type="button"
          onClick={() => void loadTargets()}
          className="mt-4 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-accent-fg hover:bg-accent-hover"
        >
          {t('directChat.retry')}
        </button>
      </div>
    )
  }

  if (!targetsLoading && !filterAgentId) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <Bot size={28} className="text-text-muted" />
        <p className="mt-3 text-sm font-medium text-text-primary">{t('newConversation.noAgentsAvailable')}</p>
        <p className="mt-1 text-sm text-text-muted">{t('newConversation.noAgentsAvailableForUser')}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link
            to="/communication/new"
            className="rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-accent-fg hover:bg-accent-hover"
          >
            {t('directChat.newChat')}
          </Link>
          <Link
            to="/agents"
            className="rounded-lg border border-border/60 px-3.5 py-2 text-xs font-semibold text-text-heading hover:bg-bg-hover"
          >
            {t('newConversation.openAgents')}
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
            loading={!threadsReady || targetsLoading}
            error={threadsError}
            onRetry={() => void refreshThreads()}
            selectedId={selectedThreadId}
            quickFilter={quickFilter}
            onQuickFilterChange={setQuickFilter}
            onSelectThread={handleSelectThread}
            onMarkRead={handleListMarkRead}
            onMarkUnread={handleListMarkUnread}
            onTogglePin={handleListTogglePin}
            onDelete={(id) => void handleDeleteThread(id, threads.find((t) => t.id === id)?.emailSubject)}
            deletingThreadId={deletingThreadId}
            variant="direct"
            total={threadsTotal}
            hasMore={threadsHaveMore}
            loadingMore={threadsLoadingMore}
            onLoadMore={() => void loadMoreThreads()}
          />
        </SplitPane>
        <SplitPane id="main" defaultWidth={0} minWidth={0} maxWidth={0} flex>
          {selectedThreadId ? (
            <AgentChatView
              conversationId={String(selectedThreadId)}
              title={selectedThread?.emailSubject}
              agentName={selectedThread?.agentName ?? activeAgent?.name}
              agentKind={selectedThread?.agentKind ?? activeAgent?.kind}
              onDeleted={() => navigate(`${basePath}${inboxQuery}`)}
              onBack={() => navigate(`${basePath}${inboxQuery}`)}
              onRefreshThreads={() => void refreshThreads()}
              onToggleContext={toggleContextPanel}
              contextOpen={showContextPanel}
            />
          ) : (
            <DirectChatEmptyState agentLabel={agentLabel} />
          )}
        </SplitPane>
        {selectedThread && showContextPanel ? (
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
              thread={selectedThread}
              onClose={toggleContextPanel}
              onThreadUpdated={() => void refreshThreads()}
            />
          </SplitPane>
        ) : null}
      </SplitRow>
      <InboxShortcutHelp open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />
    </div>
  )
}
