/**
 * Custom cockpit metrics (`/api/metrics/*`): tenant KPI definitions and
 * observation points, fillable by users and agents.
 */
export const metricsRoutes = {
  list: () => '/metrics',
  sources: () => '/metrics/sources',
  metric: (metricId: string) => `/metrics/${encodeURIComponent(metricId)}`,
  points: (metricId: string) => `/metrics/${encodeURIComponent(metricId)}/points`,
} as const
