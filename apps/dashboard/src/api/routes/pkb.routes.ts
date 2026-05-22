import { withQuery } from '../url'

export const pkbRoutes = {
  listQuery: (params: URLSearchParams) => withQuery('/pkb', params),
  byId: (sectionId: string) => `/pkb/${encodeURIComponent(sectionId)}`,
  changeQueue: (projectId: string) => `/pkb/change-queue?project_id=${encodeURIComponent(projectId)}`,
} as const
