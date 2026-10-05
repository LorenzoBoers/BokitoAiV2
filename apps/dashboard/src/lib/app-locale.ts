/** Map the in-app UI language to an Intl locale (not the browser language). */
export function appDateLocale(language?: string | null): string | undefined {
  const raw = (language ?? '').toLowerCase()
  if (raw.startsWith('nl')) return 'nl-NL'
  if (raw.startsWith('en')) return 'en-US'
  return raw || undefined
}

export function formatAppTime(date: Date, language?: string | null): string {
  return date.toLocaleTimeString(appDateLocale(language), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function formatAppDate(
  date: Date,
  language?: string | null,
  options: Intl.DateTimeFormatOptions = { weekday: 'short' },
): string {
  return date.toLocaleDateString(appDateLocale(language), options)
}

/** Compact axis/tooltip day: `wo 7 okt` / `Wed 7 Oct`. */
export function formatAppWeekdayDayMonth(date: Date, language?: string | null): string {
  const locale = appDateLocale(language)
  const weekday = date.toLocaleDateString(locale, { weekday: 'short' }).replace(/\.$/, '')
  const day = date.toLocaleDateString(locale, { day: 'numeric' })
  const month = date.toLocaleDateString(locale, { month: 'short' }).replace(/\.$/, '')
  return `${weekday} ${day} ${month}`
}

export function formatAppDateTime(date: Date, language?: string | null): string {
  return date.toLocaleString(appDateLocale(language), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** Compact weekday + date + time for upcoming agenda rows. */
export function formatAppWeekdayDateTime(date: Date, language?: string | null): string {
  return date.toLocaleString(appDateLocale(language), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}
