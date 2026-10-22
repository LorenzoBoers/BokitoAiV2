import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

/** Shared thread type scale: speech is `text-base`; everything else is this. */
export const THREAD_META = 'text-base leading-5'
export const THREAD_ICON = 14
/** Face beside a chat bubble, a mail card, and the matching meta gutter. */
export const CHAT_AVATAR_SIZE = 40
export const THREAD_GUTTER = 'flex w-10 shrink-0 justify-center'
/** Avatar column (40px) + gap-2 (8px) — activity under a bubble lines up with meta. */
export const THREAD_INDENT = 'pl-12'

const ROW = cn(
  'flex min-h-7 min-w-0 items-center gap-2',
  THREAD_META,
)

const ICON_SLOT = 'inline-flex w-3.5 shrink-0 items-center justify-center'

/** Three periods that light up left → right (Nadenken...). */
export function LiveEllipsis({ className }: { className?: string }) {
  return (
    <span className={cn('live-ellipsis', className)} aria-hidden>
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  )
}

/** Drop a static trailing "..." so live labels do not become "Nadenken......". */
function withoutTrailingDots(node: ReactNode): ReactNode {
  if (typeof node !== 'string') return node
  return node.replace(/[\s.…]+$/u, '')
}

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
      ) : icon ? (
        <span
          aria-hidden
          className={cn(ICON_SLOT, live && 'activity-live-icon')}
        >
          {icon}
        </span>
      ) : null}
      <span
        className={cn(
          'min-w-0 truncate-fade',
          live && 'activity-live-label',
        )}
      >
        {live ? (
          <span className="thinking-shimmer-text">
            {withoutTrailingDots(children)}
            <LiveEllipsis />
          </span>
        ) : (
          children
        )}
      </span>
      {suffix ? <span className="inline-flex shrink-0 items-center gap-1">{suffix}</span> : null}
      {trailing ? <span className="ml-auto shrink-0 tabular-nums text-text-muted">{trailing}</span> : null}
    </div>
  )
}

/** Avatar column + content. Empty gutter keeps meta aligned with bubbles. */
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
