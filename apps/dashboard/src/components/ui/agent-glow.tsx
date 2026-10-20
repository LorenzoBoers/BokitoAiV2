import type { CSSProperties } from 'react'
import { cn } from '../../lib/utils'

const PLACEMENT = {
  /** Behind an avatar: the parent is the avatar box. */
  behind: 'inset-[-22%]',
  /** Corner wash on a card: the parent is `relative overflow-hidden`. */
  'corner-left': '-left-8 -top-10 h-36 w-36',
  'corner-right': '-right-8 -top-10 h-36 w-36',
} as const

type Props = {
  /** Agent or specialist tint (any CSS color). */
  color: string
  placement?: keyof typeof PLACEMENT
  className?: string
}

/**
 * Soft tinted wash for agent showcase surfaces only: the agent hero, library
 * and marketplace cards, the specialist portrait. Content above it needs
 * `relative z-[1]`. Lists, rows and chat stay flat.
 */
export function AgentGlow({ color, placement = 'behind', className }: Props) {
  const style: CSSProperties = { backgroundColor: color }
  return (
    <span
      aria-hidden
      style={style}
      className={cn('agent-glow pointer-events-none absolute rounded-full blur-2xl', PLACEMENT[placement], className)}
    />
  )
}
