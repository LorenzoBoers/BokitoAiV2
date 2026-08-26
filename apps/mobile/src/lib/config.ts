import Constants from 'expo-constants'

/**
 * Backend base URL. Override per environment via `expo.extra.apiUrl` in
 * app.json (or app.config). During development point this at the machine
 * running the FastAPI backend (use your LAN IP for physical devices).
 */
export const API_URL: string = (
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'http://127.0.0.1:8000'
).replace(/\/+$/, '')

function resolveWebAppUrl(): string {
  try {
    const url = new URL(API_URL.includes('://') ? API_URL : `http://${API_URL}`)
    if (/bokito\.ai$/i.test(url.hostname)) return `${url.protocol}//${url.host}`
  } catch {
    // fall through
  }
  return 'https://app.bokito.ai'
}

/** Full workspace in the browser (same host in production). */
export const WEB_APP_URL = resolveWebAppUrl()

/** Gateway WebSocket URL derived from the API base. */
export function gatewayUrl(token: string): string {
  const wsBase = API_URL.replace(/^http/, 'ws')
  const params = new URLSearchParams({ access_token: token, device: 'mobile' })
  return `${wsBase}/api/ws?${params.toString()}`
}
