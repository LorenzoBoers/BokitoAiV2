import { projectsRoutes } from '../api/routes'
import { workforceDelete, workforceGet, workforcePatch, workforcePost } from './api'

export type RepoSource = 'github' | 'upload' | 'none'
export type RepoIndexStatus = 'pending' | 'indexing' | 'ready' | 'error' | 'none'

export interface ProjectRow {
  id: string
  name: string
  slug: string
  description?: string
  autonomous_scope: string
  autonomous_mode?: boolean
  active_domains?: string[]
  github_connection_id?: string | null
  repo_binding_id?: string | null
  github_repo_full_name?: string | null
  github_default_branch?: string | null
  repo_source?: RepoSource
  repo_connected_at?: string | null
  repo_index_status?: RepoIndexStatus
  repo_indexed_at?: string | null
  repo_index_error?: string | null
  po_agent_id?: string | null
  po_agent?: {
    id: string
    name: string
    slug?: string | null
    role?: string | null
    agent_type?: 'po' | string | null
    status?: string | null
  } | null
}

export async function listProjects(): Promise<ProjectRow[]> {
  const data = await workforceGet<ProjectRow[] | { items: ProjectRow[] }>(projectsRoutes.list)
  return Array.isArray(data) ? data : data.items ?? []
}

export async function getProject(projectId: string): Promise<ProjectRow> {
  return workforceGet<ProjectRow>(projectsRoutes.byId(projectId))
}

export async function createProject(input: {
  name: string
  slug: string
  autonomous_scope: string
  description?: string
}): Promise<ProjectRow> {
  return workforcePost<ProjectRow>(projectsRoutes.list, input)
}

export async function patchProject(
  projectId: string,
  patch: Partial<Pick<ProjectRow, 'autonomous_scope' | 'name' | 'description'>>,
): Promise<ProjectRow> {
  return workforcePatch<ProjectRow>(projectsRoutes.byId(projectId), patch)
}

export async function deleteProject(projectId: string, confirmName: string): Promise<{ deleted: boolean }> {
  return workforceDelete<{ deleted: boolean }>(projectsRoutes.byId(projectId), {
    confirm_name: confirmName,
  }) as Promise<{ deleted: boolean }>
}

export async function connectProjectRepo(
  projectId: string,
  input: {
    github_repo_full_name: string
    github_default_branch?: string
    connection_id?: string
  },
): Promise<ProjectRow> {
  return workforcePatch<ProjectRow>(projectsRoutes.repo(projectId), {
    repo_full_name: input.github_repo_full_name,
    github_repo_full_name: input.github_repo_full_name,
    default_branch: input.github_default_branch ?? 'main',
    github_default_branch: input.github_default_branch ?? 'main',
    connection_id: input.connection_id,
    github_connection_id: input.connection_id,
  })
}

export async function disconnectProjectRepo(projectId: string): Promise<ProjectRow> {
  const result = await workforceDelete<ProjectRow>(projectsRoutes.repo(projectId))
  if (result) return result
  return getProject(projectId)
}

export async function reindexProjectRepo(projectId: string): Promise<{ queued: boolean }> {
  return workforcePost<{ queued: boolean }>(projectsRoutes.repoReindex(projectId), {})
}

export interface ProjectBudgetResponse {
  token_budget_daily: number
  token_used_today: number
  token_used_this_hour: number
  remaining_today: number
  remaining_hour: number
  blocked: boolean
}

export async function getProjectBudget(projectId: string): Promise<ProjectBudgetResponse> {
  return workforceGet<ProjectBudgetResponse>(projectsRoutes.usageBudget(projectId))
}

export async function createProjectPoAgent(
  projectId: string,
  name: string,
): Promise<{ po_agent_id: string; po_agent: ProjectRow['po_agent'] }> {
  return workforcePost(projectsRoutes.poAgent(projectId), { name })
}

export async function linkProjectPoAgentById(
  projectId: string,
  poAgentId: string,
): Promise<{ project_id: string; po_agent_id: string; po_agent: ProjectRow['po_agent'] }> {
  return workforcePatch(projectsRoutes.poAgent(projectId), { po_agent_id: poAgentId })
}

export async function getRepoStatus(projectId: string): Promise<{
  repo_index_status: RepoIndexStatus
  repo_indexed_at: string | null
  repo_last_commit_sha: string | null
  repo_index_error: string | null
}> {
  return workforceGet(projectsRoutes.repoStatus(projectId))
}
