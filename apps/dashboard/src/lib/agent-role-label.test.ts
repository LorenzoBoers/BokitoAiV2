import { describe, expect, it } from 'vitest'
import { agentRoleLabel } from './agent-role-label'

const t = ((key: string) => {
  if (key.includes('orchestrator') || key.includes('.po')) return 'Lead'
  if (key.includes('worker')) return 'Agent'
  return key
}) as (key: string, opts?: { ns?: string }) => string

describe('agent role label', () => {
  it('turns leftover orchestrator jargon into Lead', () => {
    expect(agentRoleLabel('Orchestrator', t)).toBe('Lead')
    expect(agentRoleLabel('po', t)).toBe('Lead')
    expect(agentRoleLabel('worker', t)).toBe('Agent')
    expect(agentRoleLabel('', t)).toBe('Agent')
  })
})
