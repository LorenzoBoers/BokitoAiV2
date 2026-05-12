const PROD_APP_HOSTNAME = (import.meta.env.VITE_APP_CONTROL_PLANE_HOST || 'app.bokito.ai').trim().toLowerCase()
const PROD_TENANT_ROOT_DOMAIN = (import.meta.env.VITE_TENANT_ROOT_DOMAIN || '.bokito.ai').trim().toLowerCase()
const DEV_APP_HOSTNAME = (import.meta.env.VITE_APP_CONTROL_PLANE_HOST_DEV || 'app.localhost').trim().toLowerCase()
const DEV_TENANT_ROOT_DOMAIN = (import.meta.env.VITE_TENANT_ROOT_DOMAIN_DEV || '.localhost').trim().toLowerCase()
const APP_CONTROL_PLANE_URL = (import.meta.env.VITE_APP_CONTROL_PLANE_URL || '').trim()

function getCurrentHostname(): string {
  if (typeof window === 'undefined') return ''
  return String(window.location.hostname || '').trim().toLowerCase()
}

function getCurrentPort(): string {
  if (typeof window === 'undefined') return ''
  return String(window.location.port || '').trim()
}

function getCurrentProtocol(): string {
  if (typeof window === 'undefined') return 'https:'
  return window.location.protocol || 'https:'
}

export function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost')
}

function isBareLocalHostname(hostname: string): boolean {
  return hostname === 'localhost'
}

export function isAppHostname(hostname: string): boolean {
  return hostname === PROD_APP_HOSTNAME || hostname === DEV_APP_HOSTNAME
}

function resolveTenantRootDomain(hostname: string): string {
  return isLocalHostname(hostname) ? DEV_TENANT_ROOT_DOMAIN : PROD_TENANT_ROOT_DOMAIN
}

function buildAppOriginForHostname(hostname: string, protocol: string, port?: string): string {
  if (APP_CONTROL_PLANE_URL) return APP_CONTROL_PLANE_URL
  if (isLocalHostname(hostname)) {
    const effectivePort = port && port.trim() ? `:${port.trim()}` : ''
    return `${protocol}//${DEV_APP_HOSTNAME}${effectivePort}`
  }
  return `${protocol}//${PROD_APP_HOSTNAME}`
}

export function buildControlPlaneUrl(pathWithQueryAndHash: string): string | null {
  const hostname = getCurrentHostname()
  if (!hostname) return null

  const protocol = getCurrentProtocol()
  const port = getCurrentPort()
  const appBase = buildAppOriginForHostname(hostname, protocol, port)
  try {
    return new URL(pathWithQueryAndHash, `${appBase}/`).toString()
  } catch {
    return null
  }
}

export function resolveTenantSubdomainFromHostname(hostname: string): string | null {
  if (!hostname || isBareLocalHostname(hostname) || isAppHostname(hostname)) return null
  const rootDomain = resolveTenantRootDomain(hostname)
  if (!hostname.endsWith(rootDomain)) return null
  const subdomain = hostname.slice(0, -rootDomain.length).trim().toLowerCase()
  if (!subdomain || subdomain === 'www') return null
  return subdomain
}

export function resolveTenantSubdomainFromHost(): string | null {
  return resolveTenantSubdomainFromHostname(getCurrentHostname())
}

export function buildAppLoginUrl(returnToAbsoluteUrl: string): string | null {
  const hostname = getCurrentHostname()
  if (!hostname || isAppHostname(hostname)) return null
  try {
    const target = new URL(returnToAbsoluteUrl)
    const appBase = buildAppOriginForHostname(target.hostname.toLowerCase(), target.protocol, target.port)
    const appLogin = new URL('/login', appBase)
    appLogin.searchParams.set('return_to', target.toString())
    return appLogin.toString()
  } catch {
    return null
  }
}

export function sanitizeCrossHostReturnTo(raw: string | null): string | null {
  if (!raw) return null
  try {
    const target = new URL(raw)
    const hostname = target.hostname.toLowerCase()
    const path = target.pathname.toLowerCase()
    const isAuthLoopPath = path === '/login' || path.startsWith('/auth/handoff')
    if (isAuthLoopPath) return null
    const isKnownAppOrTenantHost = isAppHostname(hostname) || Boolean(resolveTenantSubdomainFromHostname(hostname))
    if (isKnownAppOrTenantHost) {
      return target.toString()
    }
    return null
  } catch {
    return null
  }
}

/**
 * Cross-host access token handoff via URL hash.
 *
 * Backend `/api:auth/refresh` is not exposed, so the tenant origin cannot derive an access
 * token from the wildcard refresh cookie alone. Instead, the control plane (app host) appends
 * the active access token as a one-time URL fragment when redirecting to a sibling origin
 * inside the same root domain (`*.bokito.ai` in prod or `*.localhost` in dev). The fragment is
 * never sent to the server; the tenant origin consumes it on hydrate, persists it in its own
 * `sessionStorage`, and clears the hash via `history.replaceState`.
 *
 * Constraints:
 * - Source and target must both be inside the same allowed root (bokito.ai or localhost).
 * - Cross-origin only (same-origin already shares sessionStorage; no handoff needed).
 */
export const DEV_LOCALHOST_ACCESS_HASH_PREFIX = '__bokito_at__='

function isProdBokitoHostname(hostname: string): boolean {
  const lower = String(hostname || '').trim().toLowerCase()
  if (!lower) return false
  if (lower === PROD_APP_HOSTNAME) return true
  if (lower.endsWith(PROD_TENANT_ROOT_DOMAIN)) return true
  return false
}

function sameAllowedRoot(targetHostname: string, sourceHostname: string): boolean {
  const targetLocal = isLocalHostname(targetHostname)
  const sourceLocal = isLocalHostname(sourceHostname)
  if (targetLocal && sourceLocal) return true
  const targetProd = isProdBokitoHostname(targetHostname)
  const sourceProd = isProdBokitoHostname(sourceHostname)
  return targetProd && sourceProd
}

export function appendDevLocalhostCrossHostAccessHash(
  targetUrl: string,
  accessToken: string | null | undefined,
): string {
  const token = typeof accessToken === 'string' ? accessToken.trim() : ''
  if (!token || typeof window === 'undefined') return targetUrl
  let target: URL
  try {
    target = new URL(targetUrl)
  } catch {
    return targetUrl
  }
  if (!sameAllowedRoot(target.hostname, window.location.hostname)) return targetUrl
  if (target.origin === window.location.origin) return targetUrl
  target.hash = `${DEV_LOCALHOST_ACCESS_HASH_PREFIX}${encodeURIComponent(token)}`
  return target.toString()
}

export function consumeDevLocalhostAccessHashFromLocation(): string | null {
  if (typeof window === 'undefined') return null
  const rawHash = window.location.hash.replace(/^#/, '')
  if (!rawHash.startsWith(DEV_LOCALHOST_ACCESS_HASH_PREFIX)) return null
  const encoded = rawHash.slice(DEV_LOCALHOST_ACCESS_HASH_PREFIX.length)
  try {
    return decodeURIComponent(encoded)
  } catch {
    return null
  }
}

export function clearLocationHashPreservePath(): void {
  if (typeof window === 'undefined') return
  const { pathname, search } = window.location
  try {
    // Use `null` for state: cloning `history.state` can throw in some environments.
    window.history.replaceState(null, '', `${pathname}${search}`)
  } catch {
    // Ignore: hash clearing is best-effort only.
  }
}

/** True when target is a sibling origin inside the same allowed root (needs URL-hash token handoff). */
export function needsDevLocalhostCrossHostHandoff(targetUrl: string): boolean {
  if (typeof window === 'undefined') return false
  let target: URL
  try {
    target = new URL(targetUrl)
  } catch {
    return false
  }
  if (!target.protocol.startsWith('http')) return false
  if (!sameAllowedRoot(target.hostname, window.location.hostname)) return false
  return target.origin !== window.location.origin
}

function normalizeTenantSubdomain(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
}

export function buildTenantOrigin(subdomain: string): string | null {
  const normalized = normalizeTenantSubdomain(subdomain)
  if (!normalized) return null

  const hostname = getCurrentHostname()
  if (!hostname) return null

  const protocol = getCurrentProtocol()
  const port = getCurrentPort()
  const tenantRootDomain = resolveTenantRootDomain(hostname)

  if (isLocalHostname(hostname)) {
    const suffix = port ? `:${port}` : ''
    return `${protocol}//${normalized}${tenantRootDomain}${suffix}`
  }

  if (isAppHostname(hostname) || hostname.endsWith(PROD_TENANT_ROOT_DOMAIN)) {
    return `${protocol}//${normalized}${PROD_TENANT_ROOT_DOMAIN}`
  }

  const hostParts = hostname.split('.').filter(Boolean)
  if (hostParts.length >= 2) {
    const baseDomain = hostParts.slice(-2).join('.')
    return `${protocol}//${normalized}.${baseDomain}`
  }

  return null
}

export function buildTenantWorkspaceUrl(subdomain: string, path: string): string | null {
  const origin = buildTenantOrigin(subdomain)
  if (!origin) return null
  try {
    return new URL(path, `${origin}/`).toString()
  } catch {
    return null
  }
}

