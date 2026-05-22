import { pkbRoutes } from '../api/routes'
import { xanoGetWorkforce, xanoPostWorkforce } from './xano'

export type PkbLayer = 'current_state' | 'intended_state' | 'change_queue'

export interface PkbSectionRow {
  id: string
  project_id: string
  layer: PkbLayer
  domain?: string | null
  title?: string | null
  content: string
  change_status?: string
  priority?: number
}

export async function listPkbSections(projectId: string, layer?: PkbLayer): Promise<PkbSectionRow[]> {
  const params = new URLSearchParams({ project_id: projectId })
  if (layer) params.set('layer', layer)
  const data = await xanoGetWorkforce<PkbSectionRow[] | { items: PkbSectionRow[] }>(
    pkbRoutes.listQuery(params)
  )
  return Array.isArray(data) ? data : data.items ?? []
}

export async function submitChangeRequest(input: {
  project_id: string
  content: string
  priority?: number
}): Promise<PkbSectionRow> {
  return xanoPostWorkforce<PkbSectionRow>(pkbRoutes.listQuery(new URLSearchParams()), {
    project_id: input.project_id,
    layer: 'change_queue',
    change_status: 'pending',
    submitted_by_type: 'user',
    content: input.content,
    priority: input.priority ?? 5,
  })
}
