import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { listThreads, type InboxThread, type ThreadFilters, type ThreadId } from '../lib/inbox-api'
import { onGatewayEvent } from '../lib/gateway'

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
  ].join('\0')
}

export function useThreads(
  filters: ThreadFilters = {},
  pinnedIds: ThreadId[] = [],
  // Slow fallback poll; live updates arrive over the gateway WS.
  pollMs = 90000,
) {
  const { token } = useAuth()
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
  ])

  const [rawThreads, setRawThreads] = useState<InboxThread[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [syncedFilterKey, setSyncedFilterKey] = useState<string | null>(null)

  // Drop stale rows synchronously when queue/search/channel changes so callers
  // never auto-select from the previous folder while the new fetch is in flight.
  useLayoutEffect(() => {
    setRawThreads([])
    setSyncedFilterKey(null)
    setLoading(true)
    setError(null)
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
      const result = await listThreads(token, filters)
      setRawThreads(result.items)
      setTotal(result.itemsTotal)
      setSyncedFilterKey(keyAtStart)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load threads.')
      setRawThreads([])
      setSyncedFilterKey(keyAtStart)
    } finally {
      setLoading(false)
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
  ])

  useEffect(() => {
    void fetchThreads()
  }, [fetchThreads])

  useEffect(() => {
    if (!token) return
    const timer = window.setInterval(() => {
      void fetchThreads()
    }, pollMs)
    return () => window.clearInterval(timer)
  }, [token, pollMs, fetchThreads])

  // Live refresh on gateway thread/message events (debounced).
  useEffect(() => {
    if (!token) return
    let debounceTimer: number | null = null
    const unsubscribe = onGatewayEvent('threads', () => {
      if (debounceTimer !== null) return
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null
        void fetchThreads()
      }, 800)
    })
    return () => {
      unsubscribe()
      if (debounceTimer !== null) window.clearTimeout(debounceTimer)
    }
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
    threadsReady,
    error,
    total,
    refresh: fetchThreads,
    setThreadReadState,
    removeThread,
  }
}
