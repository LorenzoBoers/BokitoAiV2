import { workforceRoutes } from '../api/routes/workforce.routes'
import type { RuntimeAgent } from './workforce-api'
import { workforceGet } from './api'

export async function listAgents(): Promise<RuntimeAgent[]> {
  const data = await workforceGet<{ items?: RuntimeAgent[] } | RuntimeAgent[]>(
    workforceRoutes.agents.list,
  )
  if (Array.isArray(data)) return data
  return data.items ?? []
}
