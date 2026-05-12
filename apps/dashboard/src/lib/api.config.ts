const DEFAULT_XANO_BASE_URL = 'https://xrex-nmji-j9ur.f2.xano.io'
const DEFAULT_PUBLIC_API_URL = 'https://api.bokito.nl/v1'

export const XANO_BASE_URL = import.meta.env.VITE_XANO_BASE_URL || DEFAULT_XANO_BASE_URL

/**
 * Always resolve to a same-origin proxy path. Cross-origin direct Xano calls fail in
 * production because CORS preflight cannot wildcard `Authorization` (per spec, the
 * Authorization header must be listed explicitly in `Access-Control-Allow-Headers` for
 * credentialed requests; Xano returns `*` which the browser rejects).
 *
 * - DEV: vite middleware proxies `/api/{group}/...` to `${XANO_BASE_URL}/api:{group}/...`.
 * - PROD: Cloudflare workers `bokito-app-passthrough` (`app.bokito.ai/*`) and
 *   `bokito-tenant-router` (`*.bokito.ai/*`) translate `/api/{group}/...` to
 *   `${BOKITO_API_ORIGIN}/api:{group}/...` with the request body and headers (including
 *   browser cookies on `.bokito.ai`) forwarded verbatim.
 */
export function xanoApiBase(canonical: string): string {
  return `/api/${canonical}`
}

export const API_GROUP_APP = import.meta.env.VITE_API_GROUP_APP || 'app'
export const API_GROUP_AUTH = import.meta.env.VITE_API_GROUP_AUTH || 'auth'
export const API_GROUP_INTEGRATIONS = import.meta.env.VITE_API_GROUP_INTEGRATIONS || 'integrations'
export const API_GROUP_WORKFORCE = import.meta.env.VITE_API_GROUP_WORKFORCE || 'workforce'
export const API_GROUP_LIVECHAT = import.meta.env.VITE_API_GROUP_LIVECHAT || 'livechat'
export const API_GROUP_LOGS = import.meta.env.VITE_API_GROUP_LOGS || 'logs'
export const API_GROUP_BAKERMAT = import.meta.env.VITE_API_GROUP_BAKERMAT || 'bakermat'

export const APP_API_BASE = xanoApiBase(API_GROUP_APP)
export const AUTH_API_BASE = xanoApiBase(API_GROUP_AUTH)
export const INTEGRATIONS_API_BASE = xanoApiBase(API_GROUP_INTEGRATIONS)
export const WORKFORCE_API_BASE = xanoApiBase(API_GROUP_WORKFORCE)
export const LIVECHAT_API_BASE = xanoApiBase(API_GROUP_LIVECHAT)
export const LOGS_API_BASE = xanoApiBase(API_GROUP_LOGS)
export const BAKERMAT_API_BASE = xanoApiBase(API_GROUP_BAKERMAT)

export const PUBLIC_API_URL = import.meta.env.VITE_PUBLIC_API_URL || DEFAULT_PUBLIC_API_URL
