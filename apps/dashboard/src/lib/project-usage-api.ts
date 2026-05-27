import { projectsRoutes } from '../api/routes'
import { xanoGetWorkforce } from './xano'

export type UsagePeriod = '7d' | '30d' | '90d'

export interface ProjectUsageSummary {
  project_id: string
  period: { start: string; end: string; label: UsagePeriod }
  total_runs: number
  completed_runs: number
  running_runs: number
  failed_runs: number
  tokens_used: number
  tokens_used_today: number
  tokens_remaining_today: number
  by_day?: Array<{ date: string; runs: number; tokens_used: number }>
}

export async function getProjectUsageSummary(
  projectId: string,
  period: UsagePeriod = '30d',
): Promise<ProjectUsageSummary> {
  return xanoGetWorkforce<ProjectUsageSummary>(
    projectsRoutes.usageSummary(projectId, period),
  )
}
