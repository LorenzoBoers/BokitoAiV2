import { describe, expect, it } from 'vitest'
import { isLikelyEmail } from './invite-email'

describe('isLikelyEmail', () => {
  it('accepts ordinary work addresses', () => {
    expect(isLikelyEmail('name@company.com')).toBe(true)
    expect(isLikelyEmail('  jane.doe+ops@acme.nl  ')).toBe(true)
  })

  it('rejects empty, spaces, and incomplete values', () => {
    expect(isLikelyEmail('')).toBe(false)
    expect(isLikelyEmail('not-an-email')).toBe(false)
    expect(isLikelyEmail('name@company')).toBe(false)
    expect(isLikelyEmail('name @company.com')).toBe(false)
  })
})
