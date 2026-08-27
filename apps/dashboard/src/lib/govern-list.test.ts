import { describe, expect, it } from 'vitest'
import { governHaystack, matchesGovernText } from './govern-list'

describe('govern list filter', () => {
  it('matches case-insensitively and ignores empty queries', () => {
    expect(matchesGovernText('Update inbox AI', '')).toBe(true)
    expect(matchesGovernText('Update inbox AI', 'INBOX')).toBe(true)
    expect(matchesGovernText('Update inbox AI', 'govern')).toBe(false)
  })

  it('joins haystack parts', () => {
    expect(governHaystack(['draft', null, 'agent'])).toBe('draft agent')
  })
})
