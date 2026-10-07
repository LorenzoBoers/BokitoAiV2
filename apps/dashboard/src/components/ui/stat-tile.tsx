import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

type StatTileProps = {
  label: ReactNode
  value: ReactNode
  /** Small line under the value (delta, period, unit). */
  hint?: ReactNode
  icon?: ReactNode
  className?: string
}

/** One KPI: label, large value, optional hint. Sits in a grid inside a page. */
export function StatTile({ label, value, hint, icon, className }: StatTileProps) {
  return (
    <div className={cn('rounded-lg border border-border/60 bg-bg-surface px-4 py-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-text-muted">{label}</p>
        {icon ? <span className="shrink-0 text-text-muted">{icon}</span> : null}
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-text-heading">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-text-muted">{hint}</p> : null}
    </div>
  )
}

export function StatGrid({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-4', className)}>{children}</div>
}

export default StatTile
