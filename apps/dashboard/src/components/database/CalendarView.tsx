import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useDatabase } from '../../context/DatabaseContext'
import type { CalendarViewConfig, CustomRecord } from '../../types/custom-db'
import { Button } from '../ui/button'

const DAY_NAMES = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo']
const MONTH_NAMES = [
  'Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni',
  'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December',
]
type CalendarMode = 'month' | 'week' | 'day'

function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dow = d.getDay() // 0=Sun
  const mondayOffset = dow === 0 ? -6 : 1 - dow
  d.setDate(d.getDate() + mondayOffset)
  return d
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

export default function CalendarView() {
  const { fields, records, activeView } = useDatabase()

  const config = (activeView?.config ?? {}) as CalendarViewConfig
  const dateField = fields.find((f) => f.slug === config.dateFieldSlug && f.field_type === 'date')
    ?? fields.find((f) => f.field_type === 'date')
  const titleField = fields.find((f) => f.slug === config.titleFieldSlug)
    ?? fields.find((f) => f.field_type === 'text')
    ?? fields[0]

  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [mode, setMode] = useState<CalendarMode>('month')
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    let startDow = firstDay.getDay() - 1
    if (startDow < 0) startDow = 6

    const days: { date: Date; inMonth: boolean; records: CustomRecord[] }[] = []

    for (let i = startDow - 1; i >= 0; i--) {
      const d = new Date(year, month, -i)
      days.push({ date: d, inMonth: false, records: [] })
    }

    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push({ date: new Date(year, month, d), inMonth: true, records: [] })
    }

    const remaining = 42 - days.length
    for (let i = 1; i <= remaining; i++) {
      days.push({ date: new Date(year, month + 1, i), inMonth: false, records: [] })
    }

    if (dateField) {
      for (const record of records) {
        const val = record.data?.[dateField.slug]
        if (!val) continue
        const recDate = new Date(String(val))
        if (isNaN(recDate.getTime())) continue
        const dayEntry = days.find(
          (d) => d.date.getFullYear() === recDate.getFullYear()
            && d.date.getMonth() === recDate.getMonth()
            && d.date.getDate() === recDate.getDate()
        )
        if (dayEntry) dayEntry.records.push(record)
      }
    }

    return days
  }, [year, month, dateField, records])

  const goMonth = (delta: number) => {
    setCurrentDate(new Date(year, month + delta, 1))
  }
  const goWeek = (delta: number) => {
    const d = new Date(currentDate)
    d.setDate(d.getDate() + delta * 7)
    setCurrentDate(d)
  }
  const goDay = (delta: number) => {
    const d = new Date(currentDate)
    d.setDate(d.getDate() + delta)
    setCurrentDate(d)
  }

  if (!dateField) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        <div className="text-center">
          <p>Voeg een Datum-veld toe om de Kalender-view te gebruiken.</p>
          <p className="text-xs mt-1">Records worden getoond op de dag van het datumveld.</p>
        </div>
      </div>
    )
  }

  const today = new Date()
  const allDatedRecords = useMemo(() => {
    return records
      .map((record) => {
        const raw = record.data?.[dateField.slug]
        if (!raw) return null
        const date = new Date(String(raw))
        if (isNaN(date.getTime())) return null
        return { record, date }
      })
      .filter((item): item is { record: CustomRecord; date: Date } => item !== null)
  }, [records, dateField.slug])

  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate)
    return Array.from({ length: 7 }, (_, idx) => {
      const date = new Date(start)
      date.setDate(start.getDate() + idx)
      const dayRecords = allDatedRecords
        .filter((item) => sameDay(item.date, date))
        .map((item) => item.record)
      return { date, records: dayRecords }
    })
  }, [currentDate, allDatedRecords])

  const dayRecords = useMemo(
    () => allDatedRecords.filter((item) => sameDay(item.date, currentDate)),
    [allDatedRecords, currentDate],
  )

  const periodLabel = useMemo(() => {
    if (mode === 'month') return `${MONTH_NAMES[month]} ${year}`
    if (mode === 'day') {
      const dateText = currentDate.toLocaleDateString('nl-NL', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
      return dateText.charAt(0).toUpperCase() + dateText.slice(1)
    }
    const start = weekDays[0]?.date
    const end = weekDays[6]?.date
    if (!start || !end) return ''
    const startText = `${start.getDate()} ${MONTH_NAMES[start.getMonth()].slice(0, 3)}`
    const endText = `${end.getDate()} ${MONTH_NAMES[end.getMonth()].slice(0, 3)}`
    return `${startText} - ${endText} ${end.getFullYear()}`
  }, [mode, month, year, currentDate, weekDays])

  const handlePrev = () => {
    if (mode === 'month') goMonth(-1)
    else if (mode === 'week') goWeek(-1)
    else goDay(-1)
  }
  const handleNext = () => {
    if (mode === 'month') goMonth(1)
    else if (mode === 'week') goWeek(1)
    else goDay(1)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={handlePrev}>
            <ChevronLeft size={16} />
          </Button>
          <h3 className="text-sm font-semibold text-text-heading min-w-[160px] text-center">
            {periodLabel}
          </h3>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={handleNext}>
            <ChevronRight size={16} />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-border bg-bg-sidebar p-0.5">
            {([
              ['month', 'Maand'],
              ['week', 'Week'],
              ['day', 'Dag'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
                  mode === value ? 'bg-bg-primary text-text-primary' : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <Button size="sm" variant="secondary" className="text-xs" onClick={() => setCurrentDate(new Date())}>
            Vandaag
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {mode === 'month' ? (
          <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden border border-border">
            {DAY_NAMES.map((d) => (
              <div key={d} className="bg-bg-sidebar px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                {d}
              </div>
            ))}

            {calendarDays.map((day, idx) => {
              const isToday = sameDay(day.date, today)
              return (
                <div
                  key={idx}
                  className={`bg-bg-primary min-h-[80px] p-1.5 ${!day.inMonth ? 'opacity-40' : ''}`}
                >
                  <div className={`text-[11px] font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                    isToday ? 'bg-accent text-white' : 'text-text-secondary'
                  }`}>
                    {day.date.getDate()}
                  </div>
                  <div className="space-y-0.5">
                    {day.records.slice(0, 3).map((rec) => (
                      <div
                        key={rec.id}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent truncate cursor-pointer hover:bg-accent/20 transition-colors"
                      >
                        {titleField ? String(rec.data?.[titleField.slug] ?? '') || `#${rec.id}` : `#${rec.id}`}
                      </div>
                    ))}
                    {day.records.length > 3 && (
                      <div className="text-[9px] text-text-muted px-1.5">+{day.records.length - 3} meer</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : mode === 'week' ? (
          <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden border border-border">
            {weekDays.map((day, idx) => {
              const isToday = sameDay(day.date, today)
              return (
                <div key={idx} className="bg-bg-primary min-h-[280px] p-2">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-text-muted">{DAY_NAMES[idx]}</span>
                    <span className={`text-[11px] font-medium w-6 h-6 rounded-full flex items-center justify-center ${
                      isToday ? 'bg-accent text-white' : 'text-text-secondary'
                    }`}>
                      {day.date.getDate()}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {day.records.length === 0 ? (
                      <div className="text-[10px] text-text-muted">No items</div>
                    ) : day.records.map((rec) => (
                      <div
                        key={rec.id}
                        className="text-[10px] px-2 py-1 rounded bg-accent/10 text-accent truncate cursor-pointer hover:bg-accent/20 transition-colors"
                      >
                        {titleField ? String(rec.data?.[titleField.slug] ?? '') || `#${rec.id}` : `#${rec.id}`}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-bg-primary p-3 space-y-2">
            <div className="text-xs font-semibold text-text-heading">
              {currentDate.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
            {dayRecords.length === 0 ? (
              <div className="text-xs text-text-muted">No items on this day.</div>
            ) : (
              <div className="space-y-1.5">
                {dayRecords
                  .sort((a, b) => a.date.getTime() - b.date.getTime())
                  .map(({ record, date }) => (
                    <div key={record.id} className="flex items-center gap-2 rounded border border-border bg-bg-sidebar px-2 py-1.5">
                      <span className="text-[10px] text-text-muted w-12">
                        {date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <div className="text-xs text-text-primary truncate">
                        {titleField ? String(record.data?.[titleField.slug] ?? '') || `#${record.id}` : `#${record.id}`}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
