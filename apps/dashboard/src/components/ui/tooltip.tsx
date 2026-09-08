import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '../../lib/utils'

const TooltipProvider = TooltipPrimitive.Provider

/**
 * Always mount a Provider with each Root.
 *
 * Lazy route chunks can end up with a separate module instance of
 * `@radix-ui/react-tooltip` than the app shell. An ambient Provider in
 * `main.tsx` then does not satisfy Root in the route chunk — Radix throws
 * "'Tooltip' must be used within 'TooltipProvider'" and React Router shows
 * its default error page on `/communication/agent/...`.
 *
 * Provider + Root from the same import in this file keeps context local.
 */
function Tooltip({
  delayDuration = 150,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root> & {
  delayDuration?: number
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root delayDuration={delayDuration} {...props}>
        {children}
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 8, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 overflow-hidden rounded-md border border-border/60 bg-bg-elevated px-2.5 py-1.5 text-xs font-medium text-text-primary shadow-overlay animate-fade-in',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
