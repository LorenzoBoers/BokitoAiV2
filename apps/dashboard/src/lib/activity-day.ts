export type DayBucket = 'today' | 'yesterday' | 'older'

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function activityDayBucket(iso: string, now: Date = new Date()): DayBucket {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return 'older'
  const today = startOfDay(now)
  const that = startOfDay(at)
  const dayMs = 86_400_000
  if (that === today) return 'today'
  if (that === today - dayMs) return 'yesterday'
  return 'older'
}
