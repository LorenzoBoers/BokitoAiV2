import type { ComponentType, ReactNode } from 'react'
import type { LucideProps } from 'lucide-react'
import { Card } from './card'
import { cn } from '../../lib/utils'

interface EmptyStateProps {
  icon?: ComponentType<LucideProps>
  title: ReactNode
  description?: ReactNode
  /** Primary CTA — usually one button. */
  action?: ReactNode
  /** Optional secondary line (e.g. a single docs link). */
  footer?: ReactNode
  /** Tighten or loosen the vertical padding. Default mirrors Integrations Connected. */
  size?: 'sm' | 'md' | 'lg'
  /**
   * - card: standalone Card (page-level empty)
   * - dashed: dashed inset inside a Card (empty list in a section)
   * - plain: no chrome (inside a panel that already has a frame)
   */
  tone?: 'card' | 'dashed' | 'plain'
  className?: string
}

const PAD: Record<NonNullable<EmptyStateProps['size']>, string> = {
  sm: 'px-6 py-8',
  md: 'px-8 py-10',
  lg: 'px-10 py-14',
}

/**
 * Unified empty UX. One primary action, optional footer link — keep it calm.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  footer,
  size = 'md',
  tone = 'card',
  className,
}: EmptyStateProps) {
  const body = (
    <>
      {Icon ? (
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-bg-elevated text-text-muted shadow-[0_0_0_4px_rgb(var(--color-bg-hover)/0.55)] transition-transform duration-300">
          <Icon size={18} aria-hidden />
        </div>
      ) : null}
      <p className="text-sm font-medium text-text-heading">{title}</p>
      {description ? (
        <p className="mx-auto mt-2 max-w-md text-xs text-text-secondary">{description}</p>
      ) : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
      {footer ? <div className="mt-3 flex justify-center">{footer}</div> : null}
    </>
  )
  if (tone === 'card') {
    return <Card className={cn('animate-pop-in text-center', PAD[size], className)}>{body}</Card>
  }
  return (
    <div
      className={cn(
        'text-center',
        PAD[size],
        tone === 'dashed' && 'rounded-md border border-dashed border-border/70',
        className,
      )}
    >
      {body}
    </div>
  )
}

export default EmptyState
