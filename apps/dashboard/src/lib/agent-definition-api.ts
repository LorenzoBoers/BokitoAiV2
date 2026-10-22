import { workforceGet, workforcePut } from './api'
import { workforceRoutes } from '../api/routes'

export type CapabilityMode = 'read-only' | 'read-write' | 'all'
export type PromptMode = 'extend' | 'full'
export type McpInheritanceMode = 'all' | 'none' | 'named' | 'except'
export type Effort = 'low' | 'medium' | 'high'

export type AgentDefinition = {
  disallowed_tools: string[]
  capability_mode: CapabilityMode
  prompt_mode: PromptMode
  effort: Effort
  skills: string[]
  completion_requirement: { any_of?: string[]; reminder?: string }
  mcp_inheritance: { mode: McpInheritanceMode; servers: string[] }
}

export async function getAgentDefinition(agentId: string): Promise<AgentDefinition> {
  return workforceGet<AgentDefinition>(workforceRoutes.agents.definition(agentId))
}

export async function saveAgentDefinition(
  agentId: string,
  patch: Partial<AgentDefinition>,
): Promise<AgentDefinition> {
  return workforcePut<AgentDefinition>(workforceRoutes.agents.definition(agentId), patch)
}
