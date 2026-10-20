import { describe, expect, it } from 'vitest'
import {
  parseServerTime,
  quickMomentDate,
  repeatFromSchedule,
  repeatToSchedule,
  surfaceBeforeFor,
} from './thread-schedule'

describe('quickMomentDate', () => {
  // Wednesday 21 October 2026, 14:07 local time.
  const now = new Date(2026, 9, 21, 14, 7)

  it('rounds in an hour up to five minutes', () => {
    expect(quickMomentDate('hour', now)).toEqual(new Date(2026, 9, 21, 15, 10))
  })

  it('picks tomorrow and next Monday at 9:00', () => {
    expect(quickMomentDate('tomorrow', now)).toEqual(new Date(2026, 9, 22, 9, 0))
    expect(quickMomentDate('monday', now)).toEqual(new Date(2026, 9, 26, 9, 0))
    expect(quickMomentDate('monday', new Date(2026, 9, 26, 8, 0))).toEqual(new Date(2026, 10, 2, 9, 0))
  })
})

describe('surfaceBeforeFor', () => {
  it('maps a stored snooze back to its lead time', () => {
    expect(surfaceBeforeFor('2026-10-22T09:00:00Z', '2026-10-22T08:00:00Z')).toBe(60)
    expect(surfaceBeforeFor('2026-10-22T09:00:00Z', '2026-10-22T09:00:00Z')).toBe(0)
    expect(surfaceBeforeFor('2026-10-22T09:00:00Z', null)).toBe(0)
  })
})

describe('parseServerTime', () => {
  it('reads naive server timestamps as UTC', () => {
    expect(parseServerTime('2026-10-12T07:00:00')?.toISOString()).toBe('2026-10-12T07:00:00.000Z')
    expect(parseServerTime('2026-10-12T07:00:00+00:00')?.toISOString()).toBe('2026-10-12T07:00:00.000Z')
    expect(parseServerTime(null)).toBeNull()
  })
})

describe('repeat presets', () => {
  it('round-trips local presets through UTC cron', () => {
    for (const preset of ['weekdays', 'daily'] as const) {
      const { cron } = repeatToSchedule({ preset, time: '09:00', weekday: 1, cron: '' })
      const back = repeatFromSchedule({ kind: 'cron', cron: cron! })
      expect(back.preset).toBe(preset)
      expect(back.time).toBe('09:00')
    }
    const weekly = repeatToSchedule({ preset: 'weekly', time: '08:30', weekday: 3, cron: '' })
    const back = repeatFromSchedule({ kind: 'cron', cron: weekly.cron! })
    expect(back).toMatchObject({ preset: 'weekly', time: '08:30', weekday: 3 })
  })

  it('maps hourly to an interval and keeps unknown cron as custom', () => {
    expect(repeatToSchedule({ preset: 'hourly', time: '09:00', weekday: 1, cron: '' })).toEqual({
      cron: null,
      everyMinutes: 60,
    })
    expect(repeatFromSchedule({ kind: 'cron', cron: '*/15 * * * *' }).preset).toBe('custom')
  })
})
