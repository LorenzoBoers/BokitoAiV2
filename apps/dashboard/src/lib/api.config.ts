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

/** Public help center (`/api/help/*`): unauthenticated published articles. */
export const HELP_API_BASE = '/api/help'

/** Settings router (`/api/settings/*`): providers, models, llm keys. */
export const SETTINGS_API_BASE = '/api/settings'

/** Staff admin router (`/api/staff/*`): platform catalog and keys. */
export const STAFF_API_BASE = '/api/staff'

const DEFAULT_PUBLIC_API_URL = 'https://api.bokito.nl/v1'
export const PUBLIC_API_URL = import.meta.env.VITE_PUBLIC_API_URL || DEFAULT_PUBLIC_API_URL

/** Origin for `bokito-chat` `data-api-url` (widget appends `/api/livechat/...`). */
export function livechatWidgetHttpOrigin(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin.replace(/\/+$/, '')
  }
  return ''
}

/**
 * Same-origin path to the canonical widget bundle. One flat bundle serves both
 * anonymous visitors and logged-in users; behavior is controlled by the
 * `data-auth-mode` attribute on the embed script, not by separate builds.
 */
export const CHAT_WIDGET_SCRIPT_PATH = '/chat-widget/bokito-chat.js'

export function livechatWidgetHostedScriptUrl(): string {
  return `${livechatWidgetHttpOrigin()}${CHAT_WIDGET_SCRIPT_PATH}`
}

/** Agent slug for the chat widget embed (matches tenant bootstrap `assistant`). */
export const DASHBOARD_CHAT_AGENT_SLUG = import.meta.env.VITE_DASHBOARD_CHAT_AGENT_SLUG || 'assistant'

/** Platform UI default (`nl` | `en`). Override with VITE_PLATFORM_DEFAULT_LANGUAGE. */
export const PLATFORM_DEFAULT_LANGUAGE: 'nl' | 'en' =
  import.meta.env.VITE_PLATFORM_DEFAULT_LANGUAGE === 'en' ? 'en' : 'nl'

export function parseUiLanguage(value: string | null | undefined): 'nl' | 'en' {
  const normalized = (value ?? '').trim().toLowerCase()
  if (normalized === 'en' || normalized === 'nl') return normalized
  return PLATFORM_DEFAULT_LANGUAGE
}
