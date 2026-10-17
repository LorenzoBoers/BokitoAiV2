import { workforceRoutes } from '../api/routes/workforce.routes'
import type { RuntimeAgent } from './workforce-api'
import { workforceGet } from './api'

/** Active company agents by default. Pass includeInactive for directory views. */
export async function listAgents(opts?: { includeInactive?: boolean }): Promise<RuntimeAgent[]> {
  const data = await workforceGet<{ items?: RuntimeAgent[] } | RuntimeAgent[]>(
    workforceRoutes.agents.list(
      opts?.includeInactive ? { include_inactive: true } : undefined,
    ),
  )
  if (Array.isArray(data)) return data
  return data.items ?? []
}

/** One agent for the edit screen, including instructions and signature. */
export async function getAgent(agentId: string): Promise<RuntimeAgent | null> {
  const data = await workforceGet<{ agent?: RuntimeAgent }>(workforceRoutes.agents.detail(agentId))
  return data.agent ?? null
}
