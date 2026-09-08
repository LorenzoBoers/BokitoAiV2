import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '../../lib/utils'

const TooltipProvider = TooltipPrimitive.Provider

/**
 * Always mount a Provider with each Root. A single app-level Provider is still
 * fine (and preferred for shared delay), but agent chat / composer controls can
 * render before or outside that tree in some route layouts — missing Provider
 * previously crashed `/communication/agent/...` with Radix's context error.
 */
function Tooltip({
  delayDuration = 150,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root> & {
  delayDuration?: number
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root {...props} />
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
