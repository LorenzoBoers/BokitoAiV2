import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold',
  {
    variants: {
      variant: {
        neutral: 'border border-border/70 bg-bg-hover/70 text-text-secondary',
        default: 'bg-accent-muted text-accent',
        outline: 'border border-border/80 bg-transparent text-text-secondary',
        secondary: 'border border-border/70 bg-bg-elevated text-text-secondary',
        accent: 'bg-accent-muted text-accent',
        success: 'bg-status-success/12 text-status-success',
        warning: 'bg-status-warning/12 text-status-warning',
        error: 'bg-status-error/12 text-status-error',
        destructive: 'bg-status-error/12 text-status-error',
        info: 'bg-status-info/12 text-status-info',
      },
    },
    defaultVariants: {
      variant: 'neutral',
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}
