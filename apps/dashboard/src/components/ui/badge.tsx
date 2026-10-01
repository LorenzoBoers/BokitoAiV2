import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-2xs font-medium leading-4',
  {
    variants: {
      variant: {
        neutral: 'border-border/70 bg-transparent text-text-secondary',
        default: 'border-accent/25 bg-accent/10 text-accent',
        outline: 'border-border/70 bg-transparent text-text-secondary',
        secondary: 'border-border/70 bg-bg-elevated text-text-secondary',
        accent: 'border-accent/25 bg-accent/10 text-accent',
        success: 'border-status-success/25 bg-status-success/10 text-status-success',
        warning: 'border-status-warning/25 bg-status-warning/10 text-status-warning',
        error: 'border-status-error/25 bg-status-error/10 text-status-error',
        destructive: 'border-status-error/25 bg-status-error/10 text-status-error',
        info: 'border-status-info/25 bg-status-info/10 text-status-info',
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
