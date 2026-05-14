/**
 * Normalise Xano origin used as widget `data-api-url`: trim, strip trailing slashes,
 * and remove a trailing `/api:livechat` segment so callers can append `/api:livechat/...` once.
 */
export function normalizeLivechatApiBase(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api:livechat$/, '')
}

/**
 * Full HTTP URL for a path under `api:livechat`.
 * `segment` is the path after `api:livechat/` without a leading slash (may include query string).
 */
export function livechatHttpUrl(apiBase: string, segment: string): string {
  const base = normalizeLivechatApiBase(apiBase)
  const path = segment.replace(/^\//, '')
  return `${base}/api:livechat/${path}`
}

/**
 * Generic Xano API group URL: `{origin}/api:{groupName}/{path}`.
 * `groupName` is the short group id (e.g. `DavdZOps`), not including `api:`.
 */
export function xanoApiGroupUrl(apiBase: string, groupName: string, path: string): string {
  const base = normalizeLivechatApiBase(apiBase)
  const g = String(groupName || '')
    .trim()
    .replace(/^:+/, '')
    .replace(/^api:?/i, '')
  const p = path.replace(/^\//, '')
  return `${base}/api:${g}/${p}`
}

/** WebSocket URL for Xano realtime (not under `api:livechat`). */
export function realtimeWebSocketUrl(apiBase: string): string {
  const base = normalizeLivechatApiBase(apiBase)
  return `${base.replace(/^http/, 'ws')}/realtime`
}
