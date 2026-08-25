import type { ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * Platform-wide AI identity: violet + sparkles. Brand accent stays for
 * workspace chrome; anything the agent did (decisions, reviews, bubbles)
 * uses these classes so the feel matches Knowledge.
 */

export const AI_TEXT_CLASS = 'text-ai-ink'
export const AI_PILL_CLASS = 'border-ai/25 bg-ai/10 text-ai-ink'
export const AI_CARD_CLASS = 'ai-surface border-ai/25 bg-ai/[0.07]'
export const AI_ICON_BOX_CLASS = 'border-ai/25 bg-ai/10 text-ai-ink'

export function AiMark({ size = 14, className }: { size?: number; className?: string }) {
  return <Sparkles size={size} className={cn('shrink-0', AI_TEXT_CLASS, className)} />
}

export function AiIconBox({
  size = 'md',
  className,
  children,
}: {
  size?: 'sm' | 'md'
  className?: string
  children?: ReactNode
}) {
  const box = size === 'sm' ? 'h-6 w-6 rounded-md' : 'h-7 w-7 rounded-lg'
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center border', AI_ICON_BOX_CLASS, box, className)}>
      {children ?? <AiMark size={size === 'sm' ? 12 : 13} />}
    </span>
  )
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
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-4',
        AI_PILL_CLASS,
        glow && 'ai-glow',
        className,
      )}
    >
      <AiMark size={10} />
      {children}
    </span>
  )
}
