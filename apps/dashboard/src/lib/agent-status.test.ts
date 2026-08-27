import { describe, expect, it } from 'vitest'
import { agentPauseToggleStatus, agentWorkState } from './agent-status'
import type { RuntimeAgent } from './workforce-api'

function agent(partial: Partial<RuntimeAgent>): RuntimeAgent {
  return {
    id: '1',
    organisation_id: 't1',
    name: 'Assistant',
    slug: 'assistant',
    role_id: null,
    parent_agent_id: null,
    status: 'standby',
    is_active: true,
    current_session_id: null,
    current_activity_id: null,
    current_activity_summary: null,
    updated_at: 0,
    ...partial,
  }
}

describe('agentWorkState', () => {
  it('treats idle standby as ready, not paused', () => {
    expect(agentWorkState(agent({ status: 'standby', is_active: true }))).toBe('ready')
  })

  it('treats sleeping or inactive as paused', () => {
    expect(agentWorkState(agent({ status: 'sleeping', is_active: false }))).toBe('paused')
    expect(agentWorkState(agent({ status: 'standby', is_active: false }))).toBe('paused')
  })

  it('shows working only while a run is active', () => {
    expect(
      agentWorkState(agent({ status: 'active', is_active: true, current_activity_id: 'run-1' })),
    ).toBe('working')
    expect(agentWorkState(agent({ status: 'active', is_active: true }))).toBe('ready')
  })

  it('wakes a paused agent to standby and pauses a ready agent', () => {
    expect(agentPauseToggleStatus(agent({ status: 'standby', is_active: true }))).toBe('sleeping')
    expect(agentPauseToggleStatus(agent({ status: 'sleeping', is_active: false }))).toBe('standby')
  })
})
