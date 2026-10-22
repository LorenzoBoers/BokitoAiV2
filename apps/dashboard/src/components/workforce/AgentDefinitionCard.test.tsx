/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentDefinition } from '../../lib/agent-definition-api'
import { saveAgentDefinition } from '../../lib/agent-definition-api'
import { AgentDefinitionCard } from './AgentDefinitionCard'

const definition: AgentDefinition = {
  disallowed_tools: [],
  capability_mode: 'all',
  prompt_mode: 'extend',
  effort: 'high',
  skills: [],
  completion_requirement: {},
  mcp_inheritance: { mode: 'all', servers: [] },
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('../../lib/agent-definition-api', () => ({
  getAgentDefinition: vi.fn(async () => definition),
  saveAgentDefinition: vi.fn(async (_id: string, patch: Partial<AgentDefinition>) => ({ ...definition, ...patch })),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AgentDefinitionCard', () => {
  it('shows the thinking choice and saves it with the definition', async () => {
    render(<AgentDefinitionCard agentId="a1" canEdit />)
    await waitFor(() => expect(screen.getByLabelText('workforce.agents.definition.effort')).toBeTruthy())
    expect(screen.getByText('workforce.agents.definition.effortHigh')).toBeTruthy()
    fireEvent.click(screen.getByText('workforce.agents.definition.save'))
    await waitFor(() => expect(saveAgentDefinition).toHaveBeenCalled())
    expect(vi.mocked(saveAgentDefinition).mock.calls[0][1]).toMatchObject({ effort: 'high' })
  })
})
