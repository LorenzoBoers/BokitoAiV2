import { Brain } from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * Platform-wide knowledge identity: a violet brain. Used everywhere knowledge
 * or auto-learning shows up (Knowledge page, rail, agent knowledge steps,
 * learned rules) so the concept stays instantly recognizable.
 */

export const KNOWLEDGE_TEXT_CLASS = 'text-violet-500 dark:text-violet-300'

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
        'flex shrink-0 items-center justify-center border border-violet-500/20 bg-violet-500/10',
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
        'inline-flex items-center gap-1 rounded-full border border-violet-500/25 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium',
        KNOWLEDGE_TEXT_CLASS,
        glow && 'knowledge-glow',
        className,
      )}
    >
      <Brain size={11} className="shrink-0" />
      {label}
    </span>
  )
}
