import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { listAgents } from '../lib/agents-api'
import type { RuntimeAgent } from '../lib/workforce-api'

let cache: RuntimeAgent[] | null = null
let inflight: Promise<RuntimeAgent[]> | null = null

/** Workspace agents for avatars and pickers. One fetch is shared across mounts. */
export function useAgents(): { agents: RuntimeAgent[]; loading: boolean } {
  const { token } = useAuth()
  const [agents, setAgents] = useState<RuntimeAgent[]>(cache ?? [])
  const [loading, setLoading] = useState(!cache)

  useEffect(() => {
    if (!token) return
    if (cache) {
      setAgents(cache)
      setLoading(false)
      return
    }
    inflight ??= listAgents()
      .then((rows) => {
        cache = rows
        return rows
      })
      .finally(() => {
        inflight = null
      })
    let cancelled = false
    inflight
      .then((rows) => {
        if (!cancelled) {
          setAgents(rows)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  return { agents, loading }
}
