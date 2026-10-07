import { cn } from '../../lib/utils'
import { Badge } from './badge'
import { Tip } from './Tip'

/** Inline pill next to an option title that marks the inherited default. */
export function DefaultBadge({
  children,
  title,
  className,
}: {
  children: string
  title?: string
  className?: string
}) {
  const badge = (
    <Badge
      data-testid="default-badge"
      variant="info"
      className={cn('shrink-0', className)}
    >
      {children}
    </Badge>
  )
  return title ? <Tip label={title}>{badge}</Tip> : badge
}
