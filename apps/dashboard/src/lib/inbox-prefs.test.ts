import { describe, expect, it } from 'vitest'
import { looksLikeThreadQuery } from './inbox-prefs'

describe('looksLikeThreadQuery', () => {
  it('matches numeric ids at length 1', () => {
    expect(looksLikeThreadQuery('8')).toBe(true)
    expect(looksLikeThreadQuery('42')).toBe(true)
  })

  it('matches UUID prefixes', () => {
    expect(looksLikeThreadQuery('8de46526')).toBe(true)
    expect(looksLikeThreadQuery('8de46526-ef30-4a41-b0b5-562e07b90881')).toBe(true)
  })

  it('rejects short words', () => {
    expect(looksLikeThreadQuery('a')).toBe(false)
    expect(looksLikeThreadQuery('hi')).toBe(false)
    expect(looksLikeThreadQuery('')).toBe(false)
  })
})
