import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

/** One titled block inside a channel panel. Every kind uses the same frame. */
export function ChannelSection({
  title,
  children,
  className,
}: {
  title: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('space-y-1', className)}>
      <h4 className="text-2xs font-semibold uppercase tracking-wide text-text-muted">{title}</h4>
      <div className="divide-y divide-border/40">{children}</div>
    </section>
  )
}

/** Label and hint on the left, control on the right: the one setting line. */
export function ChannelSetting({
  label,
  hint,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-heading">{label}</p>
        {hint ? <p className="mt-0.5 text-xs leading-snug text-text-muted">{hint}</p> : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  )
}
