import { useMemo } from 'react'
import { addDays, formatTime, startOfWeek } from '../../lib/agenda-dates'
import type { AgendaCalendar, AgendaEvent } from '../../lib/agenda-api'

type WeekViewProps = {
  anchor: Date
  events: AgendaEvent[]
  calendars: AgendaCalendar[]
  onSelectEvent: (event: AgendaEvent) => void
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)

export default function WeekView({ anchor, events, calendars, onSelectEvent }: WeekViewProps) {
  const weekStart = startOfWeek(anchor)
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const calColor = useMemo(() => new Map(calendars.map((c) => [c.id, c.color])), [calendars])

  const positioned = useMemo(() => {
    return events
      .filter((ev) => !ev.allDay)
      .map((ev) => {
        const start = new Date(ev.startsAt)
        const end = ev.endsAt ? new Date(ev.endsAt) : new Date(start.getTime() + 3600000)
        const dayIndex = Math.floor((startOfDay(start).getTime() - startOfDay(weekStart).getTime()) / 86400000)
        if (dayIndex < 0 || dayIndex > 6) return null
        const top = (start.getHours() + start.getMinutes() / 60) * 48
        const height = Math.max(24, ((end.getTime() - start.getTime()) / 3600000) * 48)
        return { ev, dayIndex, top, height }
      })
      .filter(Boolean) as Array<{ ev: AgendaEvent; dayIndex: number; top: number; height: number }>
  }, [events, weekStart])

  return (
    <div className="flex min-h-0 flex-1 overflow-auto" data-testid="agenda-week-view">
      <div className="w-12 shrink-0 border-r border-border/60">
        {HOURS.map((h) => (
          <div key={h} className="h-12 border-b border-border/30 pr-1 text-right text-[10px] text-text-muted">
            {h}:00
          </div>
        ))}
      </div>
      <div className="grid min-w-0 flex-1 grid-cols-7">
        {days.map((day, col) => (
          <div key={day.toISOString()} className="border-r border-border/40">
            <div className="border-b border-border/60 py-1 text-center text-xs font-medium text-text-secondary">
              {day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
            </div>
            <div className="relative" style={{ height: 24 * 48 }}>
              {HOURS.map((h) => (
                <div key={h} className="h-12 border-b border-border/20" />
              ))}
              {positioned
                .filter((p) => p.dayIndex === col)
                .map(({ ev, top, height }) => (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => onSelectEvent(ev)}
                    className="absolute left-0.5 right-0.5 overflow-hidden rounded px-1 py-0.5 text-left text-[10px] text-white"
                    style={{
                      top,
                      height,
                      backgroundColor: calColor.get(ev.calendarId ?? '') ?? '#6366f1',
                    }}
                  >
                    <span className="font-medium">{ev.title}</span>
                    <span className="block opacity-90">{formatTime(ev.startsAt)}</span>
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
