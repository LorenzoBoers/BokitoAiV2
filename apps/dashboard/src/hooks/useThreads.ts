import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { listThreads, type InboxThread, type ThreadFilters, type ThreadId } from '../lib/inbox-api'
import { onGatewayEvent, onGatewayStatus, type GatewayStatus } from '../lib/gateway'
import { extractLiveThreadRow, threadMatchesFilters, upsertThreadRow } from '../lib/thread-live'

const PAGE_SIZE = 30

function buildFilterKey(filters: ThreadFilters): string {
  return [
    filters.view ?? '',
    filters.folder ?? '',
    filters.channel ?? '',
    filters.projectId ?? '',
    filters.tag ?? '',
    String(filters.assigneeId ?? ''),
    filters.search ?? '',
    String(filters.page ?? ''),
    String(filters.perPage ?? ''),
    String(filters.connectionId ?? ''),
    filters.agentId ?? '',
    filters.unread ? '1' : '',
    filters.needsReply ? '1' : '',
    filters.needsDecision ? '1' : '',
    filters.pinnedOnly ? '1' : '',
  ].join('\0')
}

export function useThreads(
  filters: ThreadFilters = {},
  pinnedIds: ThreadId[] = [],
  // Slow fallback poll; live updates arrive over the gateway WS.
  pollMs = 90000,
) {
  const { token, user } = useAuth()
  const filterKey = useMemo(() => buildFilterKey(filters), [
    filters.view,
    filters.folder,
    filters.channel,
    filters.projectId,
    filters.tag,
    filters.assigneeId,
    filters.search,
    filters.page,
    filters.perPage,
    filters.connectionId,
    filters.agentId,
    filters.unread,
    filters.needsReply,
    filters.needsDecision,
    filters.pinnedOnly,
  ])

  const [rawThreads, setRawThreads] = useState<InboxThread[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [syncedFilterKey, setSyncedFilterKey] = useState<string | null>(null)
  // Pages the user has explicitly loaded via loadMore (reset on filter change).
  const pagesLoadedRef = useRef(1)
  const filterKeyRef = useRef(filterKey)
  filterKeyRef.current = filterKey

  // Drop stale rows synchronously when queue/search/channel changes so callers
  // never auto-select from the previous folder while the new fetch is in flight.
  useLayoutEffect(() => {
    setRawThreads([])
    setSyncedFilterKey(null)
    setLoading(true)
    setError(null)
    setHasMore(false)
    pagesLoadedRef.current = 1
  }, [filterKey])

  const fetchThreads = useCallback(async () => {
    if (!token) {
      setRawThreads([])
      setSyncedFilterKey(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const keyAtStart = filterKey
    try {
      const result = await listThreads(token, { ...filters, page: 1, perPage: PAGE_SIZE })
      if (keyAtStart !== filterKeyRef.current) return
      setTotal(result.itemsTotal)
      setSyncedFilterKey(keyAtStart)
      if (pagesLoadedRef.current <= 1) {
        setRawThreads(result.items)
        setHasMore(result.nextPage != null)
      } else {
        // Poll/gateway refresh while extra pages are loaded: merge page 1 into
        // the accumulated list (fresh rows win) instead of truncating it.
        setRawThreads((prev) => {
          const freshIds = new Set(result.items.map((t) => String(t.id)))
          return [...result.items, ...prev.filter((t) => !freshIds.has(String(t.id)))]
        })
      }
    } catch (err) {
      if (keyAtStart !== filterKeyRef.current) return
      setError(err instanceof Error ? err.message : 'Could not load threads.')
      setRawThreads([])
      setSyncedFilterKey(keyAtStart)
    } finally {
      if (keyAtStart === filterKeyRef.current) setLoading(false)
    }
  }, [
    token,
    filterKey,
    filters.view,
    filters.folder,
    filters.channel,
    filters.projectId,
    filters.tag,
    filters.assigneeId,
    filters.search,
    filters.page,
    filters.perPage,
    filters.connectionId,
    filters.agentId,
    filters.unread,
    filters.needsReply,
    filters.needsDecision,
    filters.pinnedOnly,
  ])

  useEffect(() => {
    void fetchThreads()
  }, [fetchThreads])

  const loadMore = useCallback(async () => {
    if (!token || loadingMore) return
    setLoadingMore(true)
    try {
      const nextPage = pagesLoadedRef.current + 1
      const result = await listThreads(token, { ...filters, page: nextPage, perPage: PAGE_SIZE })
      pagesLoadedRef.current = nextPage
      setTotal(result.itemsTotal)
      setHasMore(result.nextPage != null)
      setRawThreads((prev) => {
        const known = new Set(prev.map((t) => String(t.id)))
        return [...prev, ...result.items.filter((t) => !known.has(String(t.id)))]
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load threads.')
    } finally {
      setLoadingMore(false)
    }
  }, [
    token,
    loadingMore,
    filterKey,
    filters.view,
    filters.folder,
    filters.channel,
    filters.projectId,
    filters.tag,
    filters.assigneeId,
    filters.search,
    filters.connectionId,
    filters.agentId,
  ])

  useEffect(() => {
    if (!token) return
    const timer = window.setInterval(() => {
      void fetchThreads()
    }, pollMs)
    return () => window.clearInterval(timer)
  }, [token, pollMs, fetchThreads])

  // Mirror the latest list and filters into refs so the (stable) gateway
  // handler can read current state without resubscribing on every render.
  const rawThreadsRef = useRef<InboxThread[]>([])
  useEffect(() => {
    rawThreadsRef.current = rawThreads
  }, [rawThreads])
  const filtersRef = useRef(filters)
  useEffect(() => {
    filtersRef.current = filters
  })
  const currentUserId = user?.id ?? null

  // Live inbox: gateway `message`/`thread` events carry the canonical thread
  // row, so matching rows upsert straight into the list. Events we cannot
  // apply locally (decision events, old payload shape, filters that need a
  // server-side join) fall back to a debounced refetch.
  useEffect(() => {
    if (!token) return
    let debounceTimer: number | null = null
    const scheduleRefetch = () => {
      if (debounceTimer !== null) return
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null
        void fetchThreads()
      }, 800)
    }
    const unsubscribe = onGatewayEvent('threads', (event) => {
      if (event.event !== 'message' && event.event !== 'thread') {
        scheduleRefetch()
        return
      }
      const row = extractLiveThreadRow(event)
      if (!row) {
        scheduleRefetch()
        return
      }
      const match = threadMatchesFilters(row, filtersRef.current, currentUserId)
      if (match === null) {
        scheduleRefetch()
        return
      }
      const id = String(row.id)
      const exists = rawThreadsRef.current.some((t) => String(t.id) === id)
      if (match) {
        setRawThreads((prev) => upsertThreadRow(prev, row))
        if (!exists) setTotal((prev) => (prev != null ? prev + 1 : prev))
      } else if (exists) {
        // Thread moved out of this queue (closed, reassigned, retagged).
        setRawThreads((prev) => prev.filter((t) => String(t.id) !== id))
        setTotal((prev) => (prev != null && prev > 0 ? prev - 1 : prev))
      }
    })
    return () => {
      unsubscribe()
      if (debounceTimer !== null) window.clearTimeout(debounceTimer)
    }
  }, [token, fetchThreads, currentUserId])

  // Reconcile after a gateway reconnect: events published while the socket
  // was down were missed, so pull an authoritative page. The subscribe
  // callback fires immediately with the current status; only a real
  // disconnect -> (connecting ->) connected cycle triggers the refetch.
  useEffect(() => {
    if (!token) return
    let sawDisconnect = false
    const unsubscribe = onGatewayStatus((status: GatewayStatus) => {
      if (status === 'disconnected') {
        sawDisconnect = true
      } else if (status === 'connected' && sawDisconnect) {
        sawDisconnect = false
        void fetchThreads()
      }
    })
    return () => unsubscribe()
  }, [token, fetchThreads])

  // Decorate every fetched thread with isPinned (client-side join with the
  // user's pinned thread IDs) and sort pinned threads to the top of the
  // current page. Within each group the list keeps the server-side order
  // (last_message_at DESC).
  const threads = useMemo<InboxThread[]>(() => {
    const pinSet = new Set(pinnedIds.map((id) => String(id)))
    const decorated = rawThreads.map((t) => ({ ...t, isPinned: pinSet.has(String(t.id)) }))
    const toMillis = (iso: string | null) => (iso ? new Date(iso).getTime() : 0)
    return [...decorated].sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
      return toMillis(b.lastMessageAt) - toMillis(a.lastMessageAt)
    })
  }, [rawThreads, pinnedIds])

  const threadsReady = syncedFilterKey === filterKey && !loading

  // Optimistic read/unread state update for the in-memory list. Lets the UI
  // toggle the unread dot instantly when a user opens a thread or manually
  // flips it back to unread, without waiting for the next poll.
  const setThreadReadState = useCallback((threadId: ThreadId, hasUnread: boolean) => {
    setRawThreads((prev) =>
      prev.map((t) => (String(t.id) === String(threadId) ? { ...t, hasUnread } : t)),
    )
  }, [])

  const removeThread = useCallback((threadId: ThreadId) => {
    setRawThreads((prev) => prev.filter((t) => String(t.id) !== String(threadId)))
    setTotal((prev) => (prev != null && prev > 0 ? prev - 1 : prev))
  }, [])

  return {
    threads,
    loading,
    loadingMore,
    threadsReady,
    error,
    total,
    hasMore,
    loadMore,
    refresh: fetchThreads,
    setThreadReadState,
    removeThread,
  }
}
