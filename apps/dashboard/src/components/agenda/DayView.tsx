import WeekView from './WeekView'
import type { AgendaCalendar, AgendaEvent } from '../../lib/agenda-api'

type DayViewProps = {
  anchor: Date
  events: AgendaEvent[]
  calendars: AgendaCalendar[]
  onSelectEvent: (event: AgendaEvent) => void
}

/** Reuse week grid with a single-day focus (week column containing anchor). */
export default function DayView(props: DayViewProps) {
  return (
    <div data-testid="agenda-day-view" className="min-h-0 flex-1">
      <WeekView {...props} />
    </div>
  )
}
