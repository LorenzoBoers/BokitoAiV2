import { projectsRoutes } from '../api/routes'
import { xanoGetWorkforce, xanoPatchWorkforce, xanoPostWorkforce } from './xano'

export interface ProjectRow {
  id: string
  name: string
  slug: string
  description?: string
  autonomous_scope: string
  autonomous_mode?: boolean
  active_domains?: string[]
}

export async function listProjects(): Promise<ProjectRow[]> {
  const data = await xanoGetWorkforce<ProjectRow[] | { items: ProjectRow[] }>(projectsRoutes.list)
  return Array.isArray(data) ? data : data.items ?? []
}

export async function createProject(input: {
  name: string
  slug: string
  autonomous_scope: string
  description?: string
}): Promise<ProjectRow> {
  return xanoPostWorkforce<ProjectRow>(projectsRoutes.list, input)
}

export async function patchProject(
  projectId: string,
  patch: Partial<Pick<ProjectRow, 'autonomous_scope' | 'name' | 'description'>>
): Promise<ProjectRow> {
  return xanoPatchWorkforce<ProjectRow>(projectsRoutes.byId(projectId), patch)
}
