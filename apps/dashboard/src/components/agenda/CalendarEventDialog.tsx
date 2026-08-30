import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import {
  createCalendarEvent,
  updateCalendarEvent,
  type CalendarConnection,
} from '../../lib/calendars-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'

export type CalendarEventEditSeed = {
  id: string
  title: string
  startAt: Date
  endAt: Date | null
  location?: string
  description?: string
  connectionId?: string
}

type CalendarEventDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  connections: CalendarConnection[]
  initialStart?: Date | null
  editEvent?: CalendarEventEditSeed | null
  onCreated: () => void
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function CalendarEventDialog({
  open,
  onOpenChange,
  connections,
  initialStart,
  editEvent = null,
  onCreated,
}: CalendarEventDialogProps) {
  const { t } = useTranslation('nav')
  const editing = Boolean(editEvent?.id)
  const [connectionId, setConnectionId] = useState('')
  const [title, setTitle] = useState('')
  const [startLocal, setStartLocal] = useState('')
  const [endLocal, setEndLocal] = useState('')
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (editEvent) {
      setTitle(editEvent.title || '')
      setLocation(editEvent.location || '')
      setDescription(editEvent.description || '')
      setConnectionId(editEvent.connectionId || connections[0]?.id || '')
      setStartLocal(toLocalInputValue(editEvent.startAt))
      const end =
        editEvent.endAt ||
        new Date(editEvent.startAt.getTime() + 60 * 60 * 1000)
      setEndLocal(toLocalInputValue(end))
      return
    }
    setTitle('')
    setLocation('')
    setDescription('')
    setConnectionId(connections[0]?.id ?? '')
    const start = initialStart ? new Date(initialStart) : new Date()
    if (!initialStart) {
      start.setMinutes(0, 0, 0)
      start.setHours(start.getHours() + 1)
    }
    const end = new Date(start)
    end.setHours(end.getHours() + 1)
    setStartLocal(toLocalInputValue(start))
    setEndLocal(toLocalInputValue(end))
  }, [open, connections, initialStart, editEvent])

  const submit = async () => {
    if (!title.trim() || !startLocal || !endLocal) {
      setError(t('agendaPage.calendar.createValidation'))
      return
    }
    if (!editing && !connectionId) {
      setError(t('agendaPage.calendar.createValidation'))
      return
    }
    const startAt = new Date(startLocal)
    const endAt = new Date(endLocal)
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
      setError(t('agendaPage.calendar.createValidation'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (editing && editEvent) {
        await updateCalendarEvent(editEvent.id, {
          title: title.trim(),
          start_at: startAt.toISOString(),
          end_at: endAt.toISOString(),
          description: description.trim(),
          location: location.trim(),
        })
      } else {
        await createCalendarEvent({
          connection_id: connectionId,
          title: title.trim(),
          start_at: startAt.toISOString(),
          end_at: endAt.toISOString(),
          description: description.trim(),
          location: location.trim(),
        })
      }
      onOpenChange(false)
      onCreated()
    } catch (err) {
      setError(
        formatApiErrorMessage(
          err,
          editing ? t('agendaPage.calendar.updateError') : t('agendaPage.calendar.createError'),
        ),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? t('agendaPage.calendar.editTitle')
              : t('agendaPage.calendar.createTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {!editing ? (
            <div className="space-y-1.5">
              <Label htmlFor="cal-conn">{t('agendaPage.calendar.connection')}</Label>
              <Select value={connectionId} onValueChange={setConnectionId}>
                <SelectTrigger id="cal-conn" className="h-9">
                  <SelectValue placeholder={t('agendaPage.calendar.connection')} />
                </SelectTrigger>
                <SelectContent>
                  {connections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="cal-title">{t('agendaPage.calendar.eventTitle')}</Label>
            <Input
              id="cal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="cal-start">{t('agendaPage.calendar.start')}</Label>
              <Input
                id="cal-start"
                type="datetime-local"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cal-end">{t('agendaPage.calendar.end')}</Label>
              <Input
                id="cal-end"
                type="datetime-local"
                value={endLocal}
                onChange={(e) => setEndLocal(e.target.value)}
                className="h-9"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cal-loc">{t('agendaPage.calendar.location')}</Label>
            <Input
              id="cal-loc"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cal-desc">{t('agendaPage.calendar.description')}</Label>
            <Input
              id="cal-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="h-9"
            />
          </div>
          {error ? <p className="text-xs text-status-error">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('agendaPage.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={saving || (!editing && connections.length === 0)}
          >
            {saving
              ? t('agendaPage.calendar.saving')
              : editing
                ? t('agendaPage.calendar.updateSubmit')
                : t('agendaPage.calendar.createSubmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
