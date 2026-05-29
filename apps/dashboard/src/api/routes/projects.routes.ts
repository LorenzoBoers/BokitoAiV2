export const projectsRoutes = {
  list: '/projects',
  byId: (projectId: string) => `/projects/${encodeURIComponent(projectId)}`,
  /** Worker plane (API key). */
  budget: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/budget`,
  /** Portal user session. */
  usageBudget: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/usage/budget`,
  orchestration: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/orchestration`,
  notificationPreferences: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/notifications/preferences`,
  usageSummary: (projectId: string, period?: string) => {
    const search = new URLSearchParams()
    if (period) search.set('period', period)
    const qs = search.toString()
    const base = `/projects/${encodeURIComponent(projectId)}/usage/summary`
    return qs ? `${base}?${qs}` : base
  },
  repo: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/repo`,
  repoReindex: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/repo/reindex`,
  repoStatus: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/repo/status`,
  workstreams: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/workstreams`,
  workstreamById: (projectId: string, workstreamId: string) =>
    `/projects/${encodeURIComponent(projectId)}/workstreams/${encodeURIComponent(workstreamId)}`,
  poAgent: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/po-agent`,
} as const
