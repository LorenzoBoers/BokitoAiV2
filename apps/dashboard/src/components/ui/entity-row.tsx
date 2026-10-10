import * as React from 'react'
import { cn } from '../../lib/utils'

type EntityRowProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> & {
  /** Leading visual: Avatar, IconTile, BrandMark. */
  leading?: React.ReactNode
  title: React.ReactNode
  /** Badge(s) right after the title. */
  badges?: React.ReactNode
  /** Secondary line, usually a MetaLine or short description. */
  meta?: React.ReactNode
  /** Right-aligned actions or values. */
  trailing?: React.ReactNode
  /** Row reacts to hover (clickable lists). */
  interactive?: boolean
  /** `md` (default) for lists, `sm` for dense sublists. */
  density?: 'sm' | 'md'
}

/** One person, agent, channel, key or resource in a list. */
export const EntityRow = React.forwardRef<HTMLDivElement, EntityRowProps>(
  (
    { leading, title, badges, meta, trailing, interactive = false, density = 'md', className, ...props },
    ref,
  ) => (
    <div
      ref={ref}
      className={cn(
        'flex min-w-0 items-center gap-3',
        density === 'sm' ? 'px-2.5 py-2' : 'px-3 py-2.5',
        interactive && 'cursor-pointer rounded-md transition-colors hover:bg-bg-hover/60',
        className,
      )}
      {...props}
    >
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="min-w-0 truncate text-sm font-medium text-text-heading">{title}</span>
          {badges}
        </div>
        {meta ? <div className="mt-0.5 min-w-0 text-xs text-text-muted">{meta}</div> : null}
      </div>
      {trailing ? <div className="flex shrink-0 items-center gap-2">{trailing}</div> : null}
    </div>
  ),
)
EntityRow.displayName = 'EntityRow'

/**
 * Label on the left, control on the right. The one settings line
 * (contact panel, channel config, conversation side panel).
 */
export function SettingRow({
  label,
  hint,
  children,
  density = 'inline',
  htmlFor,
  className,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  children?: React.ReactNode
  /** `inline` for side panels; `field` when the label has a hint. */
  density?: 'inline' | 'field'
  htmlFor?: string
  className?: string
}) {
  const text = density === 'field'
  const labelClass = text ? 'text-sm font-medium text-text-heading' : 'text-xs font-medium text-text-secondary'
  return (
    <div
      className={cn(
        'flex min-w-0 justify-between gap-3',
        text ? 'flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:gap-x-4' : 'items-center',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {typeof label === 'string' ? (
          htmlFor ? (
            <label htmlFor={htmlFor} className={labelClass}>
              {label}
            </label>
          ) : (
            <p className={labelClass}>{label}</p>
          )
        ) : (
          label
        )}
        {hint ? <p className="mt-0.5 text-xs leading-snug text-text-muted">{hint}</p> : null}
      </div>
      {children ? (
        <div
          className={cn(
            'flex min-w-0 items-center justify-end gap-1.5',
            text ? 'w-full sm:w-auto sm:max-w-[16rem]' : 'shrink-0',
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}

/** Label / value pair for detail panels (contact, key, channel facts). */
export function DescriptionRow({
  label,
  children,
  className,
}: {
  label: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 items-baseline justify-between gap-3 py-1.5 text-sm', className)}>
      <span className="shrink-0 text-xs text-text-muted">{label}</span>
      <span className="min-w-0 truncate text-right text-text-primary">{children}</span>
    </div>
  )
}

/** Divided stack of EntityRows inside a Card or InsetPanel. */
export function EntityList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('divide-y divide-border/40', className)} {...props} />
}

export default EntityRow
