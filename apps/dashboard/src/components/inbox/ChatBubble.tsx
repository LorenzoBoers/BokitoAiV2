import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
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

/**
 * Hover actions next to a bubble. Rendered in a portal so the timeline
 * scroller cannot clip them against the composer at the bottom.
 */
export function BubbleHoverToolbar({
  open,
  anchorRef,
  side,
  onEnter,
  onLeave,
  children,
}: {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  side: 'left' | 'right'
  onEnter: () => void
  onLeave: () => void
  children: ReactNode
}) {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const place = useCallback(() => {
    const bubble = anchorRef.current
    const bar = toolbarRef.current
    if (!bubble || !bar) return
    const rect = bubble.getBoundingClientRect()
    const size = bar.getBoundingClientRect()
    const gap = 6
    let left = side === 'right' ? rect.left - size.width - gap : rect.right + gap
    let top = rect.top + 4
    const maxLeft = window.innerWidth - size.width - 8
    const maxTop = window.innerHeight - size.height - 8
    if (left > maxLeft) left = maxLeft
    if (left < 8) left = 8
    if (top > maxTop) top = maxTop
    if (top < 8) top = 8
    setPos({ top, left })
  }, [anchorRef, side])

  useEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    place()
    const raf = window.requestAnimationFrame(place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.cancelAnimationFrame(raf)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place])

  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div
      ref={toolbarRef}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}
      className="fixed z-[60] flex items-center gap-0.5 rounded-lg bg-bg-surface p-0.5 shadow-overlay ring-1 ring-border/50"
    >
      {children}
    </div>,
    document.body,
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
  const bubbleRef = useRef<HTMLDivElement>(null)
  const [actionsOpen, setActionsOpen] = useState(false)
  const hideTimer = useRef(0)
  const showActions = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = 0
    setActionsOpen(true)
  }, [])
  const hideActions = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setActionsOpen(false), 140)
  }, [])
  useEffect(() => () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
  }, [])

  const bubble = (
    <div
      ref={bubbleRef}
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
    </div>
  )

  const hoverBind = actions
    ? { onMouseEnter: showActions, onMouseLeave: hideActions }
    : {}

  const row = cn(
    'msg-bubble-enter group/bubble flex items-start gap-2',
    isRight ? 'flex-row-reverse' : 'flex-row',
    className,
  )

  const avatarSlot = isRight ? null : (
    <span className="flex w-7 shrink-0 justify-center">{lead ? avatar : null}</span>
  )

  const toolbar = actions ? (
    <BubbleHoverToolbar
      open={actionsOpen}
      anchorRef={bubbleRef}
      side={side}
      onEnter={showActions}
      onLeave={hideActions}
    >
      {actions}
    </BubbleHoverToolbar>
  ) : null

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(row, 'w-full')} {...hoverBind}>
        {avatarSlot}
        {bubble}
        {toolbar}
      </button>
    )
  }
  return (
    <div className={row} {...hoverBind}>
      {avatarSlot}
      {bubble}
      {toolbar}
    </div>
  )
}
