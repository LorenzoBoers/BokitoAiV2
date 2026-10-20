import { cn } from '../../lib/utils'
import type { TicketStageKind } from '../../lib/tickets-api'

const KIND_COLOR: Record<TicketStageKind, string> = {
  open: 'text-muted-foreground',
  waiting: 'text-status-warning',
  done: 'text-status-success',
  closed: 'text-status-success/80',
}

/**
 * ClickUp-style progress glyph for a stage kind:
 * not started (open) → empty dashed, active (waiting) → pie that grows with
 * how many active stages the flow has, done → check ring, closed → solid check.
 *
 * ``fill`` is the fraction of the active pie (0–1). Omit it for a lone active
 * stage, which reads as half.
 */
export function StageProgressIcon({
  kind,
  fill,
  className,
  title,
  size = 18,
}: {
  kind: TicketStageKind
  /** How much of the active ring to fill. Ignored for other kinds. */
  fill?: number
  className?: string
  title?: string
  size?: number
}) {
  const color = KIND_COLOR[kind] ?? KIND_COLOR.open
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={cn('block shrink-0', color, className)}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
    >
      {kind === 'open' ? (
        <circle
          cx="8"
          cy="8"
          r="5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="2.2 2.2"
          opacity="0.85"
        />
      ) : null}
      {kind === 'waiting' ? (
        <>
          <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
          <path d={pieSlice(fill)} fill="currentColor" />
        </>
      ) : null}
      {kind === 'done' ? (
        <>
          <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M5.2 8.1 L7.1 10 L10.8 5.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : null}
      {kind === 'closed' ? (
        <>
          <circle cx="8" cy="8" r="6" fill="currentColor" />
          <path
            d="M5.1 8.1 L7.1 10 L10.9 5.7"
            fill="none"
            stroke="rgb(var(--color-bg-elevated))"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : null}
    </svg>
  )
}

/** Wedge from 12 o'clock, clockwise. A lone active stage (no fraction) is half full. */
function pieSlice(fill: number | undefined): string {
  const fraction = Math.min(0.92, Math.max(0.08, fill ?? 0.5))
  const cx = 8
  const cy = 8
  const r = 5.5
  const start = -Math.PI / 2
  const end = start + fraction * Math.PI * 2
  const x1 = cx + r * Math.cos(start)
  const y1 = cy + r * Math.sin(start)
  const x2 = cx + r * Math.cos(end)
  const y2 = cy + r * Math.sin(end)
  const large = fraction > 0.5 ? 1 : 0
  const round = (n: number) => Math.round(n * 100) / 100
  return `M ${cx} ${cy} L ${round(x1)} ${round(y1)} A ${r} ${r} 0 ${large} 1 ${round(x2)} ${round(y2)} Z`
}
