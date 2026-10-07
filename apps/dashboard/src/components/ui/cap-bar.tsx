import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { ratioTone } from '../../lib/badge-tones'

const FILL = {
  accent: 'bg-accent',
  warning: 'bg-status-warning',
  error: 'bg-status-error',
} as const

type CapBarProps = {
  label?: ReactNode
  /** Right-aligned value text ("1.2k / 5k"). */
  value?: ReactNode
  /** 0..1; clamped. Omit to render only the label row (no cap set). */
  ratio?: number | null
  exceeded?: boolean
  className?: string
}

/** Usage against a cap: label row plus a thin bar that turns warning at 80%. */
export function CapBar({ label, value, ratio, exceeded = false, className }: CapBarProps) {
  const hasBar = typeof ratio === 'number'
  const clamped = hasBar ? Math.min(Math.max(ratio, 0), 1) : 0
  const tone = ratioTone(clamped, exceeded)
  const fill = FILL[tone === 'error' ? 'error' : tone === 'warning' ? 'warning' : 'accent']
  return (
    <div className={cn('space-y-1.5', className)}>
      {label || value ? (
        <div className="flex items-baseline justify-between gap-2 text-xs">
          {label ? <span className="font-medium text-text-primary">{label}</span> : <span />}
          {value ? <span className="text-text-muted tabular-nums">{value}</span> : null}
        </div>
      ) : null}
      {hasBar ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-hover/70">
          <div
            className={cn('h-full rounded-full transition-[width] duration-300', fill)}
            style={{ width: `${Math.round(clamped * 100)}%` }}
          />
        </div>
      ) : null}
    </div>
  )
}

export default CapBar
