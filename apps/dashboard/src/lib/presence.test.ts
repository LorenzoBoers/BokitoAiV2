import { describe, expect, it } from 'vitest'
import {
  agentStatusOf,
  asAgentStatus,
  asPresenceKind,
  presenceBadgeVariant,
  presenceDotClass,
  presenceTextClass,
} from './presence'

describe('presence visual map', () => {
  it('maps agent idle to AI violet, people available to success', () => {
    expect(asPresenceKind('standby')).toBe('standby')
    expect(asPresenceKind('working')).toBe('working')
    expect(presenceDotClass('standby')).toContain('bg-ai')
    expect(presenceBadgeVariant('standby')).toBe('ai')
    expect(presenceBadgeVariant('available')).toBe('success')
    expect(presenceTextClass('standby')).toBe('text-ai-ink')
  })

  it('shows deactivated agents in a muted badge', () => {
    expect(presenceBadgeVariant('deactivated')).toBe('secondary')
  })

  it('reads the standby | working | error vocabulary only', () => {
    expect(asAgentStatus('working')).toBe('working')
    expect(asAgentStatus('error')).toBe('error')
    expect(asAgentStatus('active')).toBe('standby')
    expect(agentStatusOf({ status: 'standby', current_activity_id: 'run-1' })).toBe('working')
  })
})
