import { describe, expect, it } from 'vitest'
import { formatAppNumber, formatAppUsdCents } from './app-number'

describe('app number format', () => {
  it('formats with the in-app locale', () => {
    expect(formatAppNumber(1234.5, 'en')).toMatch(/1,234/)
    const nl = formatAppNumber(1234.5, 'nl').replace(/\s/g, '')
    expect(nl.includes('234')).toBe(true)
    expect(nl).not.toBe(formatAppNumber(1234.5, 'en'))
  })

  it('formats USD cents', () => {
    expect(formatAppUsdCents(199, 'en')).toBe('$1.99')
  })
})
