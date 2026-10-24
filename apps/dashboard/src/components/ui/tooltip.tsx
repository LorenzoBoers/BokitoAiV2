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

/** One look for every hover hint: normal weight, hairline lift, no card border. */
export const TOOLTIP_SURFACE =
  'w-max max-w-xs rounded-md bg-bg-elevated px-2 py-1 text-xs font-normal leading-snug text-text-heading shadow-overlay'

const SHORTCUT = /^(?:Esc|Escape|Enter|Space|Tab|F\d{1,2}|(?:Ctrl|Alt|Shift|Cmd|Meta)(?:\+[A-Za-z0-9]+)+|[A-Za-z0-9])$/

/** "Minimaliseren (Esc)" becomes a label plus a muted shortcut. A sentence stays whole. */
export function splitTooltipShortcut(text: string): { label: string; detail: string | null } {
  const match = /^(.*\S)\s+\(([^)]+)\)\s*$/.exec(text)
  if (!match || !SHORTCUT.test(match[2].trim())) return { label: text, detail: null }
  return { label: match[1], detail: match[2].trim() }
}

/** Keep a centered tooltip inside the viewport. `size` is the box width or height. */
export function clampTooltipCenter(center: number, size: number, viewport: number, pad = 8): number {
  if (size >= viewport - pad * 2) return viewport / 2
  const half = size / 2
  return Math.min(viewport - pad - half, Math.max(pad + half, center))
}

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, collisionPadding = 8, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn('z-50 animate-fade-in', TOOLTIP_SURFACE, className)}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

/** One line: the action, then the shortcut in muted type. */
function TooltipLabel({
  children,
  detail,
}: {
  children: React.ReactNode
  detail?: React.ReactNode
}) {
  return (
    <span className="flex items-baseline gap-2 whitespace-nowrap">
      <span>{children}</span>
      {detail ? <span className="text-text-muted">{detail}</span> : null}
    </span>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipLabel, TooltipProvider }
