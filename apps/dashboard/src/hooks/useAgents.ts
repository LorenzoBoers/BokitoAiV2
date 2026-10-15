import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { listAgents } from '../lib/agents-api'
import type { RuntimeAgent } from '../lib/workforce-api'

let cache: RuntimeAgent[] | null = null
let inflight: Promise<RuntimeAgent[]> | null = null
const listeners = new Set<(rows: RuntimeAgent[]) => void>()

function publish(rows: RuntimeAgent[]) {
  cache = rows
  for (const listener of listeners) listener(rows)
}

/** Drop the shared catalog so the next fetch picks up identity edits. */
export function invalidateAgentsCache(): void {
  cache = null
  inflight = null
}

/** Refetch agents and push the new catalog to every mounted consumer. */
export async function reloadAgentsCache(): Promise<RuntimeAgent[]> {
  invalidateAgentsCache()
  const rows = await listAgents()
  publish(rows)
  return rows
}

function ensureFetch(): Promise<RuntimeAgent[]> {
  if (cache) return Promise.resolve(cache)
  inflight ??= listAgents()
    .then((rows) => {
      publish(rows)
      return rows
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Workspace agents for avatars and pickers. One fetch is shared across mounts. */
export function useAgents(): { agents: RuntimeAgent[]; loading: boolean; refresh: () => void } {
  const { token } = useAuth()
  const [agents, setAgents] = useState<RuntimeAgent[]>(cache ?? [])
  const [loading, setLoading] = useState(!cache)

  useEffect(() => {
    if (!token) return
    const onUpdate = (rows: RuntimeAgent[]) => {
      setAgents(rows)
      setLoading(false)
    }
    listeners.add(onUpdate)
    if (cache) {
      setAgents(cache)
      setLoading(false)
    } else {
      setLoading(true)
      void ensureFetch().catch(() => setLoading(false))
    }
    return () => {
      listeners.delete(onUpdate)
    }
  }, [token])

  return {
    agents,
    loading,
    refresh: () => {
      void reloadAgentsCache().catch(() => setLoading(false))
    },
  }
}
