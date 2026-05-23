import { workforceRoutes } from '../api/routes'
import { xanoGetWorkforce } from './xano'

export type WorkLogStatus = 'running' | 'completed' | 'failed' | string

export interface WorkLogRow {
  id: string
  project_id: string
  agent_id?: string | null
  task_subject?: string | null
  status: WorkLogStatus
  started_at?: string | number | null
  finished_at?: string | number | null
  tokens_used?: number | null
}

export interface WorkLogEventsResponse {
  events: WorkLogEvent[]
  status?: WorkLogStatus
  task_subject?: string | null
  started_at?: string | null
  finished_at?: string | null
  tokens_used?: number | null
}

export type WorkLogEvent = {
  type: string
  title?: string
  body?: string
  payload?: Record<string, unknown>
}

export async function listWorkLogs(filters?: {
  project_id?: string
  status?: string
  limit?: number
}): Promise<WorkLogRow[]> {
  const data = await xanoGetWorkforce<{ items: WorkLogRow[] } | WorkLogRow[]>(
    workforceRoutes.workLogs.list(filters)
  )
  if (Array.isArray(data)) return data
  return data.items ?? []
}

export async function fetchWorkLogEvents(workLogId: string): Promise<WorkLogEventsResponse> {
  return xanoGetWorkforce<WorkLogEventsResponse>(workforceRoutes.workLogs.events(workLogId))
}
