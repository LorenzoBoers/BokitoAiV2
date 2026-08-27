import type { RuntimeAgent } from './workforce-api'

export type AgentWorkState = 'working' | 'ready' | 'paused' | 'error'

/** Idle (`standby`) is ready. Only an explicit pause (`sleeping` / inactive) is paused. */
export function agentWorkState(
  agent: Pick<RuntimeAgent, 'status' | 'is_active' | 'current_activity_id'>,
): AgentWorkState {
  if (agent.status === 'error') return 'error'
  if (agent.is_active === false || agent.status === 'sleeping') return 'paused'
  if (agent.status === 'active' && agent.current_activity_id) return 'working'
  return 'ready'
}

export function agentStatusI18nKey(state: AgentWorkState): string {
  switch (state) {
    case 'working':
      return 'workforce.agents.status.active'
    case 'ready':
      return 'workforce.agents.status.standby'
    case 'paused':
      return 'workforce.agents.status.sleeping'
    case 'error':
      return 'workforce.agents.status.error'
  }
}

export function agentPauseToggleStatus(agent: Pick<RuntimeAgent, 'status' | 'is_active'>): RuntimeAgent['status'] {
  return agentWorkState(agent) === 'paused' ? 'standby' : 'sleeping'
}
