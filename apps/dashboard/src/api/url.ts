/**
 * Append query string to a path. If `path` already contains `?`, joins with `&`.
 */
export function withQuery(path: string, params: URLSearchParams): string {
  const q = params.toString()
  if (!q) return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}${q}`
}
