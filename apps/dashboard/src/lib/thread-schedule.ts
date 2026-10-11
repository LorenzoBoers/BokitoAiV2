/**
 * A thread with a date is an agenda item; with a repeat it is a recurring task.
 *
 * Server times are naive UTC; cron runs in UTC. The planner speaks local time
 * and converts at the edge.
 */
import { formatAppDate, formatAppTime } from './app-locale'
import type { ScheduleRepeat } from './inbox-api'

type Translate = (key: string, opts?: Record<string, unknown>) => string

/** Server timestamp (naive UTC or with offset) to a Date. */
export function parseServerTime(value: string | null | undefined): Date | null {
  if (!value) return null
  const raw = value.endsWith('Z') || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

/** `datetime-local` value for a Date in local time. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** ISO (UTC) for a `datetime-local` value; null when empty or invalid. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Next round hour (or tomorrow 9:00 after 18:00): a sensible default moment. */
export function defaultMoment(now = new Date()): Date {
  const at = new Date(now)
  if (at.getHours() >= 18) {
    at.setDate(at.getDate() + 1)
    at.setHours(9, 0, 0, 0)
    return at
  }
  at.setHours(at.getHours() + 1, 0, 0, 0)
  return at
}

/** Short label for the list chip: "09:00" today, "vr 09:00" this week, else "12 okt". */
export function scheduleChipLabel(value: string | null | undefined, language?: string | null, now = new Date()): string {
  const date = parseServerTime(value)
  if (!date) return ''
  const time = formatAppTime(date, language)
  if (date.toDateString() === now.toDateString()) return time
  const days = (date.getTime() - now.getTime()) / 86_400_000
  if (days > -6 && days < 6) {
    return `${formatAppDate(date, language, { weekday: 'short' })} ${time}`
  }
  return formatAppDate(date, language, { day: 'numeric', month: 'short' })
}

/** Long label: "vrijdag 12 okt 09:00". */
export function scheduleLongLabel(value: string | null | undefined, language?: string | null): string {
  const date = parseServerTime(value)
  if (!date) return ''
  return `${formatAppDate(date, language, { weekday: 'long', day: 'numeric', month: 'short' })} ${formatAppTime(date, language)}`
}

export type RepeatPreset = 'weekdays' | 'daily' | 'weekly' | 'hourly' | 'custom'

export type RepeatChoice = {
  preset: RepeatPreset
  /** Local clock time `HH:MM` for day-based presets. */
  time: string
  /** Local weekday 0 (Sunday) .. 6 for `weekly`. */
  weekday: number
  /** Raw UTC cron for `custom`. */
  cron: string
}

export const DEFAULT_REPEAT: RepeatChoice = { preset: 'weekdays', time: '09:00', weekday: 1, cron: '0 9 * * 1-5' }

function localToUtc(time: string): { hour: number; minute: number; shift: number } {
  const [h, m] = time.split(':').map((part) => Number(part) || 0)
  const at = new Date()
  at.setHours(h, m, 0, 0)
  let shift = at.getUTCDay() - at.getDay()
  if (shift > 1) shift = -1
  if (shift < -1) shift = 1
  return { hour: at.getUTCHours(), minute: at.getUTCMinutes(), shift }
}

function utcToLocal(hour: number, minute: number): { time: string; shift: number } {
  const at = new Date()
  at.setUTCHours(hour, minute, 0, 0)
  let shift = at.getDay() - at.getUTCDay()
  if (shift > 1) shift = -1
  if (shift < -1) shift = 1
  const pad = (n: number) => String(n).padStart(2, '0')
  return { time: `${pad(at.getHours())}:${pad(at.getMinutes())}`, shift }
}

const wrapDay = (day: number) => ((day % 7) + 7) % 7

/** UTC cron (or interval minutes for `hourly`) for a local repeat choice. */
export function repeatToSchedule(choice: RepeatChoice): { cron: string | null; everyMinutes: number | null } {
  if (choice.preset === 'hourly') return { cron: null, everyMinutes: 60 }
  if (choice.preset === 'custom') return { cron: choice.cron.trim() || null, everyMinutes: null }
  const { hour, minute, shift } = localToUtc(choice.time)
  let dow = '*'
  if (choice.preset === 'weekdays') dow = `${wrapDay(1 + shift)}-${wrapDay(5 + shift)}`
  if (choice.preset === 'weekly') dow = String(wrapDay(choice.weekday + shift))
  return { cron: `${minute} ${hour} * * ${dow}`, everyMinutes: null }
}

/** Read a stored repeat back into the planner's local presets. */
export function repeatFromSchedule(repeat: ScheduleRepeat | null | undefined): RepeatChoice {
  if (!repeat) return DEFAULT_REPEAT
  if (repeat.kind === 'interval') {
    return repeat.everyMinutes === 60
      ? { ...DEFAULT_REPEAT, preset: 'hourly' }
      : { ...DEFAULT_REPEAT, preset: 'custom', cron: '' }
  }
  const parts = repeat.cron.trim().split(/\s+/)
  const custom: RepeatChoice = { ...DEFAULT_REPEAT, preset: 'custom', cron: repeat.cron }
  if (parts.length !== 5 || parts[2] !== '*' || parts[3] !== '*') return custom
  const minute = Number(parts[0])
  const hour = Number(parts[1])
  if (!Number.isInteger(minute) || !Number.isInteger(hour)) return custom
  const { time, shift } = utcToLocal(hour, minute)
  const dow = parts[4]
  if (dow === '*') return { ...DEFAULT_REPEAT, preset: 'daily', time, cron: repeat.cron }
  const range = dow.match(/^(\d)-(\d)$/)
  if (range && wrapDay(Number(range[1]) + shift) === 1 && wrapDay(Number(range[2]) + shift) === 5) {
    return { ...DEFAULT_REPEAT, preset: 'weekdays', time, cron: repeat.cron }
  }
  if (/^\d$/.test(dow)) {
    return { ...DEFAULT_REPEAT, preset: 'weekly', time, weekday: wrapDay(Number(dow) + shift), cron: repeat.cron }
  }
  return custom
}

/** Weekday name for 0 (Sunday) .. 6. */
export function weekdayName(day: number, language?: string | null): string {
  const ref = new Date(2026, 0, 4 + day)
  return formatAppDate(ref, language, { weekday: 'long' })
}

/** "Elke werkdag 09:00", "Elk uur", "Elke 2 uur". */
export function describeRepeat(
  repeat: ScheduleRepeat | null | undefined,
  t: Translate,
  language?: string | null,
): string {
  if (!repeat) return ''
  if (repeat.kind === 'interval') {
    const minutes = repeat.everyMinutes
    if (minutes === 60) return t('schedule.repeat.hourly')
    if (minutes % 60 === 0) return t('schedule.repeat.everyHours', { count: minutes / 60 })
    return t('schedule.repeat.everyMinutes', { count: minutes })
  }
  const choice = repeatFromSchedule(repeat)
  if (choice.preset === 'weekdays') return t('schedule.repeat.weekdaysAt', { time: choice.time })
  if (choice.preset === 'daily') return t('schedule.repeat.dailyAt', { time: choice.time })
  if (choice.preset === 'weekly') {
    return t('schedule.repeat.weeklyAt', { day: weekdayName(choice.weekday, language), time: choice.time })
  }
  return t('schedule.repeat.cron', { cron: repeat.cron })
}
