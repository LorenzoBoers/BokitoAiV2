import { describe, expect, it } from 'vitest'
import { firstName, greetingBucket } from './cockpit-greeting'

describe('firstName', () => {
  it('returns the first word', () => {
    expect(firstName('Jane Doe')).toBe('Jane')
    expect(firstName('  Sam  ')).toBe('Sam')
  })

  it('returns empty when missing', () => {
    expect(firstName('')).toBe('')
    expect(firstName(null)).toBe('')
    expect(firstName(undefined)).toBe('')
  })
})

describe('greetingBucket', () => {
  it('splits the day into morning, afternoon, evening', () => {
    expect(greetingBucket(new Date('2026-08-27T08:00:00'))).toBe('morning')
    expect(greetingBucket(new Date('2026-08-27T14:30:00'))).toBe('afternoon')
    expect(greetingBucket(new Date('2026-08-27T19:00:00'))).toBe('evening')
  })
})
