import type { ComponentType, ReactNode } from 'react'
import type { LucideProps } from 'lucide-react'
import { Card } from './card'
import { cn } from '../../lib/utils'

interface EmptyStateProps {
  icon?: ComponentType<LucideProps>
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  /** Tighten or loosen the vertical padding. Default mirrors Integrations Connected. */
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const PAD: Record<NonNullable<EmptyStateProps['size']>, string> = {
  sm: 'px-6 py-8',
  md: 'px-8 py-10',
  lg: 'px-10 py-14',
}

/**
 * Unified empty UX. Wraps content in `Card` and centers the message.
 * Matches the established Integrations Connected baseline.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = 'md',
  className,
}: EmptyStateProps) {
  return (
    <Card className={cn('text-center', PAD[size], className)}>
      {Icon ? (
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-bg-elevated text-text-muted shadow-[0_0_0_4px_rgb(var(--color-bg-hover)/0.55)]">
          <Icon size={18} aria-hidden />
        </div>
      ) : null}
      <p className="text-sm font-medium text-text-heading">{title}</p>
      {description ? (
        <p className="mx-auto mt-2 max-w-md text-xs text-text-secondary">{description}</p>
      ) : null}
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </Card>
  )
}

export default EmptyState
