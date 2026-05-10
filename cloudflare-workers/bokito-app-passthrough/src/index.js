/**
 * Passthrough for app.bokito.ai: forward to bokitoapp-prod static host with Host preserved
 * for Xano custom-domain mapping. Tenant wildcard worker (*.bokito.ai) is bypassed for this host.
 *
 * BOKITO_STATIC_ORIGIN (Wrangler var) overrides the default when set.
 */
const DEFAULT_STATIC_ORIGIN = 'https://bokitoapp-prod-7443ed-xrex-nmji-j9ur.f2.xano.io'

export default {
  async fetch(request, env) {
    const fromEnv = typeof env.BOKITO_STATIC_ORIGIN === 'string' ? env.BOKITO_STATIC_ORIGIN.trim() : ''
    const staticOrigin = fromEnv || DEFAULT_STATIC_ORIGIN
    const incoming = new URL(request.url)
    const base = new URL(staticOrigin.endsWith('/') ? staticOrigin : `${staticOrigin}/`)
    const target = new URL(incoming.pathname + incoming.search, base)
    const headers = new Headers(request.headers)
    headers.set('Host', incoming.hostname)
    const init = {
      method: request.method,
      headers,
      redirect: 'follow',
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body
    }
    return fetch(target.toString(), init)
  },
}
