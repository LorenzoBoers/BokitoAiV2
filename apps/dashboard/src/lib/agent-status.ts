import type { RuntimeAgent } from './workforce-api'
import type { AgentPresenceStatus } from './teams-api'

export type AgentWorkState = 'working' | 'ready' | 'error'

/** Idle (`standby`) is ready. Archive removes agents from the library. */
export function agentWorkState(
  agent: Pick<RuntimeAgent, 'status' | 'is_active'> &
    Partial<Pick<RuntimeAgent, 'current_activity_id'>>,
): AgentWorkState {
  if (agent.status === 'error') return 'error'
  if (agent.status === 'active' || agent.current_activity_id) return 'working'
  return 'ready'
}

/** Avatar corner: standby (static purple) or working (pulse). */
export function agentCornerStatus(
  agent: Pick<RuntimeAgent, 'status' | 'is_active'> &
    Partial<Pick<RuntimeAgent, 'current_activity_id'>> & { status?: string | null },
): AgentPresenceStatus {
  const raw = String(agent.status || '').trim().toLowerCase()
  if (raw === 'error') return 'error'
  if (raw === 'working' || raw === 'active' || agent.current_activity_id) return 'working'
  return 'standby'
}

export function agentStatusI18nKey(state: AgentWorkState): string {
  switch (state) {
    case 'working':
      return 'workforce.agents.status.active'
    case 'ready':
      return 'workforce.agents.status.standby'
    case 'error':
      return 'workforce.agents.status.error'
  }
}
