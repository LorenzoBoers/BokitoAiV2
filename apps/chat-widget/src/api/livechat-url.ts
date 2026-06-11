/**
 * URL helpers for the livechat API group and related Xano groups.
 */

export const LIVECHAT_DEFAULT_HOST_AUTH_GROUP = 'auth' as const

const LIVECHAT_GROUP_MARKER = '/api:livechat'

export function normalizeLivechatApiBase(raw: string): string {
  const trimmed = String(raw ?? '').trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (trimmed.includes(LIVECHAT_GROUP_MARKER)) {
    const idx = trimmed.indexOf(LIVECHAT_GROUP_MARKER)
    return trimmed.slice(0, idx + LIVECHAT_GROUP_MARKER.length)
  }
  return trimmed.endsWith('/api:livechat') ? trimmed : `${trimmed}/api:livechat`
}

export function livechatHttpUrl(baseUrl: string, path: string): string {
  const base = normalizeLivechatApiBase(baseUrl)
  const segment = path.startsWith('/') ? path : `/${path}`
  return `${base}${segment}`
}

export function xanoApiGroupUrl(
  xanoBase: string,
  groupCanonical: string,
  path: string
): string {
  const root = String(xanoBase ?? '').trim().replace(/\/+$/, '')
  const group = groupCanonical.replace(/^\/+|\/+$/g, '')
  const segment = path.startsWith('/') ? path : `/${path}`
  return `${root}/api:${group}${segment}`
}

/**
 * Gateway WebSocket endpoint derived from the livechat API base.
 * `https://host/api:livechat` -> `wss://host/api/ws`.
 */
export function gatewayWebSocketUrl(apiBase: string): string {
  const base = String(apiBase ?? '').trim().replace(/\/+$/, '')
  const idx = base.indexOf('/api:')
  const origin = idx >= 0 ? base.slice(0, idx) : base
  const wsOrigin = origin.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:')
  return `${wsOrigin}/api/ws`
}
