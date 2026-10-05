import type { GatewayEvent } from '../lib/gateway'
import { applyLive, getLive, listLiveEntries, useLiveEntity, __resetLiveStoreForTests } from '../lib/live-store'
import type { AgentPresenceStatus } from '../lib/teams-api'

const TABLE = 'agent_live'

export type AgentLiveSnapshot = {
  status: AgentPresenceStatus
  summary: string | null
  threadId: string | null
  activityId: string | null
  lastActiveAt: number | null
  source: 'rest' | 'ws'
}

export type AgentLiveSeed = {
  id: string
  status?: string | null
  current_activity_id?: string | null
  current_activity_summary?: string | null
  current_thread_id?: string | null
  last_active_at?: number | string | null
  summary?: string | null
  threadId?: string | null
  activityId?: string | null
}

function parseStatus(raw: string | null | undefined, activityId?: string | null): AgentPresenceStatus {
  const value = String(raw || '').trim().toLowerCase()
  if (value === 'working') return 'working'
  if (value === 'error') return 'error'
  if (activityId) return 'working'
  return 'standby'
}

function asEpochMs(value: number | string | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function snapshotFromSeed(row: AgentLiveSeed): AgentLiveSnapshot {
  const activityId = row.current_activity_id ?? row.activityId ?? null
  const summary = (row.current_activity_summary ?? row.summary ?? '').trim() || null
  const threadId = row.current_thread_id ?? row.threadId ?? null
  return {
    status: parseStatus(row.status, activityId),
    summary,
    threadId,
    activityId,
    lastActiveAt: asEpochMs(row.last_active_at),
    source: 'rest',
  }
}

function snapshotFromEvent(data: Record<string, unknown>): AgentLiveSnapshot | null {
  const agentId = typeof data.agent_id === 'string' ? data.agent_id : ''
  if (!agentId) return null
  const activityId = typeof data.activity_id === 'string' ? data.activity_id : null
  const summary = typeof data.summary === 'string' ? data.summary.trim() || null : null
  const threadId = typeof data.thread_id === 'string' ? data.thread_id : null
  return {
    status: parseStatus(typeof data.status === 'string' ? data.status : null, activityId),
    summary,
    threadId,
    activityId,
    lastActiveAt: asEpochMs(typeof data.last_active_at === 'number' ? data.last_active_at : null),
    source: 'ws',
  }
}

export function applyAgentPresence(agentId: string, status: AgentPresenceStatus) {
  applyLive<AgentLiveSnapshot>(TABLE, agentId, (prev) => ({
    status,
    summary: status === 'working' ? prev?.summary ?? null : null,
    threadId: status === 'working' ? prev?.threadId ?? null : null,
    activityId: status === 'working' ? prev?.activityId ?? null : null,
    lastActiveAt: prev?.lastActiveAt ?? Date.now(),
    source: 'ws',
  }))
}

export function applyAgentLive(agentId: string, snap: AgentLiveSnapshot) {
  applyLive<AgentLiveSnapshot>(TABLE, agentId, snap)
}

function sameSnapshot(a: AgentLiveSnapshot, b: AgentLiveSnapshot): boolean {
  return (
    a.status === b.status &&
    a.summary === b.summary &&
    a.threadId === b.threadId &&
    a.activityId === b.activityId &&
    a.lastActiveAt === b.lastActiveAt
  )
}

/** REST seed never overwrites a live working snapshot with a lagging standby. */
export function seedAgentPresence(entries: Iterable<AgentLiveSeed>) {
  for (const row of entries) {
    if (!row.id) continue
    const next = snapshotFromSeed(row)
    applyLive<AgentLiveSnapshot>(TABLE, row.id, (prev) => {
      if (prev?.source === 'ws' && prev.status === 'working' && next.status === 'standby') return prev
      const merged: AgentLiveSnapshot = {
        status: next.status,
        summary: next.summary ?? (next.status === 'working' ? prev?.summary ?? null : null),
        threadId: next.threadId ?? (next.status === 'working' ? prev?.threadId ?? null : null),
        activityId: next.activityId ?? (next.status === 'working' ? prev?.activityId ?? null : null),
        lastActiveAt: next.lastActiveAt ?? prev?.lastActiveAt ?? null,
        source: prev?.source === 'ws' ? 'ws' : 'rest',
      }
      return prev && sameSnapshot(prev, merged) ? prev : merged
    })
  }
}

/** While the socket is down a REST seed may overwrite live rows again. */
export function markAgentLiveRest() {
  for (const [id, snap] of listLiveEntries<AgentLiveSnapshot>(TABLE)) {
    if (snap.source === 'ws') applyLive<AgentLiveSnapshot>(TABLE, id, { ...snap, source: 'rest' })
  }
}

export function agentLiveOf(agentId: string | null | undefined): AgentLiveSnapshot | null {
  return getLive<AgentLiveSnapshot>(TABLE, agentId)
}

export function agentPresenceOf(agentId: string | null | undefined): AgentPresenceStatus {
  return agentLiveOf(agentId)?.status ?? 'standby'
}

export function withAgentLive<T extends { id: string }>(agent: T): T {
  const live = agentLiveOf(agent.id)
  if (!live) return agent
  return {
    ...agent,
    status: live.status,
    current_activity_id: live.activityId,
    current_activity_summary: live.summary,
    current_thread_id: live.threadId,
    last_active_at: live.lastActiveAt ?? (agent as { last_active_at?: number | null }).last_active_at,
  }
}

/** `agent.status` on the presence and agents topics; fed by the shell live bus. */
export function ingestAgentStatus(event: GatewayEvent) {
  if (event.event !== 'agent.status') return
  const data = (event.data ?? {}) as Record<string, unknown>
  const agentId = typeof data.agent_id === 'string' ? data.agent_id : ''
  const snap = snapshotFromEvent(data)
  if (!agentId || !snap) return
  applyAgentLive(agentId, snap)
}

export function useAgentLive(agentId?: string | null): AgentLiveSnapshot | null {
  return useLiveEntity<AgentLiveSnapshot>(TABLE, agentId)
}

export function useAgentPresence(agentId?: string | null): AgentPresenceStatus {
  return useAgentLive(agentId)?.status ?? 'standby'
}

export function __resetAgentLiveForTests() {
  __resetLiveStoreForTests()
}
