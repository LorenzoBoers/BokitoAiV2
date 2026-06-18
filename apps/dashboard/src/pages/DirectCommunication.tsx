import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Bot } from 'lucide-react'
import { toast } from 'sonner'
import ThreadList from '../components/inbox/ThreadList'
import DirectChatPanel, { DirectChatEmptyState } from '../components/inbox/DirectChatPanel'
import AgentThreadPanel from '../components/inbox/AgentThreadPanel'
import { useAuth } from '../context/AuthContext'
import { useNavBadges } from '../context/NavBadgeContext'
import {
  useInboxCommunication,
  type InboxListQuickFilter,
} from '../context/InboxCommunicationContext'
import { usePinnedIds } from '../hooks/usePinnedIds'
import { useThreads } from '../hooks/useThreads'
import { bokitoListChatTargets, type ChatTarget } from '../lib/bokito-api'
import {
  deleteThread as apiDeleteThread,
  markThreadRead as apiMarkThreadRead,
  markThreadUnread as apiMarkThreadUnread,
  pinThread as apiPinThread,
  unpinThread as apiUnpinThread,
  type InboxThread,
  type ThreadId,
} from '../lib/inbox-api'
import { agentChatPath, assistantPath, leafFromPath } from '../lib/messages-paths'

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
 * Direct chats with assistants and company agents — same three-pane layout as
 * customer threads: nav target, thread list, chat detail + context panel.
 */
export default function DirectCommunication() {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { threadId: threadIdParam, agentId: routeAgentId } = useParams<{
    threadId?: string
    agentId?: string
  }>()
  const { token } = useAuth()
  const { refresh: refreshNavBadges } = useNavBadges()
  const { search, setSearch, quickFilter, setQuickFilter, resetQuickFilter } = useInboxCommunication()

  const leaf = leafFromPath(location.pathname)
  const isAgentScope = leaf?.type === 'agent'
  const [targets, setTargets] = useState<ChatTarget[]>([])
  const [targetsLoading, setTargetsLoading] = useState(true)

  const projectId = searchParams.get('project_id')?.trim() || undefined
  const inboxQuery = useMemo(() => {
    const params = new URLSearchParams()
    if (projectId) params.set('project_id', projectId)
    const query = params.toString()
    return query ? `?${query}` : ''
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!token) return
      setTargetsLoading(true)
      try {
        const data = await bokitoListChatTargets(token)
        if (!cancelled) setTargets(data.items)
      } catch {
        if (!cancelled) setTargets([])
      } finally {
        if (!cancelled) setTargetsLoading(false)
      }
    }
    void load()
  }, [token])

  const personalAgent = targets.find((t) => t.kind === 'personal') ?? null
  const activeAgent: ChatTarget | null = useMemo(() => {
    if (isAgentScope && routeAgentId) {
      return targets.find((t) => t.id === routeAgentId) ?? null
    }
    return personalAgent
  }, [isAgentScope, routeAgentId, targets, personalAgent])

  const filterAgentId = isAgentScope ? routeAgentId : personalAgent?.id

  const listContextKey = `direct:${filterAgentId ?? 'none'}:${projectId ?? ''}`

  useEffect(() => {
    setSearch('')
    resetQuickFilter()
  }, [listContextKey, setSearch, resetQuickFilter])

  const { pinnedIds, addPin, removePin } = usePinnedIds()
  const {
    threads,
    loading: threadsLoading,
    threadsReady,
    error: threadsError,
    refresh: refreshThreads,
    setThreadReadState,
    removeThread,
  } = useThreads(
    {
      view: 'all_open',
      folder: 'assistant',
      agentId: filterAgentId,
      projectId,
      search,
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
  const [showContextPanel, setShowContextPanel] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    const stored = window.localStorage.getItem('inbox.contactPanel.open')
    return stored === null ? true : stored === '1'
  })

  const toggleContextPanel = useCallback(() => {
    setShowContextPanel((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem('inbox.contactPanel.open', next ? '1' : '0')
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  const basePath = useMemo(() => {
    if (isAgentScope && routeAgentId) {
      return agentChatPath(routeAgentId)
    }
    return assistantPath()
  }, [isAgentScope, routeAgentId])

  const handleSelectThread = useCallback(
    (id: ThreadId, replace = false) => {
      setThreadReadState(id, false)
      navigate(`${basePath}/t/${encodeURIComponent(String(id))}${inboxQuery}`, replace ? { replace: true } : undefined)
      void refreshNavBadges()
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

  const handleDeleteThread = useCallback(
    async (id: ThreadId, subject?: string) => {
      if (!token) return
      const label = subject?.trim() || `thread #${id}`
      if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return

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
        toast.error(err instanceof Error ? err.message : 'Delete failed.')
      } finally {
        setDeletingThreadId(null)
      }
    },
    [token, removeThread, pinnedIds, removePin, selectedThreadId, basePath, navigate, refreshNavBadges, refreshThreads, inboxQuery],
  )

  const agentLabel = activeAgent?.name ?? 'My assistant'

  if (!targetsLoading && !filterAgentId) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <Bot size={28} className="text-text-muted" />
        <p className="mt-3 text-sm text-text-secondary">No assistant configured for this workspace.</p>
        <Link to="/settings/assistant" className="mt-3 text-sm font-medium text-accent hover:underline">
          Configure assistant
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
          loading={threadsLoading || targetsLoading}
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
          variant="direct"
        />
        {selectedThreadId ? (
          <DirectChatPanel
            conversationId={String(selectedThreadId)}
            title={selectedThread?.emailSubject}
            agentName={selectedThread?.agentName ?? activeAgent?.name}
            agentKind={selectedThread?.agentKind ?? activeAgent?.kind}
            onDeleted={() => navigate(`${basePath}${inboxQuery}`)}
            onRefreshThreads={() => void refreshThreads()}
            onToggleContext={toggleContextPanel}
            contextOpen={showContextPanel}
          />
        ) : (
          <DirectChatEmptyState agentLabel={agentLabel} />
        )}
        {selectedThread && showContextPanel ? (
          <AgentThreadPanel thread={selectedThread} onClose={toggleContextPanel} />
        ) : null}
      </div>
    </div>
  )
}
