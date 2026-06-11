import { projectsRoutes } from '../api/routes'
import { workforceGet, workforcePatch, workforcePost } from './api'

export type WorkstreamStatus = 'active' | 'draft' | 'paused'

export type WorkstreamStep = {
  id: string
  name: string
  role_label: string
  instruction: string
  tool_keys: string[]
}

export type ProjectWorkstreamRow = {
  id: string
  project_id: string
  tenant_id?: string
  name: string
  slug: string
  status: WorkstreamStatus
  trigger_text?: string | null
  output_text?: string | null
  steps?: WorkstreamStep[] | null
  position?: number | null
  last_active_at?: string | number | null
  created_at?: string | number | null
  updated_at?: string | number | null
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
  input: {
    name: string
    slug: string
    status?: WorkstreamStatus
    trigger_text?: string
    output_text?: string
    steps?: WorkstreamStep[]
    position?: number
  },
): Promise<ProjectWorkstreamRow> {
  return workforcePost<ProjectWorkstreamRow>(projectsRoutes.workstreams(projectId), input)
}

export async function patchProjectWorkstream(
  projectId: string,
  workstreamId: string,
  patch: Partial<
    Pick<
      ProjectWorkstreamRow,
      'name' | 'slug' | 'status' | 'trigger_text' | 'output_text' | 'steps' | 'position' | 'last_active_at'
    >
  >,
): Promise<ProjectWorkstreamRow> {
  return workforcePatch<ProjectWorkstreamRow>(
    projectsRoutes.workstreamById(projectId, workstreamId),
    patch,
  )
}

export async function linkProjectPoAgent(
  projectId: string,
  poAgentId: string,
): Promise<{ project_id: string; po_agent_id: string; po_agent: ProjectPoAgent }> {
  return workforcePatch(projectsRoutes.poAgent(projectId), { po_agent_id: poAgentId })
}
