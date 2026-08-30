import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Button } from '../ui/button'
import { deleteCalendarEvent } from '../../lib/calendars-api'
import type { AgendaItem } from '../../lib/orchestration-api'
import { formatAppDate, formatAppTime } from '../../lib/app-locale'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import type { CalendarEventEditSeed } from './CalendarEventDialog'

type CalendarEventDetailDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: AgendaItem | null
  onDeleted: () => void
  onEdit: (seed: CalendarEventEditSeed) => void
}

function calendarEventId(item: AgendaItem): string | null {
  const raw = item.id.startsWith('cal:') ? item.id.slice(4) : item.id
  return raw || null
}

function parseAt(iso: string): Date {
  return new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`)
}

export default function CalendarEventDetailDialog({
  open,
  onOpenChange,
  item,
  onDeleted,
  onEdit,
}: CalendarEventDetailDialogProps) {
  const { t, i18n } = useTranslation('nav')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!item) return null

  const start = parseAt(item.at)
  const end = item.end_at ? parseAt(item.end_at) : null
  const provider = item.provider_label || item.provider || ''

  const remove = async () => {
    const id = calendarEventId(item)
    if (!id) return
    if (!window.confirm(t('agendaPage.calendar.deleteConfirm'))) return
    setBusy(true)
    setError(null)
    try {
      await deleteCalendarEvent(id)
      onOpenChange(false)
      onDeleted()
    } catch (err) {
      setError(formatApiErrorMessage(err, t('agendaPage.calendar.deleteError')))
    } finally {
      setBusy(false)
    }
  }

  const edit = () => {
    const id = calendarEventId(item)
    if (!id) return
    onOpenChange(false)
    onEdit({
      id,
      title: item.name || '',
      startAt: start,
      endAt: end,
      location: item.location || '',
      description: item.instructions || '',
      connectionId: item.connection_id || undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p className="text-text-muted">
            {formatAppDate(start, i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })}
            {' · '}
            {formatAppTime(start, i18n.language)}
            {end ? ` – ${formatAppTime(end, i18n.language)}` : ''}
          </p>
          {provider ? (
            <p>
              <span className="text-text-muted">{t('agendaPage.calendar.provider')}: </span>
              {provider}
            </p>
          ) : null}
          {item.calendar_name ? (
            <p>
              <span className="text-text-muted">{t('agendaPage.calendar.calendarName')}: </span>
              {item.calendar_name}
            </p>
          ) : null}
          {item.location ? (
            <p>
              <span className="text-text-muted">{t('agendaPage.calendar.location')}: </span>
              {item.location}
            </p>
          ) : null}
          {item.instructions ? (
            <p className="whitespace-pre-wrap text-text-secondary">{item.instructions}</p>
          ) : null}
          {item.html_link ? (
            <p>
              <a
                href={item.html_link}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                {t('agendaPage.calendar.openExternal')}
              </a>
            </p>
          ) : null}
          {error ? <p className="text-xs text-status-error">{error}</p> : null}
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('agendaPage.cancel', { defaultValue: 'Close' })}
          </Button>
          <Button type="button" variant="outline" onClick={edit} disabled={busy}>
            {t('agendaPage.calendar.edit')}
          </Button>
          <Button type="button" variant="destructive" onClick={() => void remove()} disabled={busy}>
            {t('agendaPage.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
