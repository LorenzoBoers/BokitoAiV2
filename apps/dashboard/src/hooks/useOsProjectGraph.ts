import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { getCanvasGraph, type OsCanvasGraph } from '../lib/os-api'

/** @deprecated Project-scoped graph removed; use useOsGraph for workspace canvas. */
export function useOsProjectGraph(_projectId: string | undefined, pollMs = 0) {
  const { token } = useAuth()
  const [graph, setGraph] = useState<OsCanvasGraph | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [degraded, setDegraded] = useState(false)
  const initialLoad = useRef(true)

  const refresh = useCallback(async () => {
    if (!token) return
    const showSpinner = initialLoad.current
    if (showSpinner) setLoading(true)
    setError(null)
    try {
      const result = await getCanvasGraph(token)
      setGraph(result.graph)
      setDegraded(result.degraded)
    } catch (err) {
      setError(formatApiErrorMessage(err))
    } finally {
      if (showSpinner) {
        initialLoad.current = false
        setLoading(false)
      }
    }
  }, [token])

  useEffect(() => {
    initialLoad.current = true
    setLoading(true)
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!token || pollMs <= 0) return
    const id = window.setInterval(() => void refresh(), pollMs)
    return () => window.clearInterval(id)
  }, [refresh, pollMs, token])

  return { graph, loading, error, degraded, refresh }
}
