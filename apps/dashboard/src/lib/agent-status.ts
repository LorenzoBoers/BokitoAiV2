import type { RuntimeAgent } from './workforce-api'

export type AgentWorkState = 'working' | 'ready' | 'error'

/** Idle (`standby`) is ready. Archive removes agents from the library. */
export function agentWorkState(
  agent: Pick<RuntimeAgent, 'status' | 'is_active'> &
    Partial<Pick<RuntimeAgent, 'current_activity_id'>>,
): AgentWorkState {
  if (agent.status === 'error') return 'error'
  if (agent.status === 'active' && agent.current_activity_id) return 'working'
  return 'ready'
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
