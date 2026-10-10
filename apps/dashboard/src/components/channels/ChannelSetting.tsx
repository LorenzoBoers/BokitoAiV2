import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { SettingRow } from '../ui/entity-row'

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
    <SettingRow density="field" label={label} hint={hint}>
      {children}
    </SettingRow>
  )
}
