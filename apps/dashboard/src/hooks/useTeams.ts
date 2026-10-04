import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { onGatewayEvent } from '../lib/gateway'
import { listTeams, TEAMS_CHANGED_EVENT, type Team } from '../lib/teams-api'

// Shared across the sidebar and every decision card; dropped when a team changes.
let cache: Team[] | null = null
let inflight: Promise<Team[]> | null = null

function fetchTeams(token: string): Promise<Team[]> {
  inflight ??= listTeams(token)
    .then((rows) => {
      cache = rows
      return rows
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Workspace teams (system teams first); refetches when a team is saved elsewhere. */
export function useTeams(): { teams: Team[]; loading: boolean } {
  const { token } = useAuth()
  const [teams, setTeams] = useState<Team[]>(cache ?? [])
  const [loading, setLoading] = useState(cache === null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    const load = (fresh: boolean) => {
      if (fresh) cache = null
      if (cache) {
        setTeams(cache)
        setLoading(false)
        return
      }
      fetchTeams(token)
        .then((rows) => {
          if (!cancelled) setTeams(rows)
        })
        .catch(() => {
          if (!cancelled) setTeams([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }
    const onChanged = () => load(true)
    load(false)
    window.addEventListener(TEAMS_CHANGED_EVENT, onChanged)
    const offAgent = onGatewayEvent('presence', (event) => {
      if (event.event === 'agent.status') load(true)
    })
    return () => {
      cancelled = true
      window.removeEventListener(TEAMS_CHANGED_EVENT, onChanged)
      offAgent()
    }
  }, [token])

  return { teams, loading }
}
