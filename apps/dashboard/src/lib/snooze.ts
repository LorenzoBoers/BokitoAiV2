import { formatAppDate, formatAppTime } from './app-locale'

/** Shared snooze duration presets for the inbox (composer + thread menu).
 *
 * Presets resolve to minutes-from-now; `null` means "until the customer
 * replies" (pending without a wake time).
 */

export type SnoozePreset = {
  key: string
  labelKey: string
  /** Minutes from now, or null for "until reply". */
  minutes: () => number | null
}

function minutesUntil(target: Date): number {
  return Math.max(1, Math.round((target.getTime() - Date.now()) / 60_000))
}

function tomorrowMorning(): Date {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d
}

function nextMondayMorning(): Date {
  const d = new Date()
  const day = d.getDay() // 0 = Sunday
  const daysUntilMonday = ((8 - day) % 7) || 7
  d.setDate(d.getDate() + daysUntilMonday)
  d.setHours(9, 0, 0, 0)
  return d
}

export const SNOOZE_PRESETS: readonly SnoozePreset[] = [
  { key: '1h', labelKey: 'snooze.1h', minutes: () => 60 },
  { key: '4h', labelKey: 'snooze.4h', minutes: () => 240 },
  { key: 'tomorrow', labelKey: 'snooze.tomorrow', minutes: () => minutesUntil(tomorrowMorning()) },
  { key: 'next-week', labelKey: 'snooze.nextWeek', minutes: () => minutesUntil(nextMondayMorning()) },
  { key: 'until-reply', labelKey: 'snooze.untilReply', minutes: () => null },
]

/** ISO wake time for a preset, or null for "until reply". */
export function snoozeUntilIso(preset: SnoozePreset): string | null {
  const minutes = preset.minutes()
  if (minutes == null) return null
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

type WakeTranslate = (key: string, opts?: Record<string, string>) => string

/** Compact human label for a wake time (e.g. "Wakes tomorrow 09:00"). */
export function formatWakeTime(
  iso: string | null | undefined,
  t?: WakeTranslate,
  language?: string | null,
): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  const isTomorrow = date.toDateString() === tomorrow.toDateString()
  const time = formatAppTime(date, language)
  const dateLabel = formatAppDate(date, language, { month: 'short', day: 'numeric' })
  if (sameDay) return t ? t('snooze.wakesToday', { time }) : `Wakes today ${time}`
  if (isTomorrow) return t ? t('snooze.wakesTomorrow', { time }) : `Wakes tomorrow ${time}`
  return t ? t('snooze.wakesOn', { date: dateLabel, time }) : `Wakes ${dateLabel} ${time}`
}
