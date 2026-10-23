import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { chatRunCloses, chatRunLeads, type BubbleStack } from '../../lib/chat-layout'
import { THREAD_GUTTER } from './ThreadMeta'
import { cn } from '../../lib/utils'
import { AI_PILL_CLASS } from '../ai/AiMark'

/**
 * Chat bubble primitives for a message the customer sees on a chat channel.
 * One shell, six tones, WhatsApp-style grouping: the first bubble of a run
 * carries avatar, name and the pointed corner; follow-ups hug it with
 * flattened inner corners. Feedback / copy sit bottom-right next to the time.
 *
 * An agent's answer in a chat with the operator uses `DocumentTurn`:
 * full column, no fill, name and time on one line. Own messages and team
 * chats stay bubbles.
 */

export type BubbleVariant = 'external' | 'team' | 'agent' | 'self' | 'note' | 'ai_note'

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
  // Human team note (amber) vs agent team note (AI violet, dashed).
  note: 'bg-status-warning/[0.07] ring-1 ring-inset ring-status-warning/25',
  ai_note: 'chat-bubble-ai-note',
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
  mailAction,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  /** Reply / reply-all / forward: a click here replaces the open mail view. */
  mailAction?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      data-mail-action={mailAction ? '' : undefined}
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
  /**
   * WhatsApp-style reaction chips overlapping the bottom edge. Mounted on the
   * bubble shell so hover is the cloud itself, not the avatar column.
   */
  reactions?: ReactNode
  variant: BubbleVariant
  stack?: BubbleStack
  bubbleClassName?: string
  /** Agent orb color. The bubble edge shines in this and fades inward. */
  accent?: string | null
  onClick?: () => void
  /** Streaming body: ease to each measured height so a new line slides in. */
  growing?: boolean
  /**
   * Drop the default max-w-[85%] when the parent already caps width (live turn
   * column). Nested 85% made the live cloud narrower than the saved bubble.
   */
  fillWidth?: boolean
}

/**
 * CSS cannot transition `height: auto` when only the content changes, so
 * the body is measured and the wrapper animates between pixel heights.
 * The first measure lands instantly (no 0→full ease) so a remount after the
 * live overlay does not replay a height jump.
 */
function GrowBox({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement | null>(null)
  const box = useRef<HTMLDivElement | null>(null)
  const [height, setHeight] = useState<number | null>(null)
  const primed = useRef(false)
  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    const apply = (next: number) => {
      if (!primed.current) {
        primed.current = true
        const shell = box.current
        if (shell) shell.style.transition = 'none'
        setHeight(next)
        requestAnimationFrame(() => {
          if (shell) shell.style.transition = ''
        })
        return
      }
      setHeight(next)
    }
    apply(el.offsetHeight)
    const ro = new ResizeObserver(() => apply(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div
      ref={box}
      className="bubble-grow-box"
      style={height == null ? undefined : { height }}
    >
      <div ref={inner}>{children}</div>
    </div>
  )
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
  reactions,
  variant,
  stack = 'single',
  bubbleClassName,
  accent,
  onClick,
  growing = false,
  fillWidth = false,
}: ShellProps) {
  const lead = leadsRun(stack)
  const showMeta = meta != null && closesRun(stack)
  const showFooter = showMeta || Boolean(actions)
  // Outer wraps cloud + reaction dock so placed chips can sit in normal flow
  // (overlap via negative margin) without being covered by the next bubble.
  return (
    <div
      className={cn(
        'group/bubble relative flex min-w-0 flex-col',
        fillWidth ? 'w-full max-w-full' : 'max-w-[85%]',
        variant === 'agent' && 'bubble-grow',
        side === 'right' ? 'items-end' : 'items-start',
      )}
    >
      <div
        data-stack={stack}
        style={
          accent
            ? ({ ['--agent-tint' as string]: accent } as CSSProperties)
            : undefined
        }
        className={cn(
          'relative w-full px-3.5 py-2 text-lg leading-relaxed',
          variant === 'self' ? 'text-accent-fg' : 'text-text-primary',
          shapeFor(side, stack),
          TONE[variant],
          onClick && 'text-left transition-colors hover:brightness-[0.98]',
          bubbleClassName,
        )}
      >
        {lead ? header : null}
        {growing && body ? <GrowBox>{body}</GrowBox> : body}
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
      {reactions}
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
  reactions,
  variant,
  stack = 'single',
  className,
  bubbleClassName,
  accent,
  onClick,
  enter = true,
  showAvatar,
}: ShellProps & {
  /** Shown on the left only, and only on the bubble that leads a run. */
  avatar?: ReactNode
  className?: string
  /**
   * Play the enter animation. Off for bubbles that replace a live turn the
   * reader already watched stream in — they must land in place, not re-enter.
   */
  enter?: boolean
  /**
   * Override avatar visibility. Default: only the run lead. Used so a live
   * idle seat can sit on the latest bubble in a stacked run.
   */
  showAvatar?: boolean
}) {
  const isRight = side === 'right'
  const lead = leadsRun(stack)
  const renderAvatar = showAvatar ?? lead

  const bubble = (
    <ChatBubbleShell
      side={side}
      header={header}
      body={body}
      meta={meta}
      actions={actions}
      reactions={reactions}
      variant={variant}
      stack={stack}
      bubbleClassName={bubbleClassName}
      accent={accent}
      onClick={onClick}
    />
  )

  const row = cn(
    enter && (variant === 'agent' ? 'bubble-pop-enter' : 'msg-bubble-enter'),
    'flex items-start gap-2',
    isRight ? 'flex-row-reverse' : 'flex-row',
    className,
  )

  const avatarSlot = isRight ? null : (
    <span className={THREAD_GUTTER}>{renderAvatar ? avatar : null}</span>
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

/**
 * One turn of the work conversation. Prose on the page, not a messenger bubble.
 * The avatar gutter matches a customer bubble so a mixed thread stays aligned.
 */
export function DocumentTurn({
  avatar,
  showAvatar = true,
  name,
  chip,
  body,
  meta,
  actions,
  reactions,
  enter = true,
  className,
}: {
  avatar?: ReactNode
  /** False on a follow-up in a run; the gutter stays so the text column holds. */
  showAvatar?: boolean
  name?: ReactNode
  chip?: ReactNode
  body?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  reactions?: ReactNode
  enter?: boolean
  className?: string
}) {
  const hasLine = name != null || chip != null || meta != null || Boolean(actions)
  return (
    <div
      data-transcript="document"
      className={cn(enter && 'msg-bubble-enter', 'flex w-full items-start gap-2', className)}
    >
      <span className={THREAD_GUTTER}>{showAvatar ? avatar : null}</span>
      <div className="min-w-0 flex-1 text-lg leading-relaxed text-text-primary">
        {hasLine ? (
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs leading-4">
            <span className="flex min-w-0 items-center gap-1.5">
              {name != null ? (
                <span className="truncate-fade font-semibold text-text-heading">{name}</span>
              ) : null}
              {chip}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-text-muted">
              {actions ? <span className="flex items-center gap-px">{actions}</span> : null}
              {meta}
            </span>
          </div>
        ) : null}
        {body}
        {reactions}
      </div>
    </div>
  )
}
