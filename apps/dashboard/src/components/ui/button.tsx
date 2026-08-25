import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-[color,background-color,border-color,transform,box-shadow] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'btn-elevated border border-black/5 bg-accent text-accent-fg hover:bg-accent-hover',
        secondary:
          'btn-elevated border border-border-light bg-bg-surface text-text-heading hover:border-border-light hover:bg-bg-hover',
        ghost: 'text-text-secondary hover:bg-bg-hover/75 hover:text-text-primary',
        subtle:
          'btn-elevated border border-border-light bg-bg-surface text-text-heading hover:bg-bg-hover',
        outline:
          'btn-elevated border border-border-light bg-bg-surface text-text-heading hover:bg-bg-hover',
        ai: 'btn-elevated border border-ai/30 bg-ai text-ai-fg hover:brightness-110',
        destructive: 'bg-status-error/12 text-status-error hover:bg-status-error/18',
      },
      size: {
        sm: 'h-9 px-3.5 text-xs',
        md: 'h-10 px-4 text-sm',
        lg: 'h-11 px-5 text-sm',
        icon: 'h-9 w-9',
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
