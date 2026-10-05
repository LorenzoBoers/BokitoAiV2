import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { getLive, isLiveSeeded, seedLive, useEntityRefresh, useLiveList, useLiveVersion } from '../lib/live-store'
import { listTeams, type PresenceStatus, type Team } from '../lib/teams-api'
import type { InboxMember } from '../lib/inbox-api'
import { agentLiveOf } from './useAgentPresence'
import { useMembers } from './useMembers'

const TABLE = 'team'

let inflight: Promise<Team[]> | null = null

function fetchTeams(token: string): Promise<Team[]> {
  inflight ??= listTeams(token)
    .then((rows) => {
      seedLive(TABLE, rows, (team) => team.id)
      return rows
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

const RANK: Record<PresenceStatus, number> = { available: 4, working: 3, away: 2, standby: 1, offline: 0 }

/**
 * Team corner status from live people presence and live agent status, so an
 * agent starting work lights its team without refetching every team.
 * Mirrors `services/presence.team_status` (available > working > away > standby > offline).
 */
export function liveTeamPresence(team: Team): PresenceStatus | undefined {
  const server = team.presence?.status
  let known = false
  let best: PresenceStatus = 'offline'
  for (const ref of team.members) {
    let status: PresenceStatus | null = null
    if (ref.kind === 'user') {
      const member = getLive<InboxMember>('member', ref.id)
      if (member) status = member.presence === 'available' || member.presence === 'away' ? member.presence : 'offline'
    } else {
      const live = agentLiveOf(ref.id)
      if (live) status = live.status === 'working' ? 'working' : 'standby'
    }
    if (!status) continue
    known = true
    if (RANK[status] > RANK[best]) best = status
  }
  return known ? best : server
}

/** Workspace teams (system teams first); refetches when a team changes anywhere. */
export function useTeams(): { teams: Team[]; loading: boolean } {
  const { token } = useAuth()
  const rows = useLiveList<Team>(TABLE)
  const [loading, setLoading] = useState(!isLiveSeeded(TABLE))
  useMembers()
  const memberVersion = useLiveVersion('member')
  const agentVersion = useLiveVersion('agent_live')

  const refresh = useCallback(() => {
    if (!token) return
    fetchTeams(token)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => {
    if (!token) return
    if (isLiveSeeded(TABLE)) {
      setLoading(false)
      return
    }
    refresh()
  }, [token, refresh])

  useEntityRefresh(['team'], refresh)

  const teams = useMemo(
    () =>
      rows.map((team) => {
        const status = liveTeamPresence(team)
        return status && status !== team.presence?.status ? { ...team, presence: { status } } : team
      }),
    // memberVersion / agentVersion re-derive presence when either live table moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, memberVersion, agentVersion],
  )

  return { teams, loading }
}
