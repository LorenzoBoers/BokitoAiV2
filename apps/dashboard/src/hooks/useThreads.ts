import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { listThreads, type InboxThread, type ThreadFilters } from '../lib/inbox-api'

export function useThreads(
  filters: ThreadFilters = {},
  pinnedIds: number[] = [],
  pollMs = 30000,
) {
  const { token } = useAuth()
  const [rawThreads, setRawThreads] = useState<InboxThread[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [total, setTotal] = useState<number | null>(null)

  const fetchThreads = useCallback(async () => {
    if (!token) {
      setRawThreads([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await listThreads(token, filters)
      setRawThreads(result.items)
      setTotal(result.itemsTotal)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kon threads niet laden.')
      setRawThreads([])
    } finally {
      setLoading(false)
    }
  }, [token, filters.view, filters.tag, filters.assigneeId, filters.search, filters.page, filters.perPage, filters.connectionId])

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

  // Decorate every fetched thread with isPinned (client-side join with the
  // user's pinned thread IDs) and sort pinned threads to the top of the
  // current page. Within each group the list keeps the server-side order
  // (last_message_at DESC).
  const threads = useMemo<InboxThread[]>(() => {
    const pinSet = new Set(pinnedIds)
    const decorated = rawThreads.map((t) => ({ ...t, isPinned: pinSet.has(t.id) }))
    const toMillis = (iso: string | null) => (iso ? new Date(iso).getTime() : 0)
    return [...decorated].sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
      return toMillis(b.lastMessageAt) - toMillis(a.lastMessageAt)
    })
  }, [rawThreads, pinnedIds])

  // Optimistic read/unread state update for the in-memory list. Lets the UI
  // toggle the unread dot instantly when a user opens a thread or manually
  // flips it back to unread, without waiting for the next poll.
  const setThreadReadState = useCallback((threadId: number, hasUnread: boolean) => {
    setRawThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, hasUnread } : t)))
  }, [])

  return { threads, loading, error, total, refresh: fetchThreads, setThreadReadState }
}
