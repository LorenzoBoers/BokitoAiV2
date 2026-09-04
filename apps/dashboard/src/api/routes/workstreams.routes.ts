import { withQuery } from '../url'

/** Workstream hub routes on the app API group base (`/api/workstreams`). */
export const workstreamsRoutes = {
  list: '/workstreams',
  listQuery: (params: URLSearchParams) => withQuery('/workstreams', params),
  byId: (workstreamId: string) => `/workstreams/${encodeURIComponent(workstreamId)}`,
  steps: (workstreamId: string) => `/workstreams/${encodeURIComponent(workstreamId)}/steps`,
  runs: (workstreamId: string) => `/workstreams/${encodeURIComponent(workstreamId)}/runs`,
  allRuns: '/workstreams/runs',
  allRunsQuery: (params: URLSearchParams) => withQuery('/workstreams/runs', params),
  run: (runId: string) => `/workstreams/runs/${encodeURIComponent(runId)}`,
  runResume: (runId: string) => `/workstreams/runs/${encodeURIComponent(runId)}/resume`,
  runCancel: (runId: string) => `/workstreams/runs/${encodeURIComponent(runId)}/cancel`,
  runPromote: (runId: string) => `/workstreams/runs/${encodeURIComponent(runId)}/promote`,
} as const
