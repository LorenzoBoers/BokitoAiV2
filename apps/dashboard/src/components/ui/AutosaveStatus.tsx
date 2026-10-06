import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import type { AutosavePhase } from '../../hooks/useAutosave'
import { timeAgo } from '../../lib/time-ago'
import { formatAppDateTime } from '../../lib/app-locale'
import { cn } from '../../lib/utils'

/** Compact “Saving…” / “Last modified …” indicator for autosave surfaces. */
export function AutosaveStatus({
  phase,
  lastSavedAt,
  error,
  className,
}: {
  phase: AutosavePhase
  lastSavedAt: Date | null
  error?: string | null
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const { t: tn } = useTranslation('nav')
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!lastSavedAt) return
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000)
    return () => window.clearInterval(id)
  }, [lastSavedAt])

  if (phase === 'saving') {
    return (
      <span
        className={cn('inline-flex items-center gap-1.5 text-xs text-text-muted', className)}
        role="status"
        aria-live="polite"
      >
        <Loader2 size={12} className="animate-spin" aria-hidden />
        {t('autosave.saving')}
      </span>
    )
  }

  if (phase === 'error') {
    return (
      <span className={cn('text-xs text-status-error', className)} role="alert">
        {error || t('autosave.error')}
      </span>
    )
  }

  if (!lastSavedAt) return null

  const relative = timeAgo(lastSavedAt.toISOString(), tn)
  if (!relative) return null

  return (
    <span
      className={cn('text-xs text-text-muted tabular-nums', className)}
      title={formatAppDateTime(lastSavedAt, i18n.language)}
      role="status"
      aria-live="polite"
    >
      {t('autosave.lastModified', { time: relative })}
    </span>
  )
}
