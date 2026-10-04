import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import type { PresenceStatus } from '../../lib/teams-api'
import { Tip } from './Tip'

const DOT_CLASS: Record<PresenceStatus, string> = {
  available: 'bg-status-success',
  away: 'bg-status-warning',
  offline: 'bg-text-muted/50',
  standby: 'bg-ai',
  working: 'presence-working-dot',
}

/** Availability of a person, agent or team. */
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
  const body = (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span
        className={cn('inline-block h-2 w-2 shrink-0 rounded-full', DOT_CLASS[status])}
        aria-hidden
      />
      {withLabel ? <span className="text-xs text-text-secondary">{label}</span> : <span className="sr-only">{label}</span>}
    </span>
  )
  if (withLabel) return body
  return <Tip label={label}>{body}</Tip>
}
