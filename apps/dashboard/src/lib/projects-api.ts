import { projectsRoutes } from '../api/routes'
import type { RepoIndexStatus, RepoSource } from './repo-status'
import { xanoDeleteWorkforce, xanoGetWorkforce, xanoPatchWorkforce, xanoPostWorkforce } from './xano'

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
  repo_last_commit_sha?: string | null
}

export async function listProjects(): Promise<ProjectRow[]> {
  const data = await xanoGetWorkforce<ProjectRow[] | { items: ProjectRow[] }>(projectsRoutes.list)
  return Array.isArray(data) ? data : data.items ?? []
}

export async function getProject(projectId: string): Promise<ProjectRow> {
  return xanoGetWorkforce<ProjectRow>(projectsRoutes.byId(projectId))
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
  patch: Partial<Pick<ProjectRow, 'autonomous_scope' | 'name' | 'description'>>,
): Promise<ProjectRow> {
  return xanoPatchWorkforce<ProjectRow>(projectsRoutes.byId(projectId), patch)
}

export async function connectProjectRepo(
  projectId: string,
  input: {
    github_repo_full_name: string
    github_default_branch?: string
    connection_id?: string
  },
): Promise<ProjectRow> {
  return xanoPatchWorkforce<ProjectRow>(projectsRoutes.repo(projectId), {
    repo_full_name: input.github_repo_full_name,
    github_repo_full_name: input.github_repo_full_name,
    default_branch: input.github_default_branch ?? 'main',
    github_default_branch: input.github_default_branch ?? 'main',
    connection_id: input.connection_id,
    github_connection_id: input.connection_id,
  })
}

export async function disconnectProjectRepo(projectId: string): Promise<ProjectRow> {
  const result = await xanoDeleteWorkforce<ProjectRow>(projectsRoutes.repo(projectId))
  if (result) return result
  return getProject(projectId)
}

export async function reindexProjectRepo(projectId: string): Promise<{ queued: boolean }> {
  return xanoPostWorkforce<{ queued: boolean }>(projectsRoutes.repoReindex(projectId), {})
}

export async function getRepoStatus(projectId: string): Promise<{
  repo_index_status: RepoIndexStatus
  repo_indexed_at: string | null
  repo_last_commit_sha: string | null
  repo_index_error: string | null
}> {
  return xanoGetWorkforce(projectsRoutes.repoStatus(projectId))
}
