import { agentsRoutes } from '../api/routes'
import type { RuntimeAgent } from './workforce-api'
import { workforceGet } from './api'

export async function listAgents(): Promise<RuntimeAgent[]> {
  const data = await workforceGet<{ items?: RuntimeAgent[] } | RuntimeAgent[]>(
    agentsRoutes.list,
  )
  if (Array.isArray(data)) return data
  return data.items ?? []
}
