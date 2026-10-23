import * as React from 'react'
import { Link } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { EmptyState } from './empty-state'
import { LoadingBlock } from './loading-block'
import { Pressable } from './pressable'
import { StatusDot } from './status-dot'

type EntityRowProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'title' | 'onClick'> & {
  /** Left of `leading`, outside the click zone: a checkbox or a state dot. */
  select?: React.ReactNode
  /** Leading visual: Avatar, IconTile, BrandMark. */
  leading?: React.ReactNode
  title: React.ReactNode
  /** Badge(s) right after the title. */
  badges?: React.ReactNode
  /** Second line, one line, truncated. */
  description?: React.ReactNode
  /** Extra line under the description, inside the click zone. */
  footer?: React.ReactNode
  /** Top right next to the title, e.g. a time. Gives way to `actions` on hover. */
  meta?: React.ReactNode
  /** Right side, always visible: a value, a chevron, a button. */
  trailing?: React.ReactNode
  /** Shown on hover, focus or `data-menu-open`; takes no space otherwise. */
  actions?: React.ReactNode
  /** Hover feedback. With `onClick` the main zone is a `Pressable`. */
  interactive?: boolean
  onClick?: React.MouseEventHandler<HTMLButtonElement>
  /** Main zone is a router link. */
  href?: string
  selected?: boolean
  /** Title 600, plus an accent dot unless `select` already carries the state. */
  unread?: boolean
  /** Row height: `sm` 44px, `md` 56px. */
  density?: 'sm' | 'md'
}

const MAIN_CLASS = 'flex min-w-0 flex-1 items-center gap-3 self-stretch'

const SHOW_ON_ROW_ACTIVE =
  'group-hover/row:flex group-focus-within/row:flex group-data-[menu-open]/row:flex'
const HIDE_ON_ROW_ACTIVE =
  'group-hover/row:hidden group-focus-within/row:hidden group-data-[menu-open]/row:hidden'

/** One person, agent, channel, key or resource in a list. */
export const EntityRow = React.forwardRef<HTMLDivElement, EntityRowProps>(
  (
    {
      select,
      leading,
      title,
      badges,
      description,
      footer,
      meta,
      trailing,
      actions,
      interactive = false,
      onClick,
      href,
      selected = false,
      unread = false,
      density = 'md',
      className,
      ...props
    },
    ref,
  ) => {
    const body = (
      <>
        {leading ? <div className="shrink-0">{leading}</div> : null}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            {unread && !select ? <StatusDot className="bg-accent" /> : null}
            <span
              className={cn(
                'min-w-0 truncate text-sm text-text-heading',
                unread ? 'font-semibold' : 'font-medium',
              )}
            >
              {title}
            </span>
            {badges}
            {meta ? (
              <span className={cn('ml-auto shrink-0 pl-2 text-xs text-text-muted', actions && HIDE_ON_ROW_ACTIVE)}>
                {meta}
              </span>
            ) : null}
          </div>
          {description ? <div className="mt-0.5 min-w-0 truncate text-xs text-text-muted">{description}</div> : null}
          {footer}
        </div>
      </>
    )
    const main = href ? (
      <Link
        to={href}
        className={cn(
          MAIN_CLASS,
          'rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
        )}
      >
        {body}
      </Link>
    ) : interactive && onClick ? (
      <Pressable onClick={onClick} className={MAIN_CLASS}>
        {body}
      </Pressable>
    ) : (
      <div className={MAIN_CLASS}>{body}</div>
    )
    return (
      <div
        ref={ref}
        data-selected={selected || undefined}
        className={cn(
          'group/row flex min-w-0 items-center gap-3 rounded-md',
          density === 'sm' ? 'min-h-11 px-2.5 py-1.5' : 'min-h-14 px-3 py-2',
          (interactive || href) && 'cursor-pointer transition-colors',
          selected ? 'bg-bg-hover' : (interactive || href) && 'hover:bg-bg-hover/50',
          className,
        )}
        {...props}
      >
        {select ? <div className="flex shrink-0 items-center self-stretch">{select}</div> : null}
        {main}
        {actions ? (
          <div className={cn('hidden shrink-0 items-center gap-1', SHOW_ON_ROW_ACTIVE)}>{actions}</div>
        ) : null}
        {trailing ? <div className="flex shrink-0 items-center gap-2">{trailing}</div> : null}
      </div>
    )
  },
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
  const labelClass = text
    ? 'text-sm font-medium text-text-heading'
    : 'text-2xs font-normal leading-none text-text-muted'
  return (
    <div
      className={cn(
        'flex min-w-0 justify-between gap-2',
        text
          ? 'flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:gap-x-4'
          : 'items-start gap-x-3 py-0.5',
        className,
      )}
    >
      <div className={cn('min-w-0', text ? 'flex-1' : 'shrink-0 pt-1')}>
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
            'flex min-w-0 flex-wrap items-center justify-end gap-1.5',
            text ? 'w-full sm:w-auto sm:max-w-[16rem]' : 'flex-1',
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

type EntityListProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Shown when there are no rows: a title string or a full `EmptyState`. */
  empty?: React.ReactNode
  loading?: boolean
  /** Skeleton rows while loading. */
  loadingRows?: number
}

/** Divided stack of EntityRows inside a Card or InsetPanel. */
export function EntityList({ empty, loading = false, loadingRows = 3, className, children, ...props }: EntityListProps) {
  if (loading) return <LoadingBlock variant="skeleton" rows={loadingRows} className={className} />
  if (empty != null && React.Children.toArray(children).length === 0) {
    return typeof empty === 'string' ? <EmptyState tone="plain" size="sm" title={empty} className={className} /> : <>{empty}</>
  }
  return (
    <div className={cn('divide-y divide-border', className)} {...props}>
      {children}
    </div>
  )
}

export default EntityRow
