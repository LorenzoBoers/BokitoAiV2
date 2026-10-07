import type { ComponentType, ReactNode } from 'react'
import { cn } from '../../lib/utils'

const TONE = {
  neutral: 'border-border/60 bg-bg-elevated text-text-secondary',
  accent: 'border-accent/20 bg-accent/10 text-accent',
  ai: 'border-ai/20 bg-ai/10 text-ai-ink',
  success: 'border-status-success/20 bg-status-success/10 text-status-success',
  warning: 'border-status-warning/25 bg-status-warning/10 text-status-warning',
  error: 'border-status-error/25 bg-status-error/10 text-status-error',
} as const

const SIZE = {
  sm: { box: 'h-6 w-6 rounded-md', icon: 12 },
  md: { box: 'h-8 w-8 rounded-lg', icon: 16 },
  lg: { box: 'h-12 w-12 rounded-lg', icon: 24 },
} as const

export type IconTileTone = keyof typeof TONE

type IconTileProps = {
  icon?: ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>
  /** Custom content (logo img) instead of an icon component. */
  children?: ReactNode
  tone?: IconTileTone
  size?: keyof typeof SIZE
  className?: string
}

/** Square tile holding one icon or logo, for headers, rows and option cards. */
export function IconTile({ icon: Icon, children, tone = 'neutral', size = 'md', className }: IconTileProps) {
  const s = SIZE[size]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden border',
        TONE[tone],
        s.box,
        className,
      )}
    >
      {Icon ? <Icon size={s.icon} aria-hidden /> : children}
    </span>
  )
}

export default IconTile
