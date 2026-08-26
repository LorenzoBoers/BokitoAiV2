import { describe, expect, it } from 'vitest'
import { formatWakeTime, SNOOZE_PRESETS, snoozeUntilIso } from './snooze'

describe('snooze presets', () => {
  it('exposes timed and until-reply options', () => {
    expect(SNOOZE_PRESETS.map((preset) => preset.key)).toEqual([
      '1h',
      '4h',
      'tomorrow',
      'next-week',
      'until-reply',
    ])
    const untilReply = SNOOZE_PRESETS.find((preset) => preset.key === 'until-reply')
    expect(untilReply?.minutes()).toBeNull()
    expect(snoozeUntilIso(untilReply!)).toBeNull()
  })

  it('formats a wake time for today, tomorrow, and later', () => {
    const now = new Date()
    const today = new Date(now)
    today.setHours(18, 30, 0, 0)
    const tomorrow = new Date(now)
    tomorrow.setDate(now.getDate() + 1)
    tomorrow.setHours(9, 0, 0, 0)
    const later = new Date(now)
    later.setDate(now.getDate() + 5)
    later.setHours(9, 0, 0, 0)

    expect(formatWakeTime(today.toISOString())).toMatch(/^Wakes today /)
    expect(formatWakeTime(tomorrow.toISOString())).toMatch(/^Wakes tomorrow /)
    expect(formatWakeTime(later.toISOString())).toMatch(/^Wakes /)
    expect(formatWakeTime(null)).toBeNull()
  })
})
