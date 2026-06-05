import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  createEvent,
  deleteEvent,
  patchEvent,
  runOrchestratorEvent,
  type AgendaCalendar,
  type AgendaEvent,
} from '../../lib/agenda-api'
import { useAuth } from '../../context/AuthContext'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'

type EventDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  event: AgendaEvent | null
  calendars: AgendaCalendar[]
  defaultCalendarId?: string
  defaultStartsAt?: string
  onSaved: () => void
}

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(value: string): string {
  if (!value) return new Date().toISOString()
  return new Date(value).toISOString()
}

export default function EventDrawer({
  open,
  onOpenChange,
  event,
  calendars,
  defaultCalendarId,
  defaultStartsAt,
  onSaved,
}: EventDrawerProps) {
  const { t } = useTranslation('agenda')
  const { token } = useAuth()
  const isNew = !event
  const readOnly = Boolean(event?.readOnly)
  const isOrchestrator =
    event?.kind === 'orchestrator' ||
    calendars.find((c) => c.id === (event?.calendarId ?? defaultCalendarId))?.kind === 'orchestrator'

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState('')
  const [calendarId, setCalendarId] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [allDay, setAllDay] = useState(false)
  const [recurrenceFreq, setRecurrenceFreq] = useState('none')
  const [recurrenceInterval, setRecurrenceInterval] = useState(1)
  const [prompt, setPrompt] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    if (event && !isNew) {
      setTitle(event.title)
      setDescription(event.description)
      setLocation(event.location)
      setCalendarId(event.calendarId ?? '')
      setStartsAt(toLocalInput(event.startsAt))
      setEndsAt(toLocalInput(event.endsAt))
      setAllDay(event.allDay)
      setRecurrenceFreq(event.recurrenceFreq)
      setRecurrenceInterval(event.recurrenceInterval)
      setPrompt(event.prompt)
      setEnabled(event.enabled)
    } else {
      setTitle('')
      setDescription('')
      setLocation('')
      const defCal =
        defaultCalendarId ?? calendars.find((c) => c.kind === 'user')?.id ?? calendars[0]?.id ?? ''
      setCalendarId(defCal)
      setStartsAt(toLocalInput(defaultStartsAt ?? new Date().toISOString()))
      setEndsAt('')
      setAllDay(false)
      setRecurrenceFreq('none')
      setRecurrenceInterval(1)
      setPrompt('')
      setEnabled(true)
    }
  }, [open, event, isNew, calendars, defaultCalendarId, defaultStartsAt])

  const masterId = event?.masterId && !event.masterId.startsWith('implementation:') ? event.masterId : event?.id

  const handleSave = async () => {
    if (!token || readOnly) return
    setBusy(true)
    try {
      const body = {
        calendarId,
        title: title.trim() || 'Untitled',
        description,
        location,
        startsAt: fromLocalInput(startsAt),
        endsAt: endsAt ? fromLocalInput(endsAt) : null,
        allDay,
        recurrenceFreq,
        recurrenceInterval,
        prompt: isOrchestrator ? prompt : undefined,
        enabled: isOrchestrator ? enabled : undefined,
        kind: isOrchestrator ? 'orchestrator' : 'user',
      }
      if (isNew) {
        await createEvent(body, token)
        toast.success(t('event.saved', { defaultValue: 'Event created' }))
      } else if (masterId && !masterId.startsWith('implementation:')) {
        await patchEvent(masterId, body, token)
        toast.success(t('event.updated', { defaultValue: 'Event updated' }))
      }
      onSaved()
      onOpenChange(false)
    } catch {
      toast.error(t('event.saveFailed', { defaultValue: 'Could not save event' }))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!token || !masterId || readOnly || isNew) return
    if (!window.confirm(t('event.deleteConfirm', { defaultValue: 'Delete this event?' }))) return
    setBusy(true)
    try {
      await deleteEvent(masterId, token)
      toast.success(t('event.deleted', { defaultValue: 'Event deleted' }))
      onSaved()
      onOpenChange(false)
    } catch {
      toast.error(t('event.deleteFailed', { defaultValue: 'Could not delete event' }))
    } finally {
      setBusy(false)
    }
  }

  const handleRun = async () => {
    if (!token || !masterId || readOnly) return
    setBusy(true)
    try {
      await runOrchestratorEvent(masterId, token)
      toast.success(t('event.runStarted', { defaultValue: 'Orchestrator wake started' }))
      onSaved()
    } catch {
      toast.error(t('event.runFailed', { defaultValue: 'Could not run wake' }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isNew ? t('event.new') : t('event.edit')}</DialogTitle>
        </DialogHeader>
        <div className="mt-4 space-y-4">
          {readOnly ? (
            <p className="text-sm text-text-muted">{t('event.readOnly')}</p>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="agenda-event-title">{t('event.title')}</Label>
            <Input
              id="agenda-event-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('event.calendar')}</Label>
            <Select value={calendarId} onValueChange={setCalendarId} disabled={readOnly}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {calendars.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t('event.starts')}</Label>
            <Input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('event.ends')}</Label>
            <Input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              disabled={readOnly}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              disabled={readOnly}
            />
            {t('event.allDay')}
          </label>
          <div className="space-y-1">
            <Label>{t('event.recurrence')}</Label>
            <Select value={recurrenceFreq} onValueChange={setRecurrenceFreq} disabled={readOnly}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('event.recurrenceNone')}</SelectItem>
                <SelectItem value="hourly">{t('event.recurrenceHourly')}</SelectItem>
                <SelectItem value="daily">{t('event.recurrenceDaily')}</SelectItem>
                <SelectItem value="weekly">{t('event.recurrenceWeekly')}</SelectItem>
                <SelectItem value="monthly">{t('event.recurrenceMonthly')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {recurrenceFreq !== 'none' ? (
            <div className="space-y-1">
              <Label>{t('event.interval')}</Label>
              <Input
                type="number"
                min={1}
                value={recurrenceInterval}
                onChange={(e) => setRecurrenceInterval(Number(e.target.value) || 1)}
                disabled={readOnly}
              />
            </div>
          ) : null}
          {isOrchestrator ? (
            <>
              <div className="space-y-1">
                <Label>{t('event.prompt')}</Label>
                <textarea
                  className="w-full min-h-[100px] rounded-md border border-border bg-bg px-3 py-2 text-sm"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={readOnly}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  disabled={readOnly}
                />
                {t('event.enabled')}
              </label>
            </>
          ) : null}
          <div className="space-y-1">
            <Label>{t('event.description')}</Label>
            <textarea
              className="w-full min-h-[80px] rounded-md border border-border bg-bg px-3 py-2 text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('event.location')}</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} disabled={readOnly} />
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            {!readOnly ? (
              <Button type="button" onClick={() => void handleSave()} disabled={busy}>
                {t('event.save')}
              </Button>
            ) : null}
            {isOrchestrator && !isNew && !readOnly ? (
              <Button type="button" variant="secondary" onClick={() => void handleRun()} disabled={busy}>
                {t('event.runNow')}
              </Button>
            ) : null}
            {!readOnly && !isNew ? (
              <Button type="button" variant="destructive" onClick={() => void handleDelete()} disabled={busy}>
                {t('event.delete')}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('event.cancel')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
