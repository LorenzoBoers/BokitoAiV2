import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { getLlmRuntime, type LlmRuntimeStatus } from '../lib/models-api'

const EMPTY: LlmRuntimeStatus = {
  live: false,
  mode: 'mock',
  keySource: 'mock',
  slug: '',
}

/** Shared live/mock LLM truth for workspace banners and Govern Autonoom. */
export function useLlmRuntime() {
  const { token, user, isLoading: authLoading } = useAuth()
  const [runtime, setRuntime] = useState<LlmRuntimeStatus>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!token || authLoading) {
      if (!token) setRuntime(EMPTY)
      return
    }
    if (!user?.organisationId) {
      setRuntime(EMPTY)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setRuntime(await getLlmRuntime(token))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load AI runtime status.')
      setRuntime(EMPTY)
    } finally {
      setLoading(false)
    }
  }, [token, user?.organisationId, authLoading])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    ...runtime,
    loading: loading || (Boolean(token) && authLoading),
    error,
    refresh,
  }
}
