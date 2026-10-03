/** Relative paths on APP_API_BASE for the workbench gateway. */

export const workbenchRoutes = {
  catalog: '/workbench/catalog',
  connections: '/workbench/connections',
  connection: (id: string) => `/workbench/connections/${encodeURIComponent(id)}`,
  jobs: '/workbench/jobs',
  job: (id: string) => `/workbench/jobs/${encodeURIComponent(id)}`,
  jobFollowUp: (id: string) => `/workbench/jobs/${encodeURIComponent(id)}/follow-up`,
  jobCancel: (id: string) => `/workbench/jobs/${encodeURIComponent(id)}/cancel`,
  jobRefresh: (id: string) => `/workbench/jobs/${encodeURIComponent(id)}/refresh`,
}
