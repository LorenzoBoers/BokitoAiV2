/**
 * Same-origin API bases. In development Vite proxies `/api/*` to
 * `VITE_BOKITO_API_URL`; in production the web app is served behind the same
 * origin as api-v2. Never hardcode an API origin elsewhere.
 */
export const API_BASE = '/api'
export const WS_URL = (() => {
  if (typeof window === 'undefined') return `${API_BASE}/ws`
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}${API_BASE}/ws`
})()

export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? 'dev'
