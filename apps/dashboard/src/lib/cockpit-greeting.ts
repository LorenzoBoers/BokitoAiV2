export type GreetingBucket = 'morning' | 'afternoon' | 'evening'

/** First word of a display name, or empty when missing. */
export function firstName(full?: string | null): string {
  const raw = (full ?? '').trim()
  if (!raw) return ''
  return raw.split(/\s+/)[0] ?? ''
}

/** Office-hours greeting for the cockpit header. */
export function greetingBucket(now: Date = new Date()): GreetingBucket {
  const hour = now.getHours()
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}
