import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'border border-accent/40 bg-accent text-white shadow-[0_1px_0_rgba(255,255,255,0.06)_inset] hover:bg-accent-hover',
        secondary: 'border border-border/80 bg-bg-elevated text-text-primary shadow-[0_1px_0_rgba(255,255,255,0.04)_inset] hover:bg-bg-hover',
        ghost: 'text-text-secondary hover:bg-bg-hover/75 hover:text-text-primary',
        subtle: 'border border-border/70 bg-bg-surface text-text-secondary hover:bg-bg-hover/70 hover:text-text-primary',
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
