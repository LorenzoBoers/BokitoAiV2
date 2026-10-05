type Translate = (key: string, opts?: Record<string, unknown>) => string

/** "now", "5m ago", "3h ago", "2d ago" from the shared `nav:timeAgo` copy. */
export function timeAgo(iso: string | null | undefined, t: Translate): string {
  if (!iso) return ''
  const at = new Date(iso).getTime()
  if (!Number.isFinite(at)) return ''
  const minutes = Math.floor((Date.now() - at) / 60_000)
  if (minutes < 1) return t('timeAgo.now', { ns: 'nav' })
  if (minutes < 60) return t('timeAgo.minutesAgo', { ns: 'nav', count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('timeAgo.hoursAgo', { ns: 'nav', count: hours })
  return t('timeAgo.daysAgo', { ns: 'nav', count: Math.floor(hours / 24) })
}
