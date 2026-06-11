/**
 * Same-origin API bases for the FastAPI gateway.
 *
 * - DEV: vite proxies `/api/*` (HTTP + WS) to `VITE_BOKITO_API_URL` (default
 *   http://127.0.0.1:8000).
 * - PROD: the dashboard is served behind the same origin as the API.
 */

/** Most portal routes mount directly on `/api/*` (signals, govern, triggers, ...). */
export const APP_API_BASE = '/api'

/** Custom tables / workspace CRUD under the app scope. */
export const APP_SCOPED_API_BASE = '/api/app'

/** Auth router (`/api/auth/*`): login, refresh, me, profile, avatar, staff. */
export const AUTH_API_BASE = '/api/auth'

/** Workforce router (`/api/workforce/*`): agents, work logs, projects, OS graph. */
export const WORKFORCE_API_BASE = '/api/workforce'

/** Livechat router (`/api/livechat/*`): widget streaming endpoints. */
export const LIVECHAT_API_BASE = '/api/livechat'

const DEFAULT_PUBLIC_API_URL = 'https://api.bokito.nl/v1'
export const PUBLIC_API_URL = import.meta.env.VITE_PUBLIC_API_URL || DEFAULT_PUBLIC_API_URL

/** Origin for `bokito-chat` `data-api-url` (widget appends `/api:livechat/...`). */
export function livechatWidgetHttpOrigin(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin.replace(/\/+$/, '')
  }
  return ''
}

/** Same-origin path to the team widget bundle (ingelogde gebruikers met rechten). */
export const CHAT_WIDGET_SCRIPT_PATH_INTERNAL = '/chat-widget/internal/bokito-chat.js'

/** Same-origin path to the public visitor widget bundle (anonieme websitebezoekers). */
export const CHAT_WIDGET_SCRIPT_PATH_EXTERNAL = '/chat-widget/external/bokito-chat.js'

export function livechatWidgetHostedScriptUrl(kind: 'internal' | 'external'): string {
  const base = livechatWidgetHttpOrigin()
  return `${base}/api:livechat/script/${kind}`
}

/** Agent slug for the chat widget embedded in the dashboard portal. */
export const DASHBOARD_CHAT_AGENT_SLUG = import.meta.env.VITE_DASHBOARD_CHAT_AGENT_SLUG || 'bokito-dashboard'
