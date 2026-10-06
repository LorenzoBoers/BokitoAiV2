import { cn } from '../../lib/utils'
import type { TicketStageKind } from '../../lib/tickets-api'

const KIND_COLOR: Record<TicketStageKind, string> = {
  open: 'text-muted-foreground',
  waiting: 'text-status-warning',
  done: 'text-status-success',
  closed: 'text-emerald-400',
}

/**
 * ClickUp-style progress glyph for a stage kind:
 * not started (open) → empty dashed, active (waiting) → partial fill,
 * done (klaar) → check ring, closed → solid check.
 */
export function StageProgressIcon({
  kind,
  className,
  title,
  size = 18,
}: {
  kind: TicketStageKind
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
      className={cn('shrink-0', color, className)}
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
          <path d="M8 2.5 A5.5 5.5 0 0 1 13.5 8 L8 8 Z" fill="currentColor" />
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
