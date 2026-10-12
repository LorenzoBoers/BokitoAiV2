import { foldersRoutes } from '../api/routes'
import type { AgentSummary } from './workforce-api'
import { foldersDelete, foldersGet, foldersPatch, foldersPost } from './api'

export type RepoSource = 'github' | 'upload' | 'none'
export type RepoIndexStatus = 'pending' | 'indexing' | 'ready' | 'error' | 'none'

export interface ProjectRow {
  id: string
  name: string
  slug: string
  description?: string
  autonomous_scope: string
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
  open_tickets_count?: number
  doc_sections_total?: number
  doc_sections_done?: number
  po_agent_id?: string | null
  po_agent?: AgentSummary | null
  agents?: ProjectAgentChip[]
  token_budget_daily?: number | null
  token_budget_hourly?: number | null
  parent_id?: string | null
  child_count?: number
  ancestors?: { id: string; name: string }[]
  children?: ProjectChild[]
  open_count?: number
  closed_count?: number
}

export interface ProjectChild {
  id: string
  name: string
  slug: string
  child_count: number
  open_count: number
  closed_count: number
}

export interface ProjectAgentChip {
  agent_id: string
  name: string
  is_default: boolean
}

export interface ProjectAgentRow {
  id: string
  agent_id: string
  name: string
  role: string
  is_active: boolean
  is_default: boolean
  created_at: string | null
  avatar_kind?: string | null
  avatar_icon?: string | null
  avatar_color?: string | null
  avatar_image_url?: string | null
}

export async function listProjects(): Promise<ProjectRow[]> {
  const data = await foldersGet<ProjectRow[] | { items: ProjectRow[] }>(foldersRoutes.list)
  return Array.isArray(data) ? data : data.items ?? []
}

export async function getProject(projectId: string): Promise<ProjectRow> {
  return foldersGet<ProjectRow>(foldersRoutes.byId(projectId))
}

export async function createProject(input: {
  name: string
  slug: string
  autonomous_scope: string
  description?: string
  parent_id?: string | null
  tag?: string | null
  tag_id?: string | null
  child_group_id?: string | null
}): Promise<ProjectRow> {
  return foldersPost<ProjectRow>(foldersRoutes.list, input)
}

export async function pinVirtualChild(folderId: string, tagId: string): Promise<ProjectRow> {
  return foldersPost<ProjectRow>(foldersRoutes.children(folderId), { tag_id: tagId })
}

export async function listFolderFiles(
  folderId: string,
): Promise<{ name: string; url?: string | null; signal_id: string; subject: string }[]> {
  const data = await foldersGet<{ files?: { name: string; url?: string | null; signal_id: string; subject: string }[] }>(
    foldersRoutes.files(folderId),
  )
  return data.files ?? []
}

export async function patchProject(
  projectId: string,
  patch: Partial<
    Pick<
      ProjectRow,
      'autonomous_scope' | 'name' | 'description' | 'token_budget_daily' | 'token_budget_hourly'
    >
  > & { parent_id?: string | null },
): Promise<ProjectRow> {
  return foldersPatch<ProjectRow>(foldersRoutes.byId(projectId), patch)
}

export async function deleteProject(projectId: string, confirmName: string): Promise<{ deleted: boolean }> {
  return foldersDelete<{ deleted: boolean }>(foldersRoutes.byId(projectId), {
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
  return foldersPatch<ProjectRow>(foldersRoutes.repo(projectId), {
    repo_full_name: input.github_repo_full_name,
    github_repo_full_name: input.github_repo_full_name,
    default_branch: input.github_default_branch ?? 'main',
    github_default_branch: input.github_default_branch ?? 'main',
    connection_id: input.connection_id,
    github_connection_id: input.connection_id,
  })
}

export async function disconnectProjectRepo(projectId: string): Promise<ProjectRow> {
  const result = await foldersDelete<ProjectRow>(foldersRoutes.repo(projectId))
  if (result) return result
  return getProject(projectId)
}

export async function reindexProjectRepo(projectId: string): Promise<{ queued: boolean }> {
  return foldersPost<{ queued: boolean }>(foldersRoutes.repoReindex(projectId), {})
}

export interface ProjectBudgetResponse {
  token_budget_daily: number
  token_budget_hourly?: number
  token_budget_daily_set?: number | null
  token_budget_hourly_set?: number | null
  workspace_daily_cap?: number | null
  token_used_today: number
  token_used_this_hour: number
  remaining_today: number
  remaining_hour: number
  blocked: boolean
}

export async function getProjectBudget(projectId: string): Promise<ProjectBudgetResponse> {
  return foldersGet<ProjectBudgetResponse>(foldersRoutes.usageBudget(projectId))
}

export async function createProjectPoAgent(
  projectId: string,
  name: string,
): Promise<{ po_agent_id: string; po_agent: ProjectRow['po_agent'] }> {
  return foldersPost(foldersRoutes.poAgent(projectId), { name })
}

export async function linkProjectPoAgentById(
  projectId: string,
  poAgentId: string,
): Promise<{ project_id: string; po_agent_id: string; po_agent: ProjectRow['po_agent'] }> {
  return foldersPatch(foldersRoutes.poAgent(projectId), { po_agent_id: poAgentId })
}

export async function listProjectAgents(projectId: string): Promise<ProjectAgentRow[]> {
  return foldersGet<ProjectAgentRow[]>(foldersRoutes.agents(projectId))
}

export async function addProjectAgent(
  projectId: string,
  agentId: string,
  isDefault = false,
): Promise<ProjectAgentRow> {
  return foldersPost<ProjectAgentRow>(foldersRoutes.agents(projectId), {
    agent_id: agentId,
    is_default: isDefault,
  })
}

export async function setProjectAgentDefault(
  projectId: string,
  agentId: string,
  isDefault: boolean,
): Promise<ProjectAgentRow> {
  return foldersPatch<ProjectAgentRow>(foldersRoutes.agentById(projectId, agentId), {
    is_default: isDefault,
  })
}

export async function removeProjectAgent(projectId: string, agentId: string): Promise<void> {
  await foldersDelete(foldersRoutes.agentById(projectId, agentId))
}

export async function getRepoStatus(projectId: string): Promise<{
  repo_index_status: RepoIndexStatus
  repo_indexed_at: string | null
  repo_last_commit_sha: string | null
  repo_index_error: string | null
}> {
  return foldersGet(foldersRoutes.repoStatus(projectId))
}
