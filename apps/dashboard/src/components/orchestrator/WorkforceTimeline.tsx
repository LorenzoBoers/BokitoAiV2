import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '../ui/badge'
import { type RuntimeActivity } from '../../lib/workforce-api'

function formatTs(value: number | undefined): string {
  if (!value) return '-'
  const d = new Date(value)
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function clamp(value: number, min: number, max: number): number {
  if (max <= min) return min
  return Math.min(max, Math.max(min, value))
}

function toTs(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

function formatDurationMs(startTs: number | null, endTs: number | null): string {
  if (!startTs || !endTs || endTs <= startTs) return '-'
  const totalMins = Math.round((endTs - startTs) / 60000)
  const hours = Math.floor(totalMins / 60)
  const mins = totalMins % 60
  if (hours <= 0) return `${mins}m`
  if (mins <= 0) return `${hours}h`
  return `${hours}h ${mins}m`
}

interface Props {
  activities: RuntimeActivity[]
  labelByAgentId: Map<string, string>
  roleByAgentId: Map<string, string>
  onHighlightAgentChange?: (agentId: string | null) => void
}

export default function WorkforceTimeline({
  activities,
  labelByAgentId,
  roleByAgentId,
  onHighlightAgentChange,
}: Props) {
  const HOUR_MS = 60 * 60 * 1000
  const DEFAULT_WINDOW_MS = 8 * HOUR_MS
  const STUB_DURATION_MS = 10 * 60 * 1000
  const STALE_EXECUTING_MS = 4 * HOUR_MS
  const items = useMemo(
    () =>
      [...activities]
        .sort((a, b) => Number(a.planned_for ?? a.created_at) - Number(b.planned_for ?? b.created_at))
        .slice(-80),
    [activities],
  )

  const [nowTs, setNowTs] = useState(() => Date.now())
  const [windowDurationMs] = useState(DEFAULT_WINDOW_MS)
  const [windowStartTs, setWindowStartTs] = useState(() => Date.now() - DEFAULT_WINDOW_MS / 2)
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ pointerId: number; startX: number; startWindowStart: number } | null>(null)

  const timeBounds = useMemo(() => {
    const points = items.flatMap((activity) => {
      const plannedStart = toTs(activity.planned_start) ?? toTs(activity.planned_for) ?? toTs(activity.created_at)
      const plannedEnd = toTs(activity.planned_end)
      const actualStart = toTs(activity.actual_start) ?? toTs(activity.started_at) ?? toTs(activity.session_started_at)
      const actualEnd = toTs(activity.actual_end) ?? toTs(activity.ended_at) ?? toTs(activity.session_ended_at)
      return [plannedStart, plannedEnd, actualStart, actualEnd].filter((v): v is number => v !== null)
    })
    points.push(nowTs)
    const minTs = Math.min(...points) - 2 * HOUR_MS
    const maxTs = Math.max(...points) + 2 * HOUR_MS
    const maxStart = Math.max(minTs, maxTs - windowDurationMs)
    return { minStart: minTs, maxStart }
  }, [items, nowTs, windowDurationMs, HOUR_MS])

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTs(Date.now())
    }, 30_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    setWindowStartTs((prev) => clamp(prev, timeBounds.minStart, timeBounds.maxStart))
  }, [timeBounds.minStart, timeBounds.maxStart])

  const windowEndTs = windowStartTs + windowDurationMs
  const nowRatio = Math.max(0, Math.min(1, (nowTs - windowStartTs) / windowDurationMs))
  const firstHourMark = Math.ceil(windowStartTs / HOUR_MS) * HOUR_MS
  const hourMarks: number[] = []
  for (let mark = firstHourMark; mark <= windowEndTs; mark += HOUR_MS) {
    hourMarks.push(mark)
  }

  const formatHourLabel = (ts: number): string => {
    const d = new Date(ts)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    onHighlightAgentChange?.(null)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWindowStart: windowStartTs,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsDragging(true)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const width = Math.max(1, event.currentTarget.clientWidth)
    const deltaX = event.clientX - drag.startX
    const deltaMs = (deltaX / width) * windowDurationMs
    const nextStart = clamp(drag.startWindowStart - deltaMs, timeBounds.minStart, timeBounds.maxStart)
    setWindowStartTs(nextStart)
  }

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag && drag.pointerId === event.pointerId) {
      dragRef.current = null
      setIsDragging(false)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    }
  }

  const handleLostPointerCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag && drag.pointerId === event.pointerId) {
      dragRef.current = null
      setIsDragging(false)
    }
  }

  if (!items.length) {
    return (
      <div className="h-full rounded-lg border border-border/70 bg-bg-elevated/60 px-3 py-2">
        <div className="text-xs font-semibold text-text-secondary">Tijdlijn</div>
        <div className="h-[72px] flex items-center text-xs text-text-muted">Nog geen tijdlijn-items.</div>
      </div>
    )
  }

  const laneTop = {
    builder: 12,
    tester: 28,
    auditor: 44,
    activity: 60,
  } as const

  const laneFromRole = (agentId: string): keyof typeof laneTop => {
    const role = (roleByAgentId.get(agentId) ?? '').toLowerCase()
    if (role === 'builder') return 'builder'
    if (role === 'tester') return 'tester'
    if (role === 'auditor') return 'auditor'
    return 'activity'
  }

  const toneClass = (type: RuntimeActivity['type'] | 'stale'): string => {
    if (type === 'planned') return 'bg-accent/85'
    if (type === 'executing') return 'bg-status-success'
    if (type === 'completed') return 'bg-status-success/60'
    if (type === 'failed') return 'bg-status-error/85'
    if (type === 'stale') return 'bg-text-muted/75'
    return 'bg-text-muted/80'
  }

  return (
    <div className="h-full rounded-lg border border-border/70 bg-bg-elevated/60 px-3 py-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-text-secondary">Tijdlijn</div>
        <Badge variant="neutral">{items.length}</Badge>
      </div>

      <div className="relative mt-1 h-[108px]">
        <div className="absolute left-0 top-[10px] text-[10px] font-medium text-text-secondary">Builder</div>
        <div className="absolute left-0 top-[26px] text-[10px] font-medium text-text-secondary">Tester</div>
        <div className="absolute left-0 top-[42px] text-[10px] font-medium text-text-secondary">Auditor</div>
        <div className="absolute left-0 top-[58px] text-[10px] font-medium text-text-secondary">Activiteit</div>

        <div
          className={`absolute left-[52px] right-0 top-0 bottom-0 ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{ touchAction: 'pan-y', userSelect: 'none' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onLostPointerCapture={handleLostPointerCapture}
          onDragStart={(event) => event.preventDefault()}
        >
          <div className="absolute left-0 right-0 top-[76px] h-px bg-border/70" />

          {hourMarks.map((hourTs) => (
            <div key={hourTs} className="absolute top-0" style={{ left: `${((hourTs - windowStartTs) / windowDurationMs) * 100}%` }}>
              <div className="absolute top-[20px] h-[56px] w-px bg-border/55" />
              <div className="absolute top-[82px] text-[10px] font-semibold text-text-primary/90 -translate-x-1/2">
                {formatHourLabel(hourTs)}
              </div>
            </div>
          ))}

          <div className="absolute top-0 bottom-0 -translate-x-1/2 z-10" style={{ left: `${nowRatio * 100}%` }}>
            <div className="absolute top-[20px] h-[56px] w-px bg-status-error/90" />
            <div className="absolute top-[2px] left-1/2 -translate-x-1/2 rounded bg-status-error px-1 py-0.5 text-[9px] font-semibold text-white">
              Nu
            </div>
          </div>

          {items.map((activity) => {
            const agent = labelByAgentId.get(activity.agent_id) ?? 'Agent'
            const roleLane = laneFromRole(activity.agent_id)
            const plannedStart = toTs(activity.planned_start) ?? toTs(activity.planned_for) ?? toTs(activity.created_at)
            const plannedEnd = toTs(activity.planned_end)
            const actualStart = toTs(activity.actual_start) ?? toTs(activity.started_at) ?? toTs(activity.session_started_at)
            const actualEnd = toTs(activity.actual_end) ?? toTs(activity.ended_at) ?? toTs(activity.session_ended_at)
            const lastUpdate = toTs(activity.updated_at) ?? toTs(activity.created_at)
            const isStaleExecuting =
              activity.type === 'executing' &&
              !actualEnd &&
              Boolean(lastUpdate) &&
              nowTs - (lastUpdate ?? nowTs) > STALE_EXECUTING_MS
            const effectiveType: RuntimeActivity['type'] | 'stale' = isStaleExecuting ? 'stale' : activity.type
            const visualStart = activity.type === 'planned' ? plannedStart : (actualStart ?? plannedStart)
            const visualEnd =
              effectiveType === 'planned'
                ? (plannedEnd ?? (visualStart ? visualStart + STUB_DURATION_MS : null))
                : effectiveType === 'executing'
                  ? (visualStart ? Math.max(visualStart, nowTs) : nowTs)
                  : effectiveType === 'stale'
                    ? (lastUpdate ?? (visualStart ? visualStart + STUB_DURATION_MS : null))
                  : (actualEnd ?? (visualStart ? visualStart + STUB_DURATION_MS : null))
            if (!visualStart || !visualEnd) return null
            const clampedStart = Math.max(visualStart, windowStartTs)
            const clampedEnd = Math.min(Math.max(clampedStart + 1, visualEnd), windowEndTs)
            if (clampedEnd <= windowStartTs || clampedStart >= windowEndTs) return null
            const left = ((clampedStart - windowStartTs) / windowDurationMs) * 100
            const width = Math.max(0.8, ((clampedEnd - clampedStart) / windowDurationMs) * 100)
            const plannedStartTxt = formatTs(plannedStart ?? undefined)
            const plannedEndTxt = formatTs(plannedEnd ?? undefined)
            const actualStartTxt = formatTs(actualStart ?? undefined)
            const actualEndTxt = formatTs(actualEnd ?? undefined)
            const statusLabel = effectiveType === 'stale' ? 'verlopen' : activity.type
            const durationTxt = formatDurationMs(actualStart ?? visualStart, actualEnd ?? (effectiveType === 'executing' ? nowTs : visualEnd))
            return (
              <div
                key={activity.id}
                className="group absolute z-[5]"
                style={{ left: `${left}%`, top: laneTop[roleLane] - 2, width: `${width}%` }}
                onPointerEnter={() => onHighlightAgentChange?.(activity.agent_id)}
                onPointerLeave={() => onHighlightAgentChange?.(null)}
              >
                <div className={`h-4 rounded ${toneClass(effectiveType)} ${effectiveType === 'executing' ? 'animate-pulse' : ''} shadow-sm`} />
                <div className={`absolute right-[-4px] top-1/2 h-2 w-2 -translate-y-1/2 rounded-full ${toneClass(effectiveType)}`} />
                <div className={`pointer-events-none absolute left-1/2 top-[-8px] -translate-x-1/2 -translate-y-full opacity-0 transition-opacity z-20 ${isDragging ? '' : 'group-hover:opacity-100'}`}>
                  <div className="w-[260px] rounded-md border border-border bg-bg-elevated/95 px-2 py-1.5 shadow-md">
                    <div className="text-[11px] font-semibold text-text-primary">{activity.title}</div>
                    <div className="text-[10px] text-text-secondary mt-0.5">
                      <span className="font-semibold text-text-primary">Agent:</span> {agent}
                    </div>
                    <div className="text-[10px] text-text-secondary">
                      <span className="font-semibold text-text-primary">Status:</span> {statusLabel}
                    </div>
                    <div className="text-[10px] text-text-secondary">
                      <span className="font-semibold text-text-primary">Gepland start:</span> {plannedStartTxt}
                    </div>
                    <div className="text-[10px] text-text-secondary">
                      <span className="font-semibold text-text-primary">Gepland eind:</span> {plannedEndTxt}
                    </div>
                    <div className="text-[10px] text-text-secondary">
                      <span className="font-semibold text-text-primary">Actueel start:</span> {actualStartTxt}
                    </div>
                    <div className="text-[10px] text-text-secondary">
                      <span className="font-semibold text-text-primary">Actueel eind:</span> {actualEndTxt}
                    </div>
                    <div className="text-[10px] text-text-secondary">
                      <span className="font-semibold text-text-primary">Duur:</span> {durationTxt}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
