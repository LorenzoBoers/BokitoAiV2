import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

/**
 * The one pill. Soft fill, darker ink, no border, rounded-lg (never a
 * capsule). Map domain values to a tone with `lib/badge-tones.ts`.
 * Canonical tones: neutral, accent, ai, success, warning, error, info.
 * `default`, `secondary`, `outline` and `destructive` are aliases.
 */
const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border-0 font-medium leading-none',
  {
    variants: {
      variant: {
        neutral: 'bg-bg-hover text-text-secondary',
        accent: 'bg-accent/12 text-accent',
        ai: 'bg-ai/12 text-ai-ink',
        success: 'bg-status-success/12 text-status-success',
        warning: 'bg-status-warning/12 text-status-warning',
        error: 'bg-status-error/12 text-status-error',
        info: 'bg-status-info/12 text-status-info',
        default: 'bg-accent/12 text-accent',
        secondary: 'bg-bg-hover text-text-secondary',
        outline: 'bg-bg-hover text-text-secondary',
        destructive: 'bg-status-error/12 text-status-error',
      },
      size: {
        sm: 'px-1.5 py-0.5 text-2xs',
        md: 'px-2.5 py-0.5 text-xs',
      },
    },
    defaultVariants: {
      variant: 'neutral',
      size: 'md',
    },
  },
)

export type BadgeTone = 'neutral' | 'accent' | 'ai' | 'success' | 'warning' | 'error' | 'info'

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Small status dot before the label (Enabled-style). */
  dot?: boolean
  /** Leading icon component, sized to the badge. */
  icon?: React.ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>
}

export function Badge({ className, variant, size, dot, icon: Icon, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {dot ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-90" aria-hidden />
      ) : null}
      {Icon ? <Icon size={size === 'sm' ? 10 : 12} className="shrink-0" aria-hidden /> : null}
      {children}
    </span>
  )
}

export { badgeVariants }
