export const projectsRoutes = {
  list: '/projects',
  byId: (projectId: string) => `/projects/${encodeURIComponent(projectId)}`,
  budget: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/budget`,
  repo: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/repo`,
  repoReindex: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/repo/reindex`,
  repoStatus: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/repo/status`,
} as const
