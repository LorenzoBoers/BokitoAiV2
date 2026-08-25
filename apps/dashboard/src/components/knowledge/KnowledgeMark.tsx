import { Brain } from 'lucide-react'
import { cn } from '../../lib/utils'
import { AI_PILL_CLASS, AI_TEXT_CLASS } from '../ai/AiMark'

/**
 * Platform-wide knowledge identity: a violet brain. Shares the AI violet
 * tokens so knowledge and agent UI read as one system.
 */

export const KNOWLEDGE_TEXT_CLASS = AI_TEXT_CLASS

type KnowledgeMarkProps = {
  size?: number
  className?: string
}

/** Inline violet brain icon (lists, steps, chips). */
export function KnowledgeMark({ size = 14, className }: KnowledgeMarkProps) {
  return <Brain size={size} className={cn('shrink-0', KNOWLEDGE_TEXT_CLASS, className)} />
}

/** Rounded violet tile with a brain, for headers and hero states. */
export function KnowledgeTile({
  size = 'md',
  className,
}: {
  size?: 'md' | 'lg'
  className?: string
}) {
  const box = size === 'lg' ? 'h-12 w-12 rounded-xl' : 'h-8 w-8 rounded-lg'
  const icon = size === 'lg' ? 24 : 16
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center border border-ai/20 bg-ai/10',
        box,
        className,
      )}
    >
      <Brain size={icon} className={KNOWLEDGE_TEXT_CLASS} />
    </div>
  )
}

/** Chip marking content that agents learn or maintain themselves. */
export function LearnedChip({
  label = 'AI-maintained',
  glow = false,
  className,
}: {
  label?: string
  glow?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        AI_PILL_CLASS,
        glow && 'knowledge-glow',
        className,
      )}
    >
      <Brain size={11} className="shrink-0" />
      {label}
    </span>
  )
}
