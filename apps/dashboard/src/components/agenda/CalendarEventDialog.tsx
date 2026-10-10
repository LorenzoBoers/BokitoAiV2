import { useEffect, useMemo, useState } from 'react'
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
import { Switch } from '../ui/switch'
import { ChoiceSelect } from '../ui/ChoiceSelect'
import {
  calendarBrandSlug,
  createCalendarEvent,
  updateCalendarEvent,
  type CalendarConnection,
} from '../../lib/calendars-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import type { ChoiceGroup } from '../ui/ChoiceSelect'
import { CalendarSwatch } from './CalendarSwatch'

const TARGET_SEP = '::'

/** Writable, switched-on calendars per account; an account without a stored
 * list (not synced yet) is one target on its default calendar. */
function writeTargets(connections: CalendarConnection[]): { groups: ChoiceGroup[]; first: string } {
  let first = ''
  const groups = connections.map((connection) => {
    const label = connection.account || connection.display_name
    const brandSlug = calendarBrandSlug(connection.provider)
    const calendars = connection.calendars ?? []
    const items =
      calendars.length === 0
        ? [{ value: `${connection.id}${TARGET_SEP}`, label, kind: 'calendar' as const, brandSlug }]
        : calendars
            .filter((cal) => cal.enabled && cal.writable)
            .map((cal) => ({
              value: `${connection.id}${TARGET_SEP}${cal.id}`,
              label: cal.name,
              kind: 'calendar' as const,
              brandSlug,
              trailing: <CalendarSwatch color={cal.color} />,
            }))
    if (!first && items.length) {
      const preferred = items.find(
        (item) => item.value === `${connection.id}${TARGET_SEP}${connection.default_write_calendar ?? ''}`,
      )
      first = (preferred ?? items[0]).value
    }
    return { label, items }
  })
  return { groups: groups.filter((g) => g.items.length > 0), first }
}

export type CalendarEventEditSeed = {
  id: string
  title: string
  startAt: Date
  endAt: Date | null
  location?: string
  description?: string
  connectionId?: string
  allDay?: boolean
  startIso?: string
  endIso?: string | null
}

type CalendarEventDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  connections: CalendarConnection[]
  initialStart?: Date | null
  editEvent?: CalendarEventEditSeed | null
  onCreated: () => void
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toLocalInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function datePart(value: string): string {
  return value.slice(0, 10)
}

function isoDatePart(iso: string): string {
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : toDateInput(new Date(iso))
}

function addCalendarDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00`)
  d.setDate(d.getDate() + days)
  return toDateInput(d)
}

function exclusiveEndDate(endIso: string | null | undefined, startDate: string): string {
  if (!endIso) return startDate
  const inclusive = addCalendarDays(isoDatePart(endIso), -1)
  return inclusive < startDate ? startDate : inclusive
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
  const targets = useMemo(() => writeTargets(connections), [connections])
  const [target, setTarget] = useState('')
  const [title, setTitle] = useState('')
  const [allDay, setAllDay] = useState(false)
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
      const nextAllDay = Boolean(editEvent.allDay)
      setTitle(editEvent.title || '')
      setLocation(editEvent.location || '')
      setDescription(editEvent.description || '')
      setAllDay(nextAllDay)
      if (nextAllDay) {
        const startDate = editEvent.startIso
          ? isoDatePart(editEvent.startIso)
          : toDateInput(editEvent.startAt)
        const endDate = exclusiveEndDate(editEvent.endIso, startDate)
        setStartLocal(startDate)
        setEndLocal(endDate)
      } else {
        setStartLocal(toLocalInputValue(editEvent.startAt))
        const end =
          editEvent.endAt ||
          new Date(editEvent.startAt.getTime() + 60 * 60 * 1000)
        setEndLocal(toLocalInputValue(end))
      }
      return
    }
    setTitle('')
    setLocation('')
    setDescription('')
    setAllDay(false)
    setTarget(targets.first)
    const start = initialStart ? new Date(initialStart) : new Date()
    if (!initialStart) {
      start.setMinutes(0, 0, 0)
      start.setHours(start.getHours() + 1)
    }
    const end = new Date(start)
    end.setHours(end.getHours() + 1)
    setStartLocal(toLocalInputValue(start))
    setEndLocal(toLocalInputValue(end))
  }, [open, targets, initialStart, editEvent])

  const toggleAllDay = (checked: boolean) => {
    setAllDay(checked)
    if (checked) {
      const start = datePart(startLocal) || toDateInput(new Date())
      const end = datePart(endLocal) || start
      setStartLocal(start)
      setEndLocal(end < start ? start : end)
      return
    }
    const start = datePart(startLocal) || toDateInput(new Date())
    const end = datePart(endLocal) || start
    setStartLocal(`${start}T09:00`)
    setEndLocal(`${end}T10:00`)
  }

  const submit = async () => {
    if (!title.trim() || !startLocal || !endLocal) {
      setError(t('agendaPage.calendar.createValidation'))
      return
    }
    const [connectionId, calendarId] = target.split(TARGET_SEP)
    if (!editing && !connectionId) {
      setError(t('agendaPage.calendar.createValidation'))
      return
    }
    let startAt: string
    let endAt: string
    if (allDay) {
      const startDate = datePart(startLocal)
      const endDate = datePart(endLocal)
      if (!startDate || !endDate || endDate < startDate) {
        setError(t('agendaPage.calendar.createValidation'))
        return
      }
      startAt = `${startDate}T00:00:00`
      endAt = `${addCalendarDays(endDate, 1)}T00:00:00`
    } else {
      const start = new Date(startLocal)
      const end = new Date(endLocal)
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        setError(t('agendaPage.calendar.createValidation'))
        return
      }
      startAt = start.toISOString()
      endAt = end.toISOString()
    }
    setSaving(true)
    setError(null)
    try {
      if (editing && editEvent) {
        await updateCalendarEvent(editEvent.id, {
          title: title.trim(),
          start_at: startAt,
          end_at: endAt,
          description: description.trim(),
          location: location.trim(),
          all_day: allDay,
        })
      } else {
        await createCalendarEvent({
          connection_id: connectionId,
          calendar_id: calendarId || undefined,
          title: title.trim(),
          start_at: startAt,
          end_at: endAt,
          description: description.trim(),
          location: location.trim(),
          all_day: allDay,
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
              <Label htmlFor="cal-conn">{t('agenda.target', { ns: 'calendar' })}</Label>
              {targets.groups.length === 0 ? (
                <p className="text-xs text-text-muted">{t('agenda.noWritable', { ns: 'calendar' })}</p>
              ) : (
                <ChoiceSelect
                  id="cal-conn"
                  aria-label={t('agenda.target', { ns: 'calendar' })}
                  placeholder={t('agenda.target', { ns: 'calendar' })}
                  triggerClassName="h-9"
                  value={target}
                  onValueChange={setTarget}
                  groups={targets.groups}
                />
              )}
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
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="cal-all-day">{t('agendaPage.calendar.allDay')}</Label>
            <Switch id="cal-all-day" checked={allDay} onCheckedChange={toggleAllDay} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="cal-start">{t('agendaPage.calendar.start')}</Label>
              <Input
                id="cal-start"
                type={allDay ? 'date' : 'datetime-local'}
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cal-end">{t('agendaPage.calendar.end')}</Label>
              <Input
                id="cal-end"
                type={allDay ? 'date' : 'datetime-local'}
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
            disabled={saving || (!editing && !target)}
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
