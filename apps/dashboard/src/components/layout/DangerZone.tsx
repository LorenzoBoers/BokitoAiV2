import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

/** Irreversible actions at the bottom of a settings page. One row per action. */
export function DangerZone({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('space-y-2', className)}>
      <div>
        <h2 className="title-section text-status-error">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-text-secondary">{description}</p> : null}
      </div>
      <div className="divide-y divide-status-error/15 rounded-lg border border-status-error/30">{children}</div>
    </section>
  )
}

export function DangerZoneRow({
  title,
  description,
  action,
}: {
  title: ReactNode
  description?: ReactNode
  /** Usually one `<Button variant="destructive" size="sm">`. */
  action: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
      <div className="min-w-0">
        <p className="title-card">{title}</p>
        {description ? <p className="mt-0.5 text-sm text-text-secondary">{description}</p> : null}
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  )
}
