import * as React from 'react'
import { cn } from '../../lib/utils'

const TONE = {
  accent: 'border-accent/50 bg-accent/5 ring-1 ring-accent/30',
  ai: 'border-ai/50 bg-ai/5 ring-1 ring-ai/30',
} as const

type OptionCardProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title'> & {
  selected?: boolean
  /** Selected ring color. `ai` for agent / model choices. */
  tone?: keyof typeof TONE
  /** Leading visual (IconTile, ModelIcon, BrandMark). */
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  /** Right of the title (selected Badge, status Badge). */
  badge?: React.ReactNode
  /** Read-only: renders the card without click affordance. */
  readOnly?: boolean
}

/** One choice in a set of large selectable cards (modes, tiers, plans). */
export const OptionCard = React.forwardRef<HTMLButtonElement, OptionCardProps>(
  (
    {
      selected = false,
      tone = 'accent',
      icon,
      title,
      description,
      badge,
      readOnly = false,
      className,
      children,
      disabled,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled || readOnly}
      className={cn(
        'flex h-full w-full flex-col gap-2 rounded-lg border px-3 py-3 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
        selected ? TONE[tone] : 'border-border/60 bg-bg-elevated hover:border-border',
        readOnly ? 'cursor-default' : 'cursor-pointer',
        disabled && !readOnly && 'cursor-not-allowed opacity-60',
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {icon ? <span className="shrink-0">{icon}</span> : null}
        <span className="min-w-0 text-sm font-medium text-text-heading">{title}</span>
        {badge}
      </div>
      {description ? <span className="text-xs text-text-muted">{description}</span> : null}
      {children}
    </button>
  ),
)
OptionCard.displayName = 'OptionCard'

const COLS = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
} as const

/** Grid wrapper for OptionCards; exposes the set as a radiogroup. */
export function OptionCardGrid({
  columns = 3,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { columns?: keyof typeof COLS }) {
  return (
    <div role="radiogroup" className={cn('grid gap-3', COLS[columns], className)} {...props}>
      {children}
    </div>
  )
}

export default OptionCard
