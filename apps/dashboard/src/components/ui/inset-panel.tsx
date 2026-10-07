import * as React from 'react'
import { cn } from '../../lib/utils'

type InsetPanelProps = React.HTMLAttributes<HTMLDivElement> & {
  /** `md` = p-3 (default), `sm` = p-2.5, `none` = no padding (lists). */
  padding?: 'none' | 'sm' | 'md'
}

const PAD = { none: '', sm: 'p-2.5', md: 'p-3' } as const

/** Flat region inside a Card: sublists, previews, settings groups. */
export const InsetPanel = React.forwardRef<HTMLDivElement, InsetPanelProps>(
  ({ className, padding = 'md', ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-md border border-border/50 bg-bg-elevated', PAD[padding], className)}
      {...props}
    />
  ),
)
InsetPanel.displayName = 'InsetPanel'

export default InsetPanel
