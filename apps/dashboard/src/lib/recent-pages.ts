export const RECENT_PAGES_KEY = 'bokito.recent.pages'
export const RECENT_PAGES_MAX = 8

export type RecentPage = {
  path: string
  title: string
  at: number
}

const SKIP_PREFIXES = ['/login', '/signup', '/invite', '/auth', '/accept-invite']
const KEEP_QUERY_KEYS = ['tab', 'view', 'project_id'] as const

export function recentLocationKey(pathname: string, search = ''): string {
  const raw = search.startsWith('?') ? search.slice(1) : search
  const params = new URLSearchParams(raw)
  const keep = new URLSearchParams()
  for (const key of KEEP_QUERY_KEYS) {
    const value = params.get(key)?.trim()
    if (value) keep.set(key, value)
  }
  const path = pathname.replace(/\/t\/[^/]+$/, '').replace(/\/+$/, '') || '/'
  const qs = keep.toString()
  return qs ? `${path}?${qs}` : path
}

export function shouldRecordRecentPage(path: string): boolean {
  const pathname = path.split('?')[0] || '/'
  if (pathname === '/') return false
  return !SKIP_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

function readStore(): RecentPage[] {
  try {
    const raw = localStorage.getItem(RECENT_PAGES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (row): row is RecentPage =>
          Boolean(row) &&
          typeof row === 'object' &&
          typeof (row as RecentPage).path === 'string' &&
          typeof (row as RecentPage).title === 'string',
      )
      .slice(0, RECENT_PAGES_MAX)
  } catch {
    return []
  }
}

export function listRecentPages(): RecentPage[] {
  return readStore()
}

export function recordRecentPage(path: string, title: string): RecentPage[] {
  const trimmed = title.trim()
  if (!shouldRecordRecentPage(path) || !trimmed) return listRecentPages()
  const next: RecentPage = { path, title: trimmed, at: Date.now() }
  const pages = [next, ...listRecentPages().filter((row) => row.path !== path)].slice(0, RECENT_PAGES_MAX)
  try {
    localStorage.setItem(RECENT_PAGES_KEY, JSON.stringify(pages))
  } catch {
    // ignore quota / private mode
  }
  return pages
}
