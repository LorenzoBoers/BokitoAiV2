import type { ReactNode } from 'react'
import { chatRunCloses, chatRunLeads, type BubbleStack } from '../../lib/chat-layout'
import { cn } from '../../lib/utils'

/**
 * Chat bubble primitives for every conversation surface (customer threads,
 * suggested replies, agent sessions). One shell, five tones, WhatsApp-style
 * grouping: the first bubble of a run carries avatar, name and the pointed
 * corner; follow-ups hug it with flattened inner corners.
 */

export type BubbleVariant = 'external' | 'team' | 'agent' | 'self' | 'note'

/** Position in a run of consecutive same-author messages; shared with the widget. */
export type { BubbleStack }

const TONE: Record<BubbleVariant, string> = {
  external: 'bg-bg-surface ring-1 ring-inset ring-border/60 shadow-[0_1px_2px_rgb(0_0_0/0.04)]',
  team: 'bg-bg-elevated ring-1 ring-inset ring-border/40',
  agent: 'bg-ai/[0.07] ring-1 ring-inset ring-ai/20',
  self: 'bg-accent/[0.13] ring-1 ring-inset ring-accent/20',
  note: 'bg-status-warning/[0.07] ring-1 ring-inset ring-status-warning/25',
}

/** Outer corners stay round; the corner facing the avatar (or the neighbour) tightens. */
function shapeFor(side: 'left' | 'right', stack: BubbleStack): string {
  const base = 'rounded-[18px]'
  if (side === 'left') {
    if (stack === 'start') return cn(base, 'rounded-tl-[6px] rounded-bl-[6px]')
    if (stack === 'middle') return cn(base, 'rounded-l-[6px]')
    return cn(base, 'rounded-tl-[6px]')
  }
  if (stack === 'start') return cn(base, 'rounded-tr-[6px] rounded-br-[6px]')
  if (stack === 'middle') return cn(base, 'rounded-r-[6px]')
  return cn(base, 'rounded-tr-[6px]')
}

const leadsRun = chatRunLeads
const closesRun = chatRunCloses

/** One-line author row: name, optional chip, muted context, trailing slot. */
export function BubbleHeader({
  name,
  subtitle,
  chip,
  trailing,
}: {
  name?: ReactNode
  subtitle?: ReactNode
  chip?: ReactNode
  trailing?: ReactNode
}) {
  if (name == null && subtitle == null && chip == null && trailing == null) return null
  return (
    <div className="mb-0.5 flex min-w-0 items-center gap-1.5 text-xs leading-4">
      {name != null ? (
        <span className="shrink-0 truncate-fade font-semibold text-text-heading">{name}</span>
      ) : null}
      {chip}
      {subtitle != null ? (
        <span className="min-w-0 truncate-fade text-text-muted">{subtitle}</span>
      ) : null}
      {trailing}
    </div>
  )
}

/** Small icon button for the hover toolbar beside a bubble. */
export function BubbleAction({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded-md transition-colors disabled:opacity-40',
        active
          ? 'bg-accent/10 text-accent'
          : 'text-text-muted hover:bg-bg-hover hover:text-text-primary',
      )}
    >
      {children}
    </button>
  )
}

export function ChatMessageBubble({
  side,
  avatar,
  header,
  body,
  meta,
  actions,
  variant,
  stack = 'single',
  className,
  bubbleClassName,
  onClick,
}: {
  side: 'left' | 'right'
  /** Shown on the left only, and only on the bubble that leads a run. */
  avatar?: ReactNode
  header?: ReactNode
  body: ReactNode
  /** Small trailing line (time, delivery state) on the bubble that closes a run. */
  meta?: ReactNode
  /** Hover toolbar beside the bubble; takes no layout space. */
  actions?: ReactNode
  variant: BubbleVariant
  stack?: BubbleStack
  className?: string
  bubbleClassName?: string
  onClick?: () => void
}) {
  const isRight = side === 'right'
  const lead = leadsRun(stack)

  const bubble = (
    <div
      className={cn(
        'relative min-w-0 max-w-[85%] px-3.5 py-2 text-base leading-relaxed text-text-primary',
        shapeFor(side, stack),
        TONE[variant],
        onClick && 'text-left transition-colors hover:brightness-[0.98]',
        bubbleClassName,
      )}
    >
      {lead ? header : null}
      {body}
      {meta != null && closesRun(stack) ? (
        <div className="mt-0.5 flex justify-end gap-1 text-2xs leading-none text-text-muted tabular-nums">
          {meta}
        </div>
      ) : null}
      {actions ? (
        <div
          className={cn(
            'absolute top-1 flex items-center gap-0.5 rounded-lg bg-bg-surface/95 p-0.5 opacity-0 shadow-sm ring-1 ring-border/50 backdrop-blur transition-opacity',
            'pointer-events-none group-hover/bubble:pointer-events-auto group-hover/bubble:opacity-100',
            'focus-within:pointer-events-auto focus-within:opacity-100',
            isRight ? 'right-full mr-1.5' : 'left-full ml-1.5',
          )}
        >
          {actions}
        </div>
      ) : null}
    </div>
  )

  const row = cn(
    'msg-bubble-enter group/bubble flex items-start gap-2',
    isRight ? 'flex-row-reverse' : 'flex-row',
    className,
  )

  const avatarSlot = isRight ? null : (
    <span className="flex w-7 shrink-0 justify-center">{lead ? avatar : null}</span>
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(row, 'w-full')}>
        {avatarSlot}
        {bubble}
      </button>
    )
  }
  return (
    <div className={row}>
      {avatarSlot}
      {bubble}
    </div>
  )
}
