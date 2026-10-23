import { withQuery } from '../url'

/** Workstream hub routes on the app API group base (`/api/flows`). */
export const workstreamsRoutes = {
  list: '/flows',
  schemaParse: '/flows/schema/parse',
  schemaRender: '/flows/schema/render',
  listQuery: (params: URLSearchParams) => withQuery('/flows', params),
  byId: (workstreamId: string) => `/flows/${encodeURIComponent(workstreamId)}`,
  runs: (workstreamId: string) => `/flows/${encodeURIComponent(workstreamId)}/runs`,
  /** Flow ticket board: stage columns, project lanes. */
  board: (workstreamId: string) => `/flows/${encodeURIComponent(workstreamId)}/board`,
  insertStage: (workstreamId: string) => `/flows/${encodeURIComponent(workstreamId)}/stages`,
  allRuns: '/flows/runs',
  allRunsQuery: (params: URLSearchParams) => withQuery('/flows/runs', params),
  run: (runId: string) => `/flows/runs/${encodeURIComponent(runId)}`,
  runResume: (runId: string) => `/flows/runs/${encodeURIComponent(runId)}/resume`,
  runCancel: (runId: string) => `/flows/runs/${encodeURIComponent(runId)}/cancel`,
  runPromote: (runId: string) => `/flows/runs/${encodeURIComponent(runId)}/promote`,
} as const
