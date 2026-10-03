import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import type { PresenceStatus } from '../../lib/teams-api'

const DOT_CLASS: Record<PresenceStatus, string> = {
  available: 'bg-status-success',
  away: 'bg-status-warning',
  offline: 'bg-text-muted/50',
}

/** Availability of a person: available, away or offline. */
export function PresenceDot({
  status,
  withLabel = false,
  className,
}: {
  status: PresenceStatus
  withLabel?: boolean
  className?: string
}) {
  const { t } = useTranslation('common')
  const label = t(`presence.${status}`)
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} title={label}>
      <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', DOT_CLASS[status])} aria-hidden />
      {withLabel ? <span className="text-xs text-text-secondary">{label}</span> : <span className="sr-only">{label}</span>}
    </span>
  )
}
