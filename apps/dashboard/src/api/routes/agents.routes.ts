export const agentsRoutes = {
  list: '/agents',
  byId: (agentId: string) => `/agents/${encodeURIComponent(agentId)}`,
  presets: '/agent-presets',
} as const
