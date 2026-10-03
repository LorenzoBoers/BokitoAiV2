import { cn } from '../../lib/utils'
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
    <span
      data-testid="default-badge"
      className={cn(
        'shrink-0 rounded-full bg-bg-hover px-1.5 py-px text-2xs font-semibold text-text-secondary',
        className,
      )}
    >
      {children}
    </span>
  )
  return title ? <Tip label={title}>{badge}</Tip> : badge
}
