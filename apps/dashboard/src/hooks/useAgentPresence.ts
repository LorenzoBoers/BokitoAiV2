import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { onGatewayEvent } from '../lib/gateway'
import type { AgentPresenceStatus } from '../lib/teams-api'

/** Live agent corner status keyed by agent id (from REST + `agent.status` WS). */
const cache = new Map<string, AgentPresenceStatus>()
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

export function applyAgentPresence(agentId: string, status: AgentPresenceStatus) {
  cache.set(agentId, status)
  notify()
}

export function seedAgentPresence(entries: Iterable<{ id: string; status?: string | null }>) {
  for (const row of entries) {
    const raw = String(row.status || '').trim().toLowerCase()
    if (raw === 'working' || raw === 'active') cache.set(row.id, 'working')
    else if (raw === 'error') cache.set(row.id, 'error')
    else cache.set(row.id, 'standby')
  }
  notify()
}

export function agentPresenceOf(agentId: string | null | undefined): AgentPresenceStatus {
  if (!agentId) return 'standby'
  return cache.get(agentId) ?? 'standby'
}

/** Subscribe to agent.status gateway events and a local presence map. */
export function useAgentPresence(agentId?: string | null): AgentPresenceStatus {
  const { token } = useAuth()
  const [, bump] = useState(0)

  useEffect(() => {
    const onChange = () => bump((n) => n + 1)
    listeners.add(onChange)
    return () => {
      listeners.delete(onChange)
    }
  }, [])

  useEffect(() => {
    if (!token) return
    return onGatewayEvent('presence', (event) => {
      if (event.event !== 'agent.status') return
      const data = (event.data ?? {}) as { agent_id?: string; status?: string }
      if (!data.agent_id) return
      const raw = String(data.status || '').trim().toLowerCase()
      const status: AgentPresenceStatus =
        raw === 'working' || raw === 'active' ? 'working' : raw === 'error' ? 'error' : 'standby'
      applyAgentPresence(data.agent_id, status)
    })
  }, [token])

  return agentId ? agentPresenceOf(agentId) : 'standby'
}
