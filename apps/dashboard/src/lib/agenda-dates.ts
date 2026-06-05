import type { AgendaView } from './agenda-api'

export function parseAgendaDate(raw: string | null): Date {
  if (!raw) return startOfDay(new Date())
  const d = new Date(`${raw}T12:00:00`)
  if (Number.isNaN(d.getTime())) return startOfDay(new Date())
  return startOfDay(d)
}

export function formatAgendaDateParam(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function startOfWeek(d: Date): Date {
  const x = startOfDay(d)
  const day = x.getDay()
  const diff = day === 0 ? -6 : 1 - day
  return addDays(x, diff)
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
}

export function rangeForView(view: AgendaView, anchor: Date): { start: Date; end: Date } {
  if (view === 'day') {
    const start = startOfDay(anchor)
    return { start, end: addDays(start, 1) }
  }
  if (view === 'week') {
    const start = startOfWeek(anchor)
    return { start, end: addDays(start, 7) }
  }
  if (view === 'list') {
    const start = startOfDay(anchor)
    return { start, end: addDays(start, 90) }
  }
  const start = startOfMonth(anchor)
  const gridStart = startOfWeek(start)
  const end = addDays(gridStart, 42)
  return { start: gridStart, end }
}

export function toIsoRange(start: Date, end: Date): { start: string; end: string } {
  return { start: start.toISOString(), end: end.toISOString() }
}

export function formatMonthLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export function formatWeekLabel(d: Date): string {
  const start = startOfWeek(d)
  const end = addDays(start, 6)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${start.toLocaleDateString(undefined, opts)} - ${end.toLocaleDateString(undefined, opts)}`
}

export function formatDayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

export function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
