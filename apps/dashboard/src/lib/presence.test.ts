import { describe, expect, it } from 'vitest'
import {
  agentStatusOf,
  asAgentStatus,
  asPresenceKind,
  overlaySelfPresence,
  presenceBadgeVariant,
  presenceDotClass,
  presenceTextClass,
  selfVisiblePresence,
} from './presence'

describe('presence visual map', () => {
  it('maps agent idle to AI violet, people available to success', () => {
    expect(asPresenceKind('standby')).toBe('standby')
    expect(asPresenceKind('working')).toBe('working')
    expect(presenceDotClass('standby')).toBe('presence-standby-dot')
    expect(presenceBadgeVariant('standby')).toBe('ai')
    expect(presenceBadgeVariant('available')).toBe('success')
    expect(presenceTextClass('standby')).toBe('text-ai-ink')
  })

  it('shows deactivated agents in a muted badge', () => {
    expect(presenceBadgeVariant('deactivated')).toBe('secondary')
  })

  it('never shows the open account tab as offline', () => {
    expect(selfVisiblePresence('offline')).toBe('available')
    expect(selfVisiblePresence('available')).toBe('available')
    expect(selfVisiblePresence('away')).toBe('away')
    expect(overlaySelfPresence('u1', 'offline', 'u1', true)).toBe('available')
    expect(overlaySelfPresence('u1', 'offline', 'u1', false)).toBe('offline')
    expect(overlaySelfPresence('u2', 'offline', 'u1', true)).toBe('offline')
    expect(overlaySelfPresence('u1', 'away', 'u1', true)).toBe('away')
  })

  it('reads the standby | working | error vocabulary only', () => {
    expect(asAgentStatus('working')).toBe('working')
    expect(asAgentStatus('error')).toBe('error')
    expect(asAgentStatus('active')).toBe('standby')
    expect(agentStatusOf({ status: 'standby', current_activity_id: 'run-1' })).toBe('working')
  })
})
