import * as React from 'react'
import { cn } from '../../lib/utils'

type FilterChipProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean
  /** Optional trailing count. */
  count?: number
  icon?: React.ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>
}

/** Toggleable filter in a row of filters (Bin types, docs sections, tags). */
export const FilterChip = React.forwardRef<HTMLButtonElement, FilterChipProps>(
  ({ active = false, count, icon: Icon, className, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-pressed={active}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:pointer-events-none disabled:opacity-50',
        active
          ? 'bg-accent/12 text-accent'
          : 'bg-bg-hover/60 text-text-secondary hover:bg-bg-hover hover:text-text-heading',
        className,
      )}
      {...props}
    >
      {Icon ? <Icon size={12} className="shrink-0" aria-hidden /> : null}
      {children}
      {typeof count === 'number' ? (
        <span className={cn('tabular-nums', active ? 'text-accent/80' : 'text-text-muted')}>{count}</span>
      ) : null}
    </button>
  ),
)
FilterChip.displayName = 'FilterChip'

export function FilterChipRow({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-wrap items-center gap-1.5', className)} {...props} />
}

export default FilterChip
