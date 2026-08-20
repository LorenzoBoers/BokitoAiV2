import * as React from 'react'
import { cn } from '../../lib/utils'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'h-10 w-full rounded-lg border border-border/60 bg-bg-input px-3.5 text-sm text-text-primary placeholder:text-text-muted outline-none transition-[border-color,box-shadow,background-color] shadow-[0_1px_0_rgba(255,255,255,0.06)_inset] focus:border-border-focus focus:shadow-[0_0_0_3px_rgba(99,91,255,0.12)]',
          className,
        )}
        ref={ref}
        {...props}
      />
    )
  },
)
Input.displayName = 'Input'

export { Input }
