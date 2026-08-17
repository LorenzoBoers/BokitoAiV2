/**
 * Global 401 recovery for API calls.
 *
 * Access tokens expire (60 min by default). When any `/api/*` request comes
 * back 401 while we hold a Bearer token, this interceptor refreshes the
 * session once via the refresh cookie (single-flight across concurrent 401s)
 * and retries the original request with the new token. When the refresh
 * itself fails the session-expired handler clears local auth state so the
 * router can send the user to the login page instead of leaving the app
 * stuck on "Invalid token" errors.
 *
 * Installed once by AuthContext; handlers are swapped via refs so the
 * interceptor never holds stale closures.
 */

const API_PATH_PREFIX = '/api/'
const AUTH_PATH_PREFIX = '/api/auth/'
/** Marks a retried request so a second 401 passes through untouched. */
const RETRY_MARKER_HEADER = 'x-bokito-auth-retry'

type AuthRetryHandlers = {
  /** Refresh the session; resolve the new access token or null on failure. */
  refresh: () => Promise<string | null>
  /** Called when refresh fails: clear local auth state (route guards redirect). */
  onSessionExpired: () => void
}

let handlers: AuthRetryHandlers | null = null
let refreshInFlight: Promise<string | null> | null = null
let installed = false

/** Seconds until the JWT `exp` claim; undefined when the token is opaque. */
export function jwtRemainingSeconds(token: string): number | undefined {
  try {
    const payload = token.split('.')[1]
    if (!payload) return undefined
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const claims = JSON.parse(json) as { exp?: number }
    if (typeof claims.exp !== 'number') return undefined
    return Math.floor(claims.exp - Date.now() / 1000)
  } catch {
    return undefined
  }
}

function headersToRecord(headersInit: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headersInit) return out
  if (headersInit instanceof Headers) {
    headersInit.forEach((value, key) => {
      out[key] = value
    })
    return out
  }
  if (Array.isArray(headersInit)) {
    for (const [key, value] of headersInit) out[key] = value
    return out
  }
  return { ...headersInit }
}

function isRetryableBody(body: BodyInit | null | undefined): boolean {
  if (body == null) return true
  return (
    typeof body === 'string' ||
    body instanceof URLSearchParams ||
    body instanceof FormData ||
    body instanceof Blob
  )
}

function shouldAttemptRefresh(input: RequestInfo | URL, init: RequestInit | undefined): boolean {
  // Only plain (url, init) calls are retried; Request objects may hold
  // consumed body streams.
  if (typeof input !== 'string' && !(input instanceof URL)) return false
  let pathname: string
  try {
    pathname = new URL(String(input), window.location.origin).pathname
  } catch {
    return false
  }
  if (!pathname.startsWith(API_PATH_PREFIX)) return false
  // Login / refresh / me handle their own failures in AuthContext.
  if (pathname.startsWith(AUTH_PATH_PREFIX)) return false
  const headers = headersToRecord(init?.headers)
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  if (lower[RETRY_MARKER_HEADER]) return false
  const auth = lower.authorization || ''
  if (!auth.toLowerCase().startsWith('bearer ')) return false
  return isRetryableBody(init?.body)
}

async function runSingleFlightRefresh(): Promise<string | null> {
  if (!handlers) return null
  if (!refreshInFlight) {
    refreshInFlight = handlers
      .refresh()
      .catch(() => null)
      .finally(() => {
        refreshInFlight = null
      })
  }
  return refreshInFlight
}

export function configureAuthRetry(next: AuthRetryHandlers): void {
  handlers = next
  if (installed || typeof window === 'undefined') return
  installed = true
  const originalFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await originalFetch(input, init)
    if (response.status !== 401 || !handlers || !shouldAttemptRefresh(input, init)) {
      return response
    }
    const newToken = await runSingleFlightRefresh()
    if (!newToken) {
      handlers.onSessionExpired()
      return response
    }
    const retryHeaders = headersToRecord(init?.headers)
    for (const key of Object.keys(retryHeaders)) {
      if (key.toLowerCase() === 'authorization') delete retryHeaders[key]
    }
    retryHeaders.Authorization = `Bearer ${newToken}`
    retryHeaders[RETRY_MARKER_HEADER] = '1'
    return originalFetch(input, { ...init, headers: retryHeaders })
  }
}

export function clearAuthRetryHandlers(): void {
  handlers = null
}
