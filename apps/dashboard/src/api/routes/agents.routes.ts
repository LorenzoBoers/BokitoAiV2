export const agentsRoutes = {
  list: '/agents',
  byId: (agentId: string) => `/agents/${encodeURIComponent(agentId)}`,
} as const
