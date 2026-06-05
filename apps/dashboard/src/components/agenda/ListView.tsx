import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { Button } from '../ui/button'
import { formatTime } from '../../lib/agenda-dates'
import type { AgendaCalendar, AgendaEvent } from '../../lib/agenda-api'

type ListViewProps = {
  events: AgendaEvent[]
  calendars: AgendaCalendar[]
  onSelectEvent: (event: AgendaEvent) => void
  onCreateEvent?: () => void
}

export default function ListView({ events, calendars, onSelectEvent, onCreateEvent }: ListViewProps) {
  const { t } = useTranslation('agenda')
  const calColor = useMemo(() => new Map(calendars.map((c) => [c.id, c.color])), [calendars])
  const sorted = useMemo(
    () => [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [events],
  )

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center" data-testid="agenda-list-empty">
        <p className="text-sm text-text-muted">{t('empty.noEvents')}</p>
        {onCreateEvent ? (
          <Button type="button" size="sm" variant="outline" onClick={onCreateEvent}>
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            {t('event.new')}
          </Button>
        ) : null}
      </div>
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
