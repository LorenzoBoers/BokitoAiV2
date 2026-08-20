import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'

/** One dot on the horizontal platform timeline. */
export type TimelinePoint = {
  id: string
  at: Date
  label: string
  sublabel?: string
  tone: 'past' | 'error' | 'live' | 'planned'
}

type Props = {
  points: TimelinePoint[]
  /** Load older history when the user scrolls to the left edge. */
  onLoadOlder?: () => void
  hasMore?: boolean
  loadingOlder?: boolean
}

const PX_PER_MINUTE = 4
const STRIP_HEIGHT = 92
const LINE_Y = 40
const EDGE_PADDING = 48
/** Future window so upcoming planned items have room on the right. */
const FUTURE_MINUTES = 8 * 60

const minutesBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000

function toneDotClass(tone: TimelinePoint['tone']): string {
  switch (tone) {
    case 'error':
      return 'bg-status-error border-status-error'
    case 'live':
      return 'bg-status-success border-status-success'
    case 'planned':
      return 'bg-transparent border-accent border-2'
    default:
      return 'bg-accent/80 border-accent/80'
  }
}

type Cluster = {
  key: string
  at: Date
  points: TimelinePoint[]
  tone: TimelinePoint['tone']
}

/** Group points into per-minute clusters so bursts render as one larger dot. */
function clusterPoints(points: TimelinePoint[]): Cluster[] {
  const byMinute = new Map<string, Cluster>()
  for (const point of points) {
    if (Number.isNaN(point.at.getTime())) continue
    const key = `${point.tone === 'planned' ? 'p' : 'e'}:${Math.floor(point.at.getTime() / 60_000)}`
    const existing = byMinute.get(key)
    if (existing) {
      existing.points.push(point)
      if (point.tone === 'error') existing.tone = 'error'
    } else {
      byMinute.set(key, { key, at: point.at, points: [point], tone: point.tone })
    }
  }
  return [...byMinute.values()].sort((a, b) => a.at.getTime() - b.at.getTime())
}

function formatTick(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function formatDayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

/**
 * Horizontal, infinitely scrollable platform timeline: a line with a dot per
 * minute of activity. Past events sit left of the "now" marker, planned
 * agenda items sit right of it as hollow dots. Scrolling to the left edge
 * loads older history.
 */
export default function TimelineStrip({ points, onLoadOlder, hasMore, loadingOlder }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const didInitialScroll = useRef(false)
  const prevStartMs = useRef<number | null>(null)

  const now = new Date()
  const clusters = useMemo(() => clusterPoints(points), [points])

  const oldest = clusters.length ? clusters[0].at : new Date(now.getTime() - 60 * 60_000)
  // Round the visible range outward to the hour so ticks land cleanly.
  const start = new Date(Math.floor(Math.min(oldest.getTime(), now.getTime() - 60 * 60_000) / 3_600_000) * 3_600_000)
  const end = new Date(now.getTime() + FUTURE_MINUTES * 60_000)
  const totalWidth = Math.max(600, minutesBetween(start, end) * PX_PER_MINUTE + EDGE_PADDING * 2)

  const xFor = useCallback(
    (d: Date) => EDGE_PADDING + minutesBetween(start, d) * PX_PER_MINUTE,
    [start],
  )

  // Hour ticks; label every 2 hours to avoid clutter, day label at midnight.
  const ticks = useMemo(() => {
    const out: { at: Date; major: boolean; dayStart: boolean }[] = []
    const first = new Date(Math.ceil(start.getTime() / 3_600_000) * 3_600_000)
    for (let t = first.getTime(); t <= end.getTime(); t += 3_600_000) {
      const at = new Date(t)
      out.push({ at, major: at.getHours() % 2 === 0, dayStart: at.getHours() === 0 })
    }
    return out
  }, [start, end])

  // First render: park the viewport at "now" (right-hand side).
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || didInitialScroll.current) return
    didInitialScroll.current = true
    el.scrollLeft = Math.max(0, xFor(now) - el.clientWidth * 0.72)
    prevStartMs.current = start.getTime()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xFor])

  // When older history is prepended, the origin shifts left: compensate the
  // scroll position so the view does not jump.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const prev = prevStartMs.current
    if (prev != null && start.getTime() < prev) {
      el.scrollLeft += ((prev - start.getTime()) / 60_000) * PX_PER_MINUTE
    }
    prevStartMs.current = start.getTime()
  }, [start])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || !onLoadOlder || !hasMore || loadingOlder) return
    if (el.scrollLeft < 160) onLoadOlder()
  }, [onLoadOlder, hasMore, loadingOlder])

  const nowX = xFor(now)

  return (
    <div className="relative mb-3 rounded-xl border border-border/60 bg-bg-elevated">
      {loadingOlder ? (
        <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5 rounded-md bg-bg-elevated/90 px-2 py-1 text-[10.5px] text-text-muted">
          <Loader2 size={11} className="animate-spin" />
          Loading history...
        </div>
      ) : null}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="overflow-x-auto overflow-y-hidden [scrollbar-width:thin]"
        style={{ height: STRIP_HEIGHT }}
      >
        <div className="relative" style={{ width: totalWidth, height: '100%' }}>
          {/* Baseline */}
          <div
            className="absolute left-0 right-0 border-t border-border/60"
            style={{ top: LINE_Y }}
          />

          {/* Hour ticks */}
          {ticks.map(({ at, major, dayStart }) => (
            <div key={at.getTime()} className="absolute" style={{ left: xFor(at), top: 0, height: '100%' }}>
              <div
                className={cn('absolute w-px', dayStart ? 'bg-border' : 'bg-border/50')}
                style={{ top: LINE_Y - (dayStart ? 8 : 4), height: dayStart ? 16 : 8 }}
              />
              {major ? (
                <span className="absolute -translate-x-1/2 whitespace-nowrap text-[9.5px] tabular-nums text-text-muted" style={{ top: LINE_Y + 12 }}>
                  {formatTick(at)}
                </span>
              ) : null}
              {dayStart ? (
                <span className="absolute -translate-x-1/2 whitespace-nowrap text-[9.5px] font-medium text-text-secondary" style={{ top: 6 }}>
                  {formatDayLabel(at)}
                </span>
              ) : null}
            </div>
          ))}

          {/* Now marker */}
          <div className="absolute" style={{ left: nowX, top: 8, bottom: 8 }}>
            <div className="h-full w-px bg-accent/70" />
            <span className="absolute -translate-x-1/2 rounded bg-accent/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-accent" style={{ top: -2, left: 0 }}>
              Now
            </span>
          </div>

          {/* Event / planned dots */}
          {clusters.map((cluster) => {
            const size = Math.min(14, 8 + (cluster.points.length - 1) * 2)
            const titleLines = cluster.points
              .slice(0, 6)
              .map((p) => `${formatTick(p.at)}  ${p.label}${p.sublabel ? ` — ${p.sublabel}` : ''}`)
            if (cluster.points.length > 6) titleLines.push(`+${cluster.points.length - 6} more`)
            return (
              <div
                key={cluster.key}
                title={titleLines.join('\n')}
                className={cn(
                  'absolute -translate-x-1/2 -translate-y-1/2 cursor-default rounded-full border transition-transform hover:scale-125',
                  toneDotClass(cluster.tone),
                )}
                style={{ left: xFor(cluster.at), top: LINE_Y, width: size, height: size }}
              />
            )
          })}
        </div>
      </div>
      <div className="flex items-center gap-3 border-t border-border/40 px-3 py-1.5 text-[10px] text-text-muted">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-accent/80" /> Executed</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-status-error" /> Failed</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-status-success" /> Live</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full border-2 border-accent" /> Planned</span>
        <span className="ml-auto">Scroll left for history</span>
      </div>
    </div>
  )
}
