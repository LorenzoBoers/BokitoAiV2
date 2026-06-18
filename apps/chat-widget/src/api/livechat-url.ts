/**
 * URL helpers for the livechat API (`/api/livechat`) and related API groups.
 */

export const LIVECHAT_DEFAULT_HOST_AUTH_GROUP = 'auth' as const

const LIVECHAT_PREFIX = '/api/livechat'
/** Legacy embed scripts used a colon-style group path; normalize to the FastAPI prefix. */
const LEGACY_COLON_LIVECHAT_PREFIX = '/api:livechat'

export function normalizeLivechatApiBase(raw: string): string {
  const trimmed = String(raw ?? '').trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (trimmed.includes(LEGACY_COLON_LIVECHAT_PREFIX)) {
    return trimmed.slice(0, trimmed.indexOf(LEGACY_COLON_LIVECHAT_PREFIX)) + LIVECHAT_PREFIX
  }
  return trimmed.endsWith(LIVECHAT_PREFIX) ? trimmed : `${trimmed}${LIVECHAT_PREFIX}`
}

export function livechatHttpUrl(baseUrl: string, path: string): string {
  const base = normalizeLivechatApiBase(baseUrl)
  const segment = path.startsWith('/') ? path : `/${path}`
  return `${base}${segment}`
}

/** Build a same-origin API URL for a named router group (e.g. auth -> `/api/auth/me`). */
export function apiGroupUrl(apiOrigin: string, group: string, path: string): string {
  const root = normalizeApiOrigin(apiOrigin)
  const segment = path.startsWith('/') ? path : `/${path}`
  return `${root}/api/${group}${segment}`
}

/** Strip livechat (or legacy group) suffixes so callers get the site origin only. */
export function normalizeApiOrigin(raw: string): string {
  const trimmed = String(raw ?? '').trim().replace(/\/+$/, '')
  for (const marker of [LIVECHAT_PREFIX, LEGACY_COLON_LIVECHAT_PREFIX]) {
    const idx = trimmed.indexOf(marker)
    if (idx >= 0) return trimmed.slice(0, idx).replace(/\/+$/, '') || trimmed.slice(0, idx)
  }
  const legacyIdx = trimmed.indexOf('/api:')
  if (legacyIdx >= 0) return trimmed.slice(0, legacyIdx).replace(/\/+$/, '')
  return trimmed
}

/** Derive the gateway WebSocket URL from a livechat or site API base. */
export function gatewayWebSocketUrl(apiBase: string): string {
  const origin = normalizeApiOrigin(apiBase)
  const wsOrigin = origin.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:')
  return `${wsOrigin}/api/ws`
}
