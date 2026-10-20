import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'

const SIZE = { sm: 12, md: 14, lg: 20, xl: 32 } as const

/** The one spinner. Inherits text color. xl is the full-page wait. */
export function Spinner({
  size = 'md',
  className,
  label,
}: {
  size?: keyof typeof SIZE
  className?: string
  /** Screen-reader label; omit when a visible label sits next to it. */
  label?: string
}) {
  return (
    <Loader2
      size={SIZE[size]}
      className={cn('shrink-0 animate-spin', className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'status' : undefined}
    />
  )
}

export default Spinner
