/**
 * Tenant router for `<slug>.bokito.ai/*` on Cloudflare.
 *
 * Path-based routing:
 * - `/api/{group}/...` -> Xano API origin as `/api:{group}/...` (same-origin API for tenant host;
 *   forwards browser cookies for `.bokito.ai` so refresh tokens work on tenant subdomains).
 * - Anything else      -> Xano static host with `Host: <slug>.bokito.ai`; response gets
 *   `X-Tenant-Slug` for client-side tenant verification.
 *
 * The more-specific Workers Route `app.bokito.ai/*` is owned by `bokito-app-passthrough` and
 * pre-empts this wildcard worker for the control plane.
 *
 * Vars (Wrangler) override defaults:
 *   BOKITO_STATIC_ORIGIN  static host (HTML + assets)
 *   BOKITO_API_ORIGIN     Xano API origin (no trailing `/api:` segment)
 */
const DEFAULT_STATIC_ORIGIN = 'https://bokitoapp-prod-7443ed-xrex-nmji-j9ur.f2.xano.io'
const DEFAULT_API_ORIGIN = 'https://xrex-nmji-j9ur.f2.xano.io'

function readOrigin(value, fallback) {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || fallback
}

function proxyToOrigin(request, targetUrl, { preserveHost }) {
  const headers = new Headers(request.headers)
  if (preserveHost) {
    const incomingHost = new URL(request.url).hostname
    headers.set('Host', incomingHost)
  } else {
    headers.delete('Host')
  }
  const init = {
    method: request.method,
    headers,
    redirect: 'follow',
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body
  }
  return fetch(targetUrl, init)
}

/**
 * Force HTML responses (the SPA shell) to always revalidate. Xano serves index.html with
 * `Cache-Control: public, max-age=3600`, which causes browsers to keep stale HTML — and
 * therefore the old asset hash — for up to an hour after a redeploy. Hashed assets keep
 * their long upstream cache because their filename changes per build.
 */
function applyHtmlNoCache(response) {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('text/html')) return response
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
  headers.set('Pragma', 'no-cache')
  headers.set('Expires', '0')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function extractTenantSubdomain(hostname) {
  const lower = String(hostname || '').trim().toLowerCase()
  const match = lower.match(/^([^.]+)\.bokito\.ai$/)
  if (!match) return null
  const slug = match[1]
  if (slug === 'app' || slug === 'api' || slug === 'www') return null
  return slug
}

export default {
  async fetch(request, env) {
    const staticOrigin = readOrigin(env.BOKITO_STATIC_ORIGIN, DEFAULT_STATIC_ORIGIN)
    const apiOrigin = readOrigin(env.BOKITO_API_ORIGIN, DEFAULT_API_ORIGIN)
    const incoming = new URL(request.url)
    const tenantSlug = extractTenantSubdomain(incoming.hostname)

    const apiMatch = incoming.pathname.match(/^\/api\/([^/]+)(\/.*)?$/)
    if (apiMatch) {
      const group = apiMatch[1]
      const rest = apiMatch[2] || ''
      const apiBase = new URL(apiOrigin.endsWith('/') ? apiOrigin : `${apiOrigin}/`)
      const apiTarget = new URL(`/api:${group}${rest}${incoming.search}`, apiBase)
      return proxyToOrigin(request, apiTarget.toString(), { preserveHost: false })
    }

    const staticBase = new URL(staticOrigin.endsWith('/') ? staticOrigin : `${staticOrigin}/`)
    const staticTarget = new URL(incoming.pathname + incoming.search, staticBase)
    const upstream = await proxyToOrigin(request, staticTarget.toString(), { preserveHost: true })
    const cached = applyHtmlNoCache(upstream)

    if (!tenantSlug) return cached
    const out = new Response(cached.body, cached)
    out.headers.set('X-Tenant-Slug', tenantSlug)
    return out
  },
}
