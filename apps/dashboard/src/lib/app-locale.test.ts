import { describe, expect, it } from 'vitest'
import { appDateLocale, formatAppTime, formatAppWeekdayDateTime } from './app-locale'

describe('appDateLocale', () => {
  it('uses the in-app language instead of the browser', () => {
    expect(appDateLocale('nl')).toBe('nl-NL')
    expect(appDateLocale('nl-NL')).toBe('nl-NL')
    expect(appDateLocale('en')).toBe('en-US')
    expect(appDateLocale('')).toBeUndefined()
  })

  it('formats Dutch times in 24-hour clock', () => {
    const date = new Date('2026-08-26T14:57:00')
    expect(formatAppTime(date, 'nl')).toMatch(/14:57/)
  })

  it('formats upcoming agenda rows in the workspace language', () => {
    const date = new Date('2026-08-26T14:57:00')
    const nl = formatAppWeekdayDateTime(date, 'nl')
    expect(nl.toLowerCase()).toMatch(/wo|wed/)
    expect(nl).toMatch(/26/)
    expect(nl).toMatch(/14:57/)
    expect(nl).not.toMatch(/PM/)
  })
})
