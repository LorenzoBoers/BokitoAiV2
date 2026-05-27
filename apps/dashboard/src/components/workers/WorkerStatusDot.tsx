import { cn } from '../../lib/utils'
import {
  workerStatusDotClass,
  type WorkerOperationalState,
} from '../../lib/project-worker-status'

type WorkerStatusDotProps = {
  primary: WorkerOperationalState
  badgeCount?: number
  className?: string
}

export function WorkerStatusDot({ primary, badgeCount = 0, className }: WorkerStatusDotProps) {
  const showBadge = badgeCount > 0
  const badgeLabel = badgeCount > 99 ? '99+' : String(badgeCount)

  return (
    <span className={cn('relative inline-flex h-2 w-2 shrink-0', className)} aria-hidden>
      <span className={cn('h-2 w-2 rounded-full', workerStatusDotClass(primary))} />
      {showBadge ? (
        <span
          className={cn(
            'absolute -right-2 -top-2 flex h-[14px] min-w-[14px] items-center justify-center rounded-full px-0.5 text-[9px] font-bold leading-none text-white',
            primary === 'blocked' || primary === 'error'
              ? 'bg-status-error'
              : 'bg-status-warning',
          )}
        >
          {badgeLabel}
        </span>
      ) : null}
    </span>
  )
}
