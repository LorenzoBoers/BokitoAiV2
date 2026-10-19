/** Relative paths for in-app agent calls (`APP_API_BASE`). */
export const callRoutes = {
  ringing: '/calls/ringing',
  accept: (id: string) => `/calls/${encodeURIComponent(id)}/accept`,
  decline: (id: string) => `/calls/${encodeURIComponent(id)}/decline`,
  miss: (id: string) => `/calls/${encodeURIComponent(id)}/miss`,
  end: (id: string) => `/calls/${encodeURIComponent(id)}/end`,
  tool: (id: string) => `/calls/${encodeURIComponent(id)}/tool`,
}
