import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

/** The one 8px dot behind presence, thread state and free-label marks. Pass the fill as className. */
export function StatusDot({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden
      {...props}
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', className)}
    />
  )
}
