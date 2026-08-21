import { appRoutes, projectsRoutes } from '../api/routes'
import { apiPost, workforceGet, workforcePatch, workforcePost } from './api'
import type { AgentTask } from './orchestration-api'

export type ProjectWorkstreamRow = {
  id: string
  project_id: string | null
  tenant_id?: string
  name: string
  description: string
  enabled: boolean
  steps_count: number
  created_at?: string | number | null
}

export type ProjectPoAgent = {
  id: string
  name: string | null
  slug?: string | null
  role: string
  agent_type: 'po'
  status?: string | null
}

export type ProjectWorkstreamsResponse = {
  items: ProjectWorkstreamRow[]
  po_agent: ProjectPoAgent | null
}

function normalizeItems<T>(data: T[] | { items?: T[] | { items?: T[] } } | undefined): T[] {
  if (!data) return []
  if (Array.isArray(data)) return data
  const items = data.items
  if (Array.isArray(items)) return items
  if (items && Array.isArray(items.items)) return items.items
  return []
}

export async function listProjectWorkstreams(projectId: string): Promise<ProjectWorkstreamsResponse> {
  const data = await workforceGet<ProjectWorkstreamsResponse | ProjectWorkstreamRow[]>(
    projectsRoutes.workstreams(projectId),
  )
  if (Array.isArray(data)) {
    return { items: data, po_agent: null }
  }
  return {
    items: normalizeItems(data.items),
    po_agent: data.po_agent ?? null,
  }
}

export async function createProjectWorkstream(
  projectId: string,
  input: { name: string; description?: string; enabled?: boolean },
): Promise<ProjectWorkstreamRow> {
  return workforcePost<ProjectWorkstreamRow>(projectsRoutes.workstreams(projectId), input)
}

export async function patchProjectWorkstream(
  projectId: string,
  workstreamId: string,
  patch: Partial<Pick<ProjectWorkstreamRow, 'name' | 'description' | 'enabled'>>,
): Promise<ProjectWorkstreamRow> {
  return workforcePatch<ProjectWorkstreamRow>(
    projectsRoutes.workstreamById(projectId, workstreamId),
    patch,
  )
}

/** Project workstreams are runnable orchestration workstreams; same run API. */
export async function runProjectWorkstream(workstreamId: string): Promise<AgentTask> {
  return apiPost<AgentTask>(appRoutes.orchestration.workstreamRun(workstreamId), {})
}

export async function linkProjectPoAgent(
  projectId: string,
  poAgentId: string,
): Promise<{ project_id: string; po_agent_id: string; po_agent: ProjectPoAgent }> {
  return workforcePatch(projectsRoutes.poAgent(projectId), { po_agent_id: poAgentId })
}
