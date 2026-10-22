import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import type { PresenceStatus } from '../../lib/teams-api'
import { markDotSize } from '../../lib/mark-scale'
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
  const dot = markDotSize(size)
  return (
    <Tip label={label}>
      <span
        style={{ width: dot, height: dot }}
        className={cn(
          'absolute -bottom-px -right-px z-10 rounded-full ring-2 ring-cutout',
          presenceDotClass(status),
        )}
      >
        <span className="sr-only">{label}</span>
      </span>
    </Tip>
  )
}
