import { describe, expect, it } from 'vitest'
import { resolveAgendaAgentName } from './agenda-label'

describe('resolveAgendaAgentName', () => {
  const agents = [{ id: 'agent-1', name: 'Platform PO', role_slug: 'orchestrator' }]
  const triggers = [{ id: 'trig-1', agent_id: 'agent-1' }]

  it('keeps an explicit agent name', () => {
    expect(
      resolveAgendaAgentName(
        { agent_id: 'agent-1', agent_name: 'Daily scanner', trigger_id: null },
        agents,
        triggers,
      ),
    ).toBe('Daily scanner')
  })

  it('fills a planned item from the agent list', () => {
    expect(
      resolveAgendaAgentName(
        { agent_id: 'agent-1', agent_name: null, trigger_id: null },
        agents,
        triggers,
      ),
    ).toBe('Platform PO')
  })

  it('fills from the linked trigger when the occurrence has no agent_id', () => {
    expect(
      resolveAgendaAgentName(
        { agent_id: null, agent_name: null, trigger_id: 'trig-1' },
        agents,
        triggers,
      ),
    ).toBe('Platform PO')
  })

  it('fills planned role-only items from a completed sibling or role', () => {
    expect(
      resolveAgendaAgentName(
        { agent_id: null, agent_name: null, trigger_id: 'trig-scan', agent_role: 'orchestrator' },
        agents,
        [{ id: 'trig-scan', agent_id: null, agent_role: 'orchestrator' }],
        [{ trigger_id: 'trig-scan', agent_id: 'agent-1', agent_name: 'Platform PO' }],
      ),
    ).toBe('Platform PO')
    expect(
      resolveAgendaAgentName(
        { agent_id: null, agent_name: null, trigger_id: 'trig-scan', agent_role: 'orchestrator' },
        agents,
        [{ id: 'trig-scan', agent_id: null, agent_role: 'orchestrator' }],
      ),
    ).toBe('Platform PO')
  })
})
