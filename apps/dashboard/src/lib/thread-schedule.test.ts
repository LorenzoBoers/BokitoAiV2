import { describe, expect, it } from 'vitest'
import { parseServerTime, repeatFromSchedule, repeatToSchedule } from './thread-schedule'

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
