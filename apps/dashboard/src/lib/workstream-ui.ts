import type { WorkstreamRunStatus } from './flows-api'

export function workstreamPath(workstreamId: string): string {
  return `/flows/${encodeURIComponent(workstreamId)}`
}

export function workstreamRunPath(runId: string): string {
  return `/flows/runs/${encodeURIComponent(runId)}`
}

export function runStatusBadgeVariant(
  status: WorkstreamRunStatus | string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'running') return 'default'
  if (status === 'completed') return 'secondary'
  if (status === 'failed') return 'destructive'
  return 'outline'
}
