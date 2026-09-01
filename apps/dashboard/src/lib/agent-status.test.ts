import { describe, expect, it } from 'vitest'
import { agentWorkState } from './agent-status'
import type { RuntimeAgent } from './workforce-api'

function agent(
  overrides: Partial<Pick<RuntimeAgent, 'status' | 'is_active' | 'current_activity_id'>> = {},
): Pick<RuntimeAgent, 'status' | 'is_active'> & Partial<Pick<RuntimeAgent, 'current_activity_id'>> {
  return {
    status: 'standby',
    is_active: true,
    ...overrides,
  }
}

describe('agentWorkState', () => {
  it('treats idle standby as ready', () => {
    expect(agentWorkState(agent({ status: 'standby', is_active: true }))).toBe('ready')
  })

  it('ignores legacy sleeping status and shows ready', () => {
    expect(agentWorkState(agent({ status: 'sleeping', is_active: false }))).toBe('ready')
  })

  it('treats an active run as working', () => {
    expect(
      agentWorkState(agent({ status: 'active', is_active: true, current_activity_id: 'run-1' })),
    ).toBe('working')
    expect(agentWorkState(agent({ status: 'active', is_active: true }))).toBe('ready')
  })

  it('surfaces errors', () => {
    expect(agentWorkState(agent({ status: 'error' }))).toBe('error')
  })
})
