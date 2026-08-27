/** True when the value is an https URL, or http on localhost for local webhooks. */
export function isHttpsUrl(value: string, options?: { allowLocalHttp?: boolean }): boolean {
  const raw = value.trim()
  if (!raw) return false
  try {
    const url = new URL(raw)
    if (url.protocol === 'https:') return Boolean(url.host)
    if (
      options?.allowLocalHttp &&
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    ) {
      return true
    }
    return false
  } catch {
    return false
  }
}

/** File URL the help-center ingest can fetch: https, or a same-origin upload. */
export function isFetchableFileUrl(value: string): boolean {
  const raw = value.trim()
  if (raw.startsWith('/api/uploads/')) return raw.length > '/api/uploads/'.length
  return isHttpsUrl(raw)
}
