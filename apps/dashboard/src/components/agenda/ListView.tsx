import { useMemo } from 'react'
import { formatTime } from '../../lib/agenda-dates'
import type { AgendaCalendar, AgendaEvent } from '../../lib/agenda-api'

type ListViewProps = {
  events: AgendaEvent[]
  calendars: AgendaCalendar[]
  onSelectEvent: (event: AgendaEvent) => void
}

export default function ListView({ events, calendars, onSelectEvent }: ListViewProps) {
  const calColor = useMemo(() => new Map(calendars.map((c) => [c.id, c.color])), [calendars])
  const sorted = useMemo(
    () => [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [events],
  )

  if (sorted.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-text-muted" data-testid="agenda-list-empty">
        No events in this range
      </p>
    )
  }

  return (
    <div className="divide-y divide-border/50" data-testid="agenda-list-view">
      {sorted.map((ev) => {
        const d = new Date(ev.startsAt)
        return (
          <button
            key={ev.id}
            type="button"
            onClick={() => onSelectEvent(ev)}
            className="flex w-full gap-3 px-2 py-3 text-left hover:bg-bg-hover/50"
          >
            <span
              className="mt-1 h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: calColor.get(ev.calendarId ?? '') ?? '#6366f1' }}
            />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-text-heading">{ev.title}</p>
              <p className="text-xs text-text-muted">
                {d.toLocaleDateString()} {ev.allDay ? 'All day' : formatTime(ev.startsAt)}
                {ev.kind === 'orchestrator' ? ' · Orchestrator' : ''}
                {ev.kind === 'implementation' ? ' · Implementation' : ''}
              </p>
            </div>
          </button>
        )
      })}
    </div>
  )
}
