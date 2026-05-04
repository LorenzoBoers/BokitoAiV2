import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-semibold',
  {
    variants: {
      variant: {
        neutral: 'bg-bg-hover text-text-secondary',
        secondary: 'bg-bg-elevated text-text-secondary',
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
