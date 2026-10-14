/** Calendars hidden on Agenda, kept across reloads.

Keys are tenant calendar UUIDs, or legacy ``connectionId|externalId``.
*/

const STORAGE_KEY = 'bokito.agenda.hiddenCalendars'

export function hiddenCalendarKey(connectionId: string, calendarId: string): string {
  return `${connectionId}|${calendarId}`
}

export function isHiddenCalendarKey(value: string): boolean {
  return value.includes('|') || /^[0-9a-f-]{36}$/i.test(value)
}

export function readHiddenCalendars(): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((value): value is string => typeof value === 'string' && isHiddenCalendarKey(value)))
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
