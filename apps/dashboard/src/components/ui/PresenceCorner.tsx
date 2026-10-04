import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import type { PresenceStatus } from '../../lib/teams-api'
import { Tip } from './Tip'

export type CornerStatus = PresenceStatus | 'error'

const DOT_CLASS: Record<CornerStatus, string> = {
  available: 'bg-status-success',
  away: 'bg-status-warning',
  offline: 'bg-text-muted/60',
  standby: 'bg-ai',
  working: 'presence-working-dot',
  error: 'bg-status-error',
}

/** Avatar corner dot for people, agents and teams. */
export function PresenceCorner({
  status,
  size,
}: {
  status: CornerStatus
  size: number
}) {
  const { t } = useTranslation('common')
  const label = t(`presence.${status}`)
  const dot = Math.max(6, Math.round(size * 0.32))
  return (
    <Tip label={label}>
      <span
        style={{ width: dot, height: dot }}
        className={cn(
          'absolute -bottom-px -right-px rounded-full ring-2 ring-bg-surface',
          DOT_CLASS[status],
        )}
      >
        <span className="sr-only">{label}</span>
      </span>
    </Tip>
  )
}
