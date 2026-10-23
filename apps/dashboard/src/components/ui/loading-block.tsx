import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { Skeleton } from './skeleton'
import { Spinner } from './spinner'

interface LoadingBlockProps {
  /**
   * - inline: small text + spinner, used inline in flow content
   * - center: spinner above label, padded vertically (default; mirrors Integrations Connected)
   * - skeleton: row of pulsing placeholders for list views
   */
  variant?: 'inline' | 'center' | 'skeleton'
  label?: ReactNode
  className?: string
  /** Number of rows when `variant="skeleton"`. Default 3. */
  rows?: number
}

/**
 * Unified loading block. Default `center` variant matches the
 * Integrations Connected loading pattern (spinner above text-text-muted).
 */
export function LoadingBlock({
  variant = 'center',
  label,
  className,
  rows = 3,
}: LoadingBlockProps) {
  if (variant === 'inline') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-2 text-xs text-text-muted',
          className,
        )}
      >
        <Spinner size="md" />
        {label ?? null}
      </span>
    )
  }

  if (variant === 'skeleton') {
    return (
      <div
        className={cn('space-y-2', className)}
        role="status"
        aria-busy="true"
        aria-live="polite"
      >
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-12 rounded-lg border border-border" />
        ))}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 py-12 text-text-muted',
        className,
      )}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <Spinner size="lg" />
      {label ? <p className="text-sm">{label}</p> : null}
    </div>
  )
}

export default LoadingBlock
