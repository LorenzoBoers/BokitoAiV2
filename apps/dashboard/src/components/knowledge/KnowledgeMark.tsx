import { Brain } from 'lucide-react'
import { cn } from '../../lib/utils'
import { AI_TEXT_CLASS } from '../ai/AiMark'
import { Badge } from '../ui/badge'
import { IconTile } from '../ui/icon-tile'

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
  return <IconTile icon={Brain} tone="ai" size={size} className={className} />
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
    <Badge variant="ai" icon={Brain} className={cn(glow && 'knowledge-glow', className)}>
      {label}
    </Badge>
  )
}
