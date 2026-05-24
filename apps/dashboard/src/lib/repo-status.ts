import type { ProjectRow } from './projects-api'

export type RepoIndexStatus = 'none' | 'pending' | 'indexing' | 'ready' | 'error'
export type RepoSource = 'none' | 'github_oauth' | 'bokito_managed'

export function repoStatusLabel(project: Pick<ProjectRow, 'repo_index_status' | 'github_repo_full_name'>): string {
  if (!project.github_repo_full_name) return 'Not connected'
  switch (project.repo_index_status) {
    case 'ready':
      return 'Ready'
    case 'indexing':
      return 'Reading project'
    case 'pending':
      return 'Queued'
    case 'error':
      return 'Connection issue'
    default:
      return 'Connected'
  }
}

export function repoStatusVariant(
  project: Pick<ProjectRow, 'repo_index_status' | 'github_repo_full_name'>,
): 'neutral' | 'info' | 'success' | 'warning' | 'error' {
  if (!project.github_repo_full_name) return 'neutral'
  switch (project.repo_index_status) {
    case 'ready':
      return 'success'
    case 'indexing':
    case 'pending':
      return 'info'
    case 'error':
      return 'error'
    default:
      return 'info'
  }
}
