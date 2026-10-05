import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import type { PresenceStatus } from '../../lib/teams-api'
import { presenceDotClass, presenceLabel } from '../../lib/presence'
import { Tip } from './Tip'

export type CornerStatus = PresenceStatus | 'error'

/** Avatar corner dot for people, agents and teams. */
export function PresenceCorner({
  status,
  size,
}: {
  status: CornerStatus
  size: number
}) {
  const { t } = useTranslation('common')
  const label = presenceLabel(status, t)
  const dot = Math.max(6, Math.round(size * 0.32))
  return (
    <Tip label={label}>
      <span
        style={{ width: dot, height: dot }}
        className={cn(
          'absolute -bottom-px -right-px rounded-full ring-2 ring-bg-surface',
          presenceDotClass(status),
        )}
      >
        <span className="sr-only">{label}</span>
      </span>
    </Tip>
  )
}
