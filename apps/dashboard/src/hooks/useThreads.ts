import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { listThreads, type InboxThread, type ThreadFilters } from '../lib/inbox-api'

export function useThreads(filters: ThreadFilters = {}, pollMs = 30000) {
  const { token } = useAuth()
  const [threads, setThreads] = useState<InboxThread[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [total, setTotal] = useState<number | null>(null)

  const fetchThreads = useCallback(async () => {
    if (!token) {
      setThreads([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await listThreads(token, filters)
      setThreads(result.items)
      setTotal(result.itemsTotal)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kon threads niet laden.')
      setThreads([])
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

  // Optimistic read/unread state update for the in-memory list. Lets the UI
  // toggle the unread dot instantly when a user opens a thread or manually
  // flips it back to unread, without waiting for the next poll.
  const setThreadReadState = useCallback((threadId: number, hasUnread: boolean) => {
    setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, hasUnread } : t)))
  }, [])

  // Optimistic pin state update. Re-sorts the list so pinned threads bubble to
  // the top within the current queue, mirroring the server-side sort order.
  // This keeps the UI snappy when a user toggles the pin from the dropdown.
  const setThreadPinState = useCallback((threadId: number, isPinned: boolean) => {
    setThreads((prev) => {
      const updated = prev.map((t) => (t.id === threadId ? { ...t, isPinned } : t))
      const toMillis = (iso: string | null) => (iso ? new Date(iso).getTime() : 0)
      return [...updated].sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
        return toMillis(b.lastMessageAt) - toMillis(a.lastMessageAt)
      })
    })
  }, [])

  return { threads, loading, error, total, refresh: fetchThreads, setThreadReadState, setThreadPinState }
}
