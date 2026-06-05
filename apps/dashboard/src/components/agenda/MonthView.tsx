import { useMemo } from 'react'
import { addDays, startOfWeek } from '../../lib/agenda-dates'
import type { AgendaCalendar, AgendaEvent } from '../../lib/agenda-api'

type MonthViewProps = {
  anchor: Date
  events: AgendaEvent[]
  calendars: AgendaCalendar[]
  onSelectDay: (day: Date) => void
  onSelectEvent: (event: AgendaEvent) => void
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function MonthView({
  anchor,
  events,
  calendars,
  onSelectDay,
  onSelectEvent,
}: MonthViewProps) {
  const calColor = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of calendars) m.set(c.id, c.color)
    return m
  }, [calendars])

  const gridStart = useMemo(() => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    return startOfWeek(first)
  }, [anchor])

  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart])

  const eventsByDay = useMemo(() => {
    const map = new Map<string, AgendaEvent[]>()
    for (const ev of events) {
      const d = new Date(ev.startsAt)
      if (Number.isNaN(d.getTime())) continue
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      const list = map.get(key) ?? []
      list.push(ev)
      map.set(key, list)
    }
    return map
  }, [events])

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="agenda-month-view">
      <div className="grid grid-cols-7 border-b border-border/60 text-center text-[11px] font-medium text-text-muted">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-2">
            {d}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-px bg-border/40">
        {days.map((day) => {
          const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`
          const inMonth = day.getMonth() === anchor.getMonth()
          const dayEvents = (eventsByDay.get(key) ?? []).slice(0, 3)
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDay(day)}
              className={`flex min-h-[72px] flex-col bg-bg p-1 text-left hover:bg-bg-hover/40 ${
                inMonth ? '' : 'opacity-50'
              }`}
            >
              <span className="text-xs font-medium text-text-secondary">{day.getDate()}</span>
              <div className="mt-0.5 flex flex-col gap-0.5 overflow-hidden">
                {dayEvents.map((ev) => (
                  <span
                    key={ev.id}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectEvent(ev)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.stopPropagation()
                        onSelectEvent(ev)
                      }
                    }}
                    className="truncate rounded px-1 py-0.5 text-[10px] text-white"
                    style={{ backgroundColor: calColor.get(ev.calendarId ?? '') ?? '#6366f1' }}
                  >
                    {ev.title}
                  </span>
                ))}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
