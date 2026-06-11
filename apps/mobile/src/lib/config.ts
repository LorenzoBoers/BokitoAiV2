import Constants from 'expo-constants'

/**
 * Backend base URL. Override per environment via `expo.extra.apiUrl` in
 * app.json (or app.config). During development point this at the machine
 * running the FastAPI backend (use your LAN IP for physical devices).
 */
export const API_URL: string = (
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'http://127.0.0.1:8000'
).replace(/\/+$/, '')

/** Gateway WebSocket URL derived from the API base. */
export function gatewayUrl(token: string): string {
  const wsBase = API_URL.replace(/^http/, 'ws')
  const params = new URLSearchParams({ access_token: token, device: 'mobile' })
  return `${wsBase}/api/ws?${params.toString()}`
}
