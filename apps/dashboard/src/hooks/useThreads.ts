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

  return { threads, loading, error, total, refresh: fetchThreads }
}
