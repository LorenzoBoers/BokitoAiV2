import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'

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
 * Integrations Connected loading pattern (Loader2 above text-text-muted).
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
        <Loader2 size={14} className="animate-spin" aria-hidden />
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
          <div
            key={i}
            className="h-12 animate-pulse rounded-xl border border-border/40 bg-bg-elevated/60"
          />
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
      <Loader2 size={20} className="animate-spin" aria-hidden />
      {label ? <p className="text-sm">{label}</p> : null}
    </div>
  )
}

export default LoadingBlock
