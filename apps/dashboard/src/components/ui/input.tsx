import * as React from 'react'
import { cn } from '../../lib/utils'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'h-9 w-full rounded-md border border-border-light bg-bg-input px-3 text-sm text-text-primary placeholder:text-text-muted outline-none transition-[border-color,box-shadow] duration-150 focus:border-border-focus focus:ring-[3px] focus:ring-border-focus/20',
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
