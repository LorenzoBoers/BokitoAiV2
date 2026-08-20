/**
 * Custom cockpit metrics (`/api/metrics/*`): tenant KPI definitions and
 * observation points, fillable by users and agents.
 */
export const metricsRoutes = {
  list: () => '/metrics',
  metric: (metricId: string) => `/metrics/${encodeURIComponent(metricId)}`,
  points: (metricId: string) => `/metrics/${encodeURIComponent(metricId)}/points`,
} as const
