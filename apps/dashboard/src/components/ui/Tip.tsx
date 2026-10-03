import type { ReactElement, ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

type TipProps = {
  /** Hover label. Empty / missing skips the wrapper so call sites stay cheap. */
  label?: ReactNode
  children: ReactElement
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  className?: string
  delayDuration?: number
}

/**
 * Styled tooltip over a single child (side/align control).
 *
 * Native `title="…"` is also fine: `NativeTitleTooltipBridge` upgrades those
 * app-wide. Use Tip when you need placement control or ReactNode content.
 */
export function Tip({
  label,
  children,
  side = 'top',
  align = 'center',
  className,
  delayDuration,
}: TipProps) {
  if (label == null || label === false || label === '') return children
  return (
    <Tooltip delayDuration={delayDuration}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align} className={className}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
