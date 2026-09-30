export function relativeTime(iso: string | null | undefined, locale = 'en', now = Date.now()): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  const diff = Math.round((then - now) / 1000)
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (abs < 60) return rtf.format(diff, 'second')
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 86400 * 14) return rtf.format(Math.round(diff / 86400), 'day')
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}

export function dateTime(iso: string | null | undefined, locale = 'en'): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function eur(value: number | null | undefined, locale = 'en', digits = 2): string {
  const v = Number(value ?? 0)
  return new Intl.NumberFormat(locale === 'nl' ? 'nl-NL' : 'en-IE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: digits,
    maximumFractionDigits: Math.max(digits, v > 0 && v < 0.01 ? 4 : digits),
  }).format(v)
}

export function percent(value: number | null | undefined, digits = 0): string {
  return `${(Number(value ?? 0) * 100).toFixed(digits)}%`
}

export function initials(name: string | null | undefined, fallback = '?'): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return fallback
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}

export function truncate(text: string, max = 120): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}
