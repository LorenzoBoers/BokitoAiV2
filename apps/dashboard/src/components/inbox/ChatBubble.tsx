import type { ReactNode } from 'react'
import { AI_CARD_CLASS } from '../ai/AiMark'
import { cn } from '../../lib/utils'

/**
 * Shared chat-bubble chrome for Messages: customer, teammate, agent, self,
 * suggested answers, and meta-agent sessions all use the same shell so the
 * timeline reads as one conversation.
 */

export type BubbleVariant = 'external' | 'team' | 'agent' | 'self' | 'note'

export const BUBBLE_VARIANT_CLASSES: Record<BubbleVariant, string> = {
  external: 'bg-bg-surface border-border/60',
  team: 'bg-bg-elevated/80 border-border/60',
  agent: AI_CARD_CLASS,
  self: 'bg-accent/15 border-accent/30',
  note: 'border-dashed border-border/70 bg-bg-elevated/50',
}

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
  const hasTop = name != null || chip != null || trailing != null
  if (!hasTop && subtitle == null) return null
  return (
    <div className="mb-1 min-w-0">
      {hasTop ? (
        <div className="flex w-full min-w-0 items-center gap-1.5">
          {name != null ? (
            <span className="truncate text-xs font-medium text-text-heading">{name}</span>
          ) : null}
          {chip}
          {trailing}
        </div>
      ) : null}
      {subtitle != null ? (
        <p className="truncate text-[10px] leading-snug text-text-muted">{subtitle}</p>
      ) : null}
    </div>
  )
}

/** Overlapping avatars on one side (e.g. agent + colleague on a shared bubble). */
export function StackedAvatars({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 items-end -space-x-1.5">{children}</div>
}

/**
 * Chat-style bubble: avatar on one side, message constrained so left/right
 * alignment is clear. Optional `endAvatar` places a second avatar on the
 * opposite side (collapsed meta sessions: agent left, you right).
 */
export function ChatMessageBubble({
  side,
  avatar,
  endAvatar,
  header,
  body,
  variant,
  className,
  bubbleClassName,
  onClick,
}: {
  side: 'left' | 'right'
  avatar: ReactNode
  /** Avatar on the opposite side of `avatar` (shared session summary). */
  endAvatar?: ReactNode
  header?: ReactNode
  body: ReactNode
  variant: BubbleVariant
  className?: string
  bubbleClassName?: string
  onClick?: () => void
}) {
  const isRight = side === 'right'
  const shell = (
    <>
      {isRight ? endAvatar : avatar}
      <div
        className={cn(
          'max-w-[78%] min-w-0 rounded-2xl border px-3 py-2',
          isRight ? 'rounded-br-sm' : 'rounded-bl-sm',
          BUBBLE_VARIANT_CLASSES[variant],
          bubbleClassName,
        )}
      >
        {header}
        {body}
      </div>
      {isRight ? avatar : endAvatar}
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'msg-bubble-enter flex w-full items-end gap-2 text-left',
          isRight ? 'justify-end' : 'justify-start',
          className,
        )}
      >
        {shell}
      </button>
    )
  }

  return (
    <div
      className={cn(
        'msg-bubble-enter flex items-end gap-2',
        isRight ? 'justify-end' : 'justify-start',
        className,
      )}
    >
      {shell}
    </div>
  )
}
