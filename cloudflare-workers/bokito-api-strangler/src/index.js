/**
 * Strangler fig proxy: route migrated Bokito AI OS API paths to the new Python backend,
 * while legacy Xano paths continue to the existing origin.
 *
 * Env:
 * - BOKITO_API_ORIGIN (e.g. https://api.bokito.ai or http://127.0.0.1:8000)
 * - BOKITO_XANO_ORIGIN (existing Xano base)
 */

const MIGRATED_PREFIXES = [
  '/api/auth',
  '/api/chat',
  '/api/notifications',
  '/api/blueprint',
  '/api/integrations',
  '/api/email',
  '/api/health',
]

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const bokitoOrigin = env.BOKITO_API_ORIGIN || 'http://127.0.0.1:8000'
    const xanoOrigin = env.BOKITO_XANO_ORIGIN || 'https://xrex-nmji-j9ur.f2.xano.io'

    const useBokito = MIGRATED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
    const targetOrigin = useBokito ? bokitoOrigin : xanoOrigin
    const targetUrl = new URL(url.pathname + url.search, targetOrigin)

    const headers = new Headers(request.headers)
    headers.set('Host', targetUrl.host)

    return fetch(
      new Request(targetUrl.toString(), {
        method: request.method,
        headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
        redirect: 'manual',
      }),
    )
  },
}
