import { Mail } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ThreadList from '../components/inbox/ThreadList'
import ThreadDetail from '../components/inbox/ThreadDetail'
import ContactPanel from '../components/inbox/ContactPanel'
import { useAuth } from '../context/AuthContext'
import { useMailboxConnections } from '../hooks/useMailboxConnections'
import { useThreads } from '../hooks/useThreads'
import { useThreadDetail } from '../hooks/useThreadDetail'
import {
  markThreadRead as apiMarkThreadRead,
  markThreadUnread as apiMarkThreadUnread,
  pinThread as apiPinThread,
  unpinThread as apiUnpinThread,
  type InboxThread,
  type PatchThreadInput,
  type ThreadFilters,
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
}

// Inverse mapping so we can build canonical redirect URLs from a View back to
// the short URL segment used in routes ("all", "my", ...).
const VIEW_TO_QUEUE: Record<View, string> = {
  all_open: 'all',
  mine: 'my',
  unassigned: 'unassigned',
  pending: 'pending',
  closed: 'closed',
  spam: 'spam',
  outbound: 'out',
  pinned: 'pinned',
}

// Whether a thread (in its current state) belongs in the given queue view.
// Used to decide whether a deep-linked URL is still valid or needs a stale
// redirect. Mirrors the server-side queue filters as closely as practical.
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
    default:
      return true
  }
}

// Canonical queue for a thread based on its current state. When a shared URL
// references a stale view, the user is silently redirected to the canonical
// view here so the thread is always reachable.
function getCanonicalView(thread: InboxThread): View {
  if (thread.status === 'closed') return 'closed'
  if (thread.status === 'spam') return 'spam'
  if (thread.status === 'pending') return 'pending'
  return 'all_open'
}


export default function Communication() {
  const { t } = useTranslation('communication')
  const { queue, channelId, threadId: threadIdParam } = useParams<{
    queue: string
    channelId?: string
    threadId?: string
  }>()
  const navigate = useNavigate()
  const { user, token } = useAuth()
  const currentUserId = user?.id ?? null

  // URL is the single source of truth for the current view AND selected thread
  const view: View = (queue ? QUEUE_TO_VIEW[queue] : undefined) ?? 'all_open'
  const connectionId = channelId ? Number(channelId) : undefined
  const selectedThreadId = threadIdParam ? Number(threadIdParam) : null

  const [search, setSearch] = useState('')
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

  // Show inbox if there's at least one enabled connection (active or error — not revoked)
  const enabledConnections = connections.filter(
    (c) => c.status !== 'revoked' && c.isEnabled !== false,
  )

  const {
    threads,
    loading: threadsLoading,
    error: threadsError,
    refresh: refreshThreads,
    setThreadReadState,
    setThreadPinState,
  } = useThreads({ view, search, connectionId })

  const {
    detail,
    loading: detailLoading,
    saving,
    refresh: refreshDetail,
    patch,
    reply,
    addNote,
    markUnread,
  } = useThreadDetail(selectedThreadId)

  const handleSelectThread = useCallback(
    (id: number) => {
      // Optimistic: clear the unread dot in the list as soon as the user
      // clicks. The detail hook then fires the server-side mark-read call
      // silently. If anything fails the next 30s poll reconciles state.
      setThreadReadState(id, false)
      const base = channelId
        ? `/support/inbox/ch/${channelId}/${queue ?? 'all'}`
        : `/support/inbox/${queue ?? 'all'}`
      navigate(`${base}/t/${id}`)
    },
    [channelId, queue, navigate, setThreadReadState],
  )

  const handleMarkUnread = useCallback(async () => {
    if (selectedThreadId == null) return
    setThreadReadState(selectedThreadId, true)
    try {
      await markUnread()
    } catch {
      // Roll back optimistic list update if the server rejected the change.
      setThreadReadState(selectedThreadId, false)
    }
  }, [selectedThreadId, markUnread, setThreadReadState])

  // Handlers triggered from the indicator dropdown on a list row. They keep
  // the list state in sync without forcing a full reload, mirroring the modern
  // pattern in HelpScout / Linear.
  const handleListMarkRead = useCallback(
    async (id: number) => {
      if (!token) return
      setThreadReadState(id, false)
      try {
        await apiMarkThreadRead(token, id)
      } catch {
        setThreadReadState(id, true)
      }
    },
    [token, setThreadReadState],
  )

  const handleListMarkUnread = useCallback(
    async (id: number) => {
      if (!token) return
      setThreadReadState(id, true)
      try {
        await apiMarkThreadUnread(token, id)
      } catch {
        setThreadReadState(id, false)
      }
    },
    [token, setThreadReadState],
  )

  const handleListTogglePin = useCallback(
    async (id: number, currentPinned: boolean) => {
      if (!token) return
      const next = !currentPinned
      setThreadPinState(id, next)
      try {
        if (next) {
          await apiPinThread(token, id)
        } else {
          await apiUnpinThread(token, id)
        }
      } catch {
        setThreadPinState(id, currentPinned)
      }
    },
    [token, setThreadPinState],
  )

  // Canonical URL redirect: if the loaded thread no longer fits the queue or
  // channel context in the URL (e.g. it has been closed since the URL was
  // shared), silently replace the URL with the canonical one so the thread is
  // always reachable. Uses `replace: true` so history is not polluted.
  //
  // This redirect must fire only on the FIRST load of a given threadId in
  // this session. Once the user is reading the thread, any in-session patch
  // (close / pending / reassign) must keep the thread visible at the current
  // URL, without auto-redirecting it to the canonical queue. The list refresh
  // below makes the thread vanish from the list instead.
  const redirectCheckedForThreadRef = useRef<number | null>(null)
  useEffect(() => {
    if (selectedThreadId == null) {
      redirectCheckedForThreadRef.current = null
      return
    }
    if (!detail) return
    if (detail.thread.id !== selectedThreadId) return
    if (redirectCheckedForThreadRef.current === selectedThreadId) return

    // Mark as handled even when we don't actually redirect, so subsequent
    // detail updates from patches/replies don't re-evaluate the URL.
    redirectCheckedForThreadRef.current = selectedThreadId

    const thread = detail.thread
    const fits = isThreadInQueue(thread, view, currentUserId)
    const channelMatches = !connectionId || connectionId === thread.emailConnectionId
    if (fits && channelMatches) return
    const canonical = getCanonicalView(thread)
    const targetQueueSegment = VIEW_TO_QUEUE[canonical]
    const targetChannelId = channelMatches ? channelId : null
    const base = targetChannelId
      ? `/support/inbox/ch/${targetChannelId}/${targetQueueSegment}`
      : `/support/inbox/${targetQueueSegment}`
    navigate(`${base}/t/${thread.id}`, { replace: true })
  }, [detail, selectedThreadId, view, channelId, connectionId, currentUserId, navigate])

  // After any mutation on the open thread, refresh the list query so the
  // thread disappears from its previous queue (or gets re-sorted) without
  // touching the detail-pane URL.
  const handlePatch = useCallback(
    async (input: PatchThreadInput) => {
      await patch(input)
      void refreshThreads()
    },
    [patch, refreshThreads],
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
    <div className="flex h-full overflow-hidden rounded-md">
      <ThreadList
        threads={threads}
        loading={threadsLoading}
        error={threadsError}
        selectedId={selectedThreadId}
        search={search}
        onSelectThread={handleSelectThread}
        onSearchChange={setSearch}
        onMarkRead={handleListMarkRead}
        onMarkUnread={handleListMarkUnread}
        onTogglePin={handleListTogglePin}
      />
      <ThreadDetail
        detail={detail}
        loading={detailLoading}
        saving={saving}
        onPatch={handlePatch}
        onReply={handleReply}
        onNote={handleNote}
        onRefresh={refreshDetail}
        onMarkUnread={handleMarkUnread}
        onToggleContact={detail ? toggleContactPanel : undefined}
        contactOpen={showContactPanel}
      />
      {detail && showContactPanel ? (
        <ContactPanel thread={detail.thread} onClose={toggleContactPanel} />
      ) : null}
    </div>
  )
}
