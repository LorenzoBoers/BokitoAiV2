import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import type { PresenceStatus } from '../../lib/teams-api'
import { presenceDotClass, presenceLabel } from '../../lib/presence'
import { StatusDot } from './status-dot'
import { Tip } from './Tip'

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
  const label = presenceLabel(status, t)
  const body = (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <StatusDot className={presenceDotClass(status)} />
      {withLabel ? <span className="text-xs text-text-secondary">{label}</span> : <span className="sr-only">{label}</span>}
    </span>
  )
  if (withLabel) return body
  return <Tip label={label}>{body}</Tip>
}
