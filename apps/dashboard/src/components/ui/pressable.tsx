import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '../../lib/utils'

export type PressableProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean
}

/**
 * A click target without button chrome: a whole row, card, tile or face.
 * The only place a bare `<button>` is allowed outside the other catalog parts.
 */
export const Pressable = React.forwardRef<HTMLButtonElement, PressableProps>(
  ({ className, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        ref={ref}
        type={asChild ? type : (type ?? 'button')}
        className={cn(
          'w-full appearance-none rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:opacity-50',
          className,
        )}
        {...props}
      />
    )
  },
)
Pressable.displayName = 'Pressable'

export default Pressable
