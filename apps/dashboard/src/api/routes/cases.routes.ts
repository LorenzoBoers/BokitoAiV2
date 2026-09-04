import { withQuery } from '../url'

/** Cases API on the app group base (`APP_API_BASE` → `/api/cases`). */
export const casesRoutes = {
  list: '/cases',
  listQuery: (params: URLSearchParams) => withQuery('/cases', params),
  byId: (caseId: string) => `/cases/${encodeURIComponent(caseId)}`,
  link: (caseId: string) => `/cases/${encodeURIComponent(caseId)}/link`,
  types: '/cases/types',
  typeById: (typeId: string) => `/cases/types/${encodeURIComponent(typeId)}`,
  bindings: '/cases/bindings',
  bindingsQuery: (params: URLSearchParams) => withQuery('/cases/bindings', params),
  bindingById: (bindingId: string) => `/cases/bindings/${encodeURIComponent(bindingId)}`,
  forSignal: (signalId: string) => `/signals/${encodeURIComponent(signalId)}/cases`,
} as const
