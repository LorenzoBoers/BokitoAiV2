import { describe, expect, it } from 'vitest'

import { eur, initials, percent, relativeTime, truncate } from './format'

describe('format helpers', () => {
  it('formats euro amounts, with extra precision for sub-cent costs', () => {
    expect(eur(12.5, 'en')).toBe('€12.50')
    expect(eur(0.0042, 'en')).toBe('€0.0042')
    expect(eur(null)).toBe('€0.00')
    expect(eur(1234.5, 'nl')).toContain('1.234,50')
  })

  it('formats percentages from fractions', () => {
    expect(percent(0.4267)).toBe('43%')
    expect(percent(0.5, 1)).toBe('50.0%')
    expect(percent(undefined)).toBe('0%')
  })

  it('builds initials from up to two words', () => {
    expect(initials('Ada Lovelace')).toBe('AL')
    expect(initials('bokito')).toBe('B')
    expect(initials('  ')).toBe('?')
    expect(initials(null, 'A')).toBe('A')
  })

  it('truncates and collapses whitespace', () => {
    expect(truncate('a   b\n c')).toBe('a b c')
    expect(truncate('x'.repeat(200), 10)).toHaveLength(10)
  })

  it('renders relative time relative to a fixed clock', () => {
    const now = Date.parse('2026-09-30T12:00:00Z')
    expect(relativeTime('2026-09-30T11:59:30Z', 'en', now)).toBe('30 seconds ago')
    expect(relativeTime('2026-09-30T09:00:00Z', 'en', now)).toBe('3 hours ago')
    expect(relativeTime('2026-09-29T12:00:00Z', 'en', now)).toBe('yesterday')
    expect(relativeTime(null)).toBe('')
  })
})
