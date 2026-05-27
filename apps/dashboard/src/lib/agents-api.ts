import { agentsRoutes } from '../api/routes'
import type { RuntimeAgent } from './workforce-api'
import { xanoGetWorkforce } from './xano'

export async function listAgents(): Promise<RuntimeAgent[]> {
  const data = await xanoGetWorkforce<{ items?: RuntimeAgent[] } | RuntimeAgent[]>(
    agentsRoutes.list,
  )
  if (Array.isArray(data)) return data
  return data.items ?? []
}
