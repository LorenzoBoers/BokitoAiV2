import { describe, expect, it } from 'vitest'
import { activityDayBucket } from './activity-day'

describe('activityDayBucket', () => {
  const now = new Date('2026-08-27T15:00:00')

  it('groups today, yesterday, and older', () => {
    expect(activityDayBucket('2026-08-27T09:00:00', now)).toBe('today')
    expect(activityDayBucket('2026-08-26T22:00:00', now)).toBe('yesterday')
    expect(activityDayBucket('2026-08-20T12:00:00', now)).toBe('older')
  })

  it('treats invalid dates as older', () => {
    expect(activityDayBucket('not-a-date', now)).toBe('older')
  })
})
