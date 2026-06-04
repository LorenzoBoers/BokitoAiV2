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

export function realtimeWebSocketUrl(xanoBase: string, channel: string): string {
  const http = String(xanoBase ?? '').trim().replace(/\/+$/, '')
  const wsBase = http.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:')
  const ch = channel.replace(/^\/+/, '')
  return `${wsBase}/rt/${ch}`
}
