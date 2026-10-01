import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'btn-elevated bg-accent text-accent-fg hover:bg-accent-hover',
        // Hairline family: one look for secondary / outline / subtle.
        secondary:
          'border border-border bg-bg-surface text-text-heading hover:border-border-light hover:bg-bg-hover/70',
        outline:
          'border border-border bg-bg-surface text-text-heading hover:border-border-light hover:bg-bg-hover/70',
        subtle:
          'border border-border bg-bg-surface text-text-heading hover:border-border-light hover:bg-bg-hover/70',
        ghost: 'text-text-secondary hover:bg-bg-hover/70 hover:text-text-heading',
        ai: 'btn-elevated bg-ai text-ai-fg hover:brightness-110',
        destructive: 'border border-status-error/30 text-status-error hover:bg-status-error/10',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-3.5 text-sm',
        lg: 'h-10 px-4 text-sm',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
