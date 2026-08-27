export type ActivitySource = 'all' | 'agents' | 'people'
export type ActivityDetail = 'headlines' | 'all'

export function parseActivitySource(value: string | null): ActivitySource {
  if (value === 'agents' || value === 'people') return value
  return 'all'
}

export function parseActivityDetail(value: string | null): ActivityDetail {
  return value === 'all' ? 'all' : 'headlines'
}

export function parseActivityFollow(value: string | null): boolean {
  return value !== '0'
}

/** Merge Activity filters into the current search string. */
export function activitySearchParams(
  current: URLSearchParams,
  patch: {
    source?: ActivitySource
    detail?: ActivityDetail
    q?: string
    follow?: boolean
  },
): URLSearchParams {
  const next = new URLSearchParams(current)
  if (patch.source !== undefined) {
    if (patch.source === 'all') next.delete('source')
    else next.set('source', patch.source)
  }
  if (patch.detail !== undefined) {
    if (patch.detail === 'headlines') next.delete('detail')
    else next.set('detail', patch.detail)
  }
  if (patch.q !== undefined) {
    const q = patch.q.trim()
    if (!q) next.delete('q')
    else next.set('q', q)
  }
  if (patch.follow !== undefined) {
    if (patch.follow) next.delete('follow')
    else next.set('follow', '0')
  }
  return next
}
