import { useTranslation } from 'react-i18next'

/** Shared grey "Last seen …" line under the identity kind label. */
export function timeAgo(iso: string | null, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return t('contactPanel.now')
  if (minutes < 60) return t('contactPanel.minutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('contactPanel.hoursAgo', { count: hours })
  return t('contactPanel.daysAgo', { count: Math.floor(hours / 24) })
}

export function seenToIso(value: string | number | null | undefined): string | null {
  if (value == null || value === '') return null
  if (typeof value === 'number') {
    if (value <= 0) return null
    const ms = value < 1e12 ? value * 1000 : value
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : value
}

export function IdentitySeenLine({ at }: { at?: string | number | null }) {
  const { t } = useTranslation('communication')
  const iso = seenToIso(at)
  if (!iso) return null
  return (
    <p className="mt-0.5 text-xs text-text-muted">
      {t('contactPanel.lastSeen', { time: timeAgo(iso, t) })}
    </p>
  )
}
