import type { ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Badge } from '../ui/badge'

/**
 * Platform-wide AI identity: violet + sparkles. Brand accent stays for
 * workspace chrome; anything the agent did (decisions, reviews, bubbles)
 * uses these classes so the feel matches Knowledge.
 */

export const AI_TEXT_CLASS = 'text-ai-ink'
/** Soft pill fill — no border (shared with Badge variant="ai"). */
export const AI_PILL_CLASS = 'border-0 bg-ai/12 text-ai-ink'
export const AI_CARD_CLASS = 'ai-surface border-ai/25 bg-ai/[0.07]'

export function AiMark({ size = 14, className }: { size?: number; className?: string }) {
  return <Sparkles size={size} className={cn('shrink-0', AI_TEXT_CLASS, className)} />
}

export function AiChip({
  children,
  glow = false,
  className,
}: {
  children: ReactNode
  glow?: boolean
  className?: string
}) {
  return (
    <Badge variant="ai" icon={Sparkles} className={cn(glow && 'ai-glow', className)}>
      {children}
    </Badge>
  )
}
