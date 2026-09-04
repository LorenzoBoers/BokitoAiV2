import type { WorkstreamRunStatus } from './workstreams-api'

export function workstreamPath(workstreamId: string): string {
  return `/workstreams/${encodeURIComponent(workstreamId)}`
}

export function workstreamRunPath(runId: string): string {
  return `/workstreams/runs/${encodeURIComponent(runId)}`
}

export function runStatusBadgeVariant(
  status: WorkstreamRunStatus | string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'running') return 'default'
  if (status === 'completed') return 'secondary'
  if (status === 'failed') return 'destructive'
  return 'outline'
}
