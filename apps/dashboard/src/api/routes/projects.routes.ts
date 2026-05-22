export const projectsRoutes = {
  list: '/projects',
  byId: (projectId: string) => `/projects/${encodeURIComponent(projectId)}`,
  budget: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/budget`,
} as const
