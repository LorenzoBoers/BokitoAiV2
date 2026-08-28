import { describe, expect, it } from 'vitest'
import { getEmailInitials, getInitials } from './avatar'

describe('getInitials', () => {
  it('takes first + last word initials', () => {
    expect(getInitials('Sanne de Vries')).toBe('SV')
  })

  it('uses two characters for single-word names', () => {
    expect(getInitials('Prospect')).toBe('PR')
  })

  it('falls back to ? when empty', () => {
    expect(getInitials('')).toBe('?')
    expect(getInitials(null)).toBe('?')
  })
})

describe('getEmailInitials', () => {
  it('splits the local part on separators', () => {
    expect(getEmailInitials('john.doe@example.com')).toBe('JD')
    expect(getEmailInitials('anna-maria_van+iets@x.nl')).toBe('AI')
  })

  it('uses first two characters for plain local parts', () => {
    expect(getEmailInitials('support@example.com')).toBe('SU')
  })

  it('returns empty for unusable input', () => {
    expect(getEmailInitials('')).toBe('')
    expect(getEmailInitials(null)).toBe('')
    expect(getEmailInitials('@nolocal.com')).toBe('')
  })
})
