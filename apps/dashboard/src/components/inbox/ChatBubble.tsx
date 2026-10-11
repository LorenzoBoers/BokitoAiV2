import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { chatRunCloses, chatRunLeads, type BubbleStack } from '../../lib/chat-layout'
import { cn } from '../../lib/utils'
import { AI_PILL_CLASS } from '../ai/AiMark'

/**
 * Chat bubble primitives for every conversation surface (customer threads,
 * suggested replies, agent sessions). One shell, five tones, WhatsApp-style
 * grouping: the first bubble of a run carries avatar, name and the pointed
 * corner; follow-ups hug it with flattened inner corners. Feedback / copy
 * sit bottom-right next to the time.
 */

export type BubbleVariant = 'external' | 'team' | 'agent' | 'self' | 'note'

/** Position in a run of consecutive same-author messages; shared with the widget. */
export type { BubbleStack }

const TONE: Record<BubbleVariant, string> = {
  external: 'bg-bg-surface ring-1 ring-inset ring-border/60 shadow-[0_1px_2px_rgb(0_0_0/0.04)]',
  team: 'bg-bg-elevated ring-1 ring-inset ring-border/40',
  // Clean paper + hairline ring + AI violet spine (not a lavender wash).
  agent: 'chat-bubble-agent',
  // Solid fill like iMessage / WhatsApp.
  self:
    'chat-bubble-self bg-accent text-accent-fg shadow-[0_1px_2px_rgb(0_0_0/0.10)] [&_.text-text-muted]:text-accent-fg/70 [&_.text-text-heading]:text-accent-fg [&_.text-accent]:text-accent-fg [&_a]:text-accent-fg [&_code]:bg-accent-fg/15',
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

/** Small role chip next to the author name ("Team" / "AI"). */
export function RoleChip({ kind }: { kind: 'team' | 'ai' }) {
  const { t } = useTranslation('communication')
  return (
    <span
      className={cn(
        'shrink-0 rounded-lg border-0 px-2 py-0.5 text-2xs font-medium leading-none',
        kind === 'ai' ? AI_PILL_CLASS : 'bg-bg-elevated text-text-muted',
      )}
    >
      {kind === 'ai' ? t('timeline.roleAi') : t('timeline.roleTeam')}
    </span>
  )
}

/** Compact icon button for bubble / mail-card footer actions. */
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
        'flex h-5 w-5 items-center justify-center rounded transition-colors disabled:opacity-40 [&_svg]:h-2.5 [&_svg]:w-2.5',
        active
          ? 'bg-accent/10 text-accent'
          : 'text-text-muted hover:bg-bg-hover hover:text-text-primary',
      )}
    >
      {children}
    </button>
  )
}

type ShellProps = {
  side: 'left' | 'right'
  header?: ReactNode
  body: ReactNode
  /** Small trailing line (time, delivery state) on the bubble that closes a run. */
  meta?: ReactNode
  /** Feedback / copy / note actions — bottom-right, beside the time. */
  actions?: ReactNode
  variant: BubbleVariant
  stack?: BubbleStack
  bubbleClassName?: string
  onClick?: () => void
}

/**
 * The bubble itself (header, body, footer) without the avatar row. The live
 * agent turn renders this shell too, so a streaming bubble already has the
 * exact shape, padding and footer height of the saved one it becomes.
 */
export function ChatBubbleShell({
  side,
  header,
  body,
  meta,
  actions,
  variant,
  stack = 'single',
  bubbleClassName,
  onClick,
}: ShellProps) {
  const lead = leadsRun(stack)
  const showMeta = meta != null && closesRun(stack)
  const showFooter = showMeta || Boolean(actions)
  return (
    <div
      data-stack={stack}
      className={cn(
        'relative min-w-0 max-w-[85%] px-3.5 py-2 text-base leading-relaxed',
        variant === 'self' ? 'text-accent-fg' : 'text-text-primary',
        shapeFor(side, stack),
        TONE[variant],
        onClick && 'text-left transition-colors hover:brightness-[0.98]',
        bubbleClassName,
      )}
    >
      {lead ? header : null}
      {body}
      {showFooter ? (
        <div
          className={cn(
            'mt-1 flex items-center justify-end gap-1.5 text-2xs leading-none tabular-nums',
            variant === 'self' ? 'text-accent-fg/70' : 'text-text-muted',
          )}
        >
          {actions ? (
            <div
              className={cn(
                'flex shrink-0 items-center gap-px',
                variant === 'self' &&
                  '[&_button]:text-accent-fg/75 [&_button:hover]:bg-accent-fg/15 [&_button:hover]:text-accent-fg',
              )}
              onClick={(event) => event.stopPropagation()}
            >
              {actions}
            </div>
          ) : null}
          {showMeta ? meta : null}
        </div>
      ) : null}
    </div>
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
  enter = true,
}: ShellProps & {
  /** Shown on the left only, and only on the bubble that leads a run. */
  avatar?: ReactNode
  className?: string
  /**
   * Play the enter animation. Off for bubbles that replace a live turn the
   * reader already watched stream in — they must land in place, not re-enter.
   */
  enter?: boolean
}) {
  const isRight = side === 'right'
  const lead = leadsRun(stack)

  const bubble = (
    <ChatBubbleShell
      side={side}
      header={header}
      body={body}
      meta={meta}
      actions={actions}
      variant={variant}
      stack={stack}
      bubbleClassName={bubbleClassName}
      onClick={onClick}
    />
  )

  const row = cn(
    enter && 'msg-bubble-enter',
    'group/bubble flex items-start gap-2',
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
