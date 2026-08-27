import { describe, expect, it } from 'vitest'
import { filterLibraryAgents, sortAgentsForLibrary } from './workforce-nav-agents'
import type { RuntimeAgent } from './workforce-api'

function agent(partial: Partial<RuntimeAgent> & Pick<RuntimeAgent, 'id' | 'name'>): RuntimeAgent {
  return {
    organisation_id: 't1',
    slug: partial.name.toLowerCase(),
    role_id: null,
    parent_agent_id: null,
    status: 'standby',
    current_session_id: null,
    current_activity_id: null,
    current_activity_summary: null,
    updated_at: 0,
    kind: 'company',
    ...partial,
  }
}

describe('filterLibraryAgents', () => {
  it('keeps company workers and orchestrators, drops personal and communication', () => {
    const rows = [
      agent({ id: '1', name: 'Assistant', role_slug: 'assistant', is_lead: true }),
      agent({ id: '2', name: 'Lead PO', role_slug: 'orchestrator' }),
      agent({ id: '3', name: 'Mine', kind: 'personal' }),
      agent({ id: '4', name: 'Inbox', role_slug: 'communication' }),
    ]
    expect(filterLibraryAgents(rows).map((row) => row.id)).toEqual(['1', '2'])
  })
})

describe('sortAgentsForLibrary', () => {
  it('puts the lead first, then newest', () => {
    const rows = [
      agent({ id: 'old', name: 'Support', updated_at: 10 }),
      agent({ id: 'lead', name: 'Assistant', is_lead: true, updated_at: 1 }),
      agent({ id: 'new', name: 'Sales', updated_at: 20 }),
    ]
    expect(sortAgentsForLibrary(rows).map((row) => row.id)).toEqual(['lead', 'new', 'old'])
  })
})
