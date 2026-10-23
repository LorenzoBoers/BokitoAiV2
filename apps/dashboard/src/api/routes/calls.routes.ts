/** Relative paths for in-app agent calls (`APP_API_BASE`). */
export const callRoutes = {
  ringing: '/calls/ringing',
  accept: (id: string) => `/calls/${encodeURIComponent(id)}/accept`,
  resume: (id: string) => `/calls/${encodeURIComponent(id)}/resume`,
  hold: (id: string) => `/calls/${encodeURIComponent(id)}/hold`,
  voice: '/calls/voice',
  decline: (id: string) => `/calls/${encodeURIComponent(id)}/decline`,
  miss: (id: string) => `/calls/${encodeURIComponent(id)}/miss`,
  end: (id: string) => `/calls/${encodeURIComponent(id)}/end`,
  tool: (id: string) => `/calls/${encodeURIComponent(id)}/tool`,
  settings: (id: string) => `/calls/${encodeURIComponent(id)}/settings`,
}
