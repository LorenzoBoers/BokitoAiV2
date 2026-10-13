import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

/** Shared thread type scale: speech is `text-base`; everything else is this. */
export const THREAD_META = 'text-[13px] leading-5'
export const THREAD_ICON = 14
export const THREAD_GUTTER = 'flex w-7 shrink-0 justify-center'
/** Avatar column (28px) + gap-2 (8px) — activity under a bubble lines up with meta. */
export const THREAD_INDENT = 'pl-9'

const ROW = cn(
  'flex min-h-7 min-w-0 items-center gap-2',
  THREAD_META,
)

const ICON_SLOT = 'inline-flex w-3.5 shrink-0 items-center justify-center'

/**
 * One quiet line in the thread: events, activity, preparing.
 * Same size and column as every other non-speech row.
 */
export function ThreadMetaRow({
  icon,
  lead,
  children,
  suffix,
  trailing,
  live = false,
  ai = false,
  className,
}: {
  icon?: ReactNode
  /** Wider than 14px (icon strips). Replaces the reserved icon slot. */
  lead?: ReactNode
  children: ReactNode
  /** Chevron / error mark, after the label, before the duration. */
  suffix?: ReactNode
  trailing?: ReactNode
  live?: boolean
  ai?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        ROW,
        ai ? 'text-ai-ink' : 'text-text-secondary',
        className,
      )}
    >
      {lead ? (
        <span aria-hidden className={cn('inline-flex shrink-0 items-center', live && 'activity-live-icon')}>
          {lead}
        </span>
      ) : (
        <span
          aria-hidden
          className={cn(ICON_SLOT, live && icon && 'activity-live-icon')}
        >
          {icon ?? null}
        </span>
      )}
      <span
        className={cn(
          'min-w-0 truncate-fade',
          live && 'activity-live-label',
        )}
      >
        {live ? <span className="thinking-shimmer-text">{children}</span> : children}
      </span>
      {suffix ? <span className="inline-flex shrink-0 items-center gap-1">{suffix}</span> : null}
      {trailing ? <span className="ml-auto shrink-0 tabular-nums text-text-muted">{trailing}</span> : null}
    </div>
  )
}

/** Avatar column (28px) + content. Empty gutter keeps meta aligned with bubbles. */
export function ThreadMetaBlock({
  avatar,
  header,
  children,
  className,
}: {
  avatar?: ReactNode
  header?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start gap-2', className)}>
      <span className={THREAD_GUTTER}>{avatar ?? null}</span>
      <div className="flex min-w-0 max-w-[85%] flex-1 flex-col">
        {header ? (
          <div className="mb-0.5 text-xs font-semibold leading-4 text-text-heading">{header}</div>
        ) : null}
        {children}
      </div>
    </div>
  )
}
