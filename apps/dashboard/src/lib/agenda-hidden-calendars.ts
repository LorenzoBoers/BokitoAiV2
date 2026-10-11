/** Sub-calendars hidden on Agenda, kept across reloads (`connectionId|calendarId`). */

const STORAGE_KEY = 'bokito.agenda.hiddenCalendars'

export function hiddenCalendarKey(connectionId: string, calendarId: string): string {
  return `${connectionId}|${calendarId}`
}

export function readHiddenCalendars(): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((value): value is string => typeof value === 'string' && value.includes('|')))
  } catch {
    return new Set()
  }
}

export function writeHiddenCalendars(keys: ReadonlySet<string>): void {
  try {
    if (keys.size === 0) globalThis.localStorage?.removeItem(STORAGE_KEY)
    else globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...keys]))
  } catch {
    // Private mode: the switch still hides calendars until the next reload.
  }
}
