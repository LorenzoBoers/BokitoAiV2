import { useTranslation } from 'react-i18next'
import { timeAgo } from '../../lib/time-ago'

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

/** Agent variant: "Active now" while working, else "Last active …" from its last run. */
export function AgentActiveLine({ at, working }: { at?: string | number | null; working: boolean }) {
  const { t } = useTranslation('communication')
  if (working) {
    return <p className="mt-0.5 text-xs text-ai-ink">{t('contactPanel.activeNow')}</p>
  }
  const iso = seenToIso(at)
  if (!iso) return null
  return (
    <p className="mt-0.5 text-xs text-text-muted">
      {t('contactPanel.lastActive', { time: timeAgo(iso, t) })}
    </p>
  )
}
