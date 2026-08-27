import { describe, expect, it } from 'vitest'
import { clampWeekOffset, parseWeekOffset, weekOffsetParam } from './agenda-week'

describe('agenda week offset', () => {
  it('parses a bounded week offset', () => {
    expect(parseWeekOffset(null)).toBe(0)
    expect(parseWeekOffset('2')).toBe(2)
    expect(parseWeekOffset('-1')).toBe(-1)
    expect(parseWeekOffset('99')).toBe(0)
    expect(parseWeekOffset('nope')).toBe(0)
  })

  it('clamps live week navigation', () => {
    expect(clampWeekOffset(3)).toBe(3)
    expect(clampWeekOffset(99)).toBe(52)
    expect(clampWeekOffset(-80)).toBe(-52)
  })

  it('omits the current week from the URL', () => {
    expect(weekOffsetParam(0)).toBeNull()
    expect(weekOffsetParam(1)).toBe('1')
  })
})
