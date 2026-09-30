export const authRoutes = {
  signup: '/auth/signup',
  login: '/auth/login',
  refresh: '/auth/refresh',
  logout: '/auth/logout',
  workspaces: '/auth/workspaces',
  switchWorkspace: (tenantId: string) => `/auth/workspaces/${tenantId}/switch`,
  me: '/me',
} as const
