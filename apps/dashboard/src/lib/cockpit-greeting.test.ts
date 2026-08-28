import { describe, expect, it } from 'vitest'
import { firstName, greetingBucket, greetingFirstName } from './cockpit-greeting'

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

describe('greetingFirstName', () => {
  it('skips the product or organisation first name', () => {
    expect(greetingFirstName('Bokito Admin')).toBe('')
    expect(greetingFirstName('Bokito Admin', 'Bokito')).toBe('')
    expect(greetingFirstName('Anouk de Vries', 'Bokito')).toBe('Anouk')
  })
})

describe('greetingBucket', () => {
  it('splits the day into morning, afternoon, evening', () => {
    expect(greetingBucket(new Date('2026-08-27T08:00:00'))).toBe('morning')
    expect(greetingBucket(new Date('2026-08-27T14:30:00'))).toBe('afternoon')
    expect(greetingBucket(new Date('2026-08-27T19:00:00'))).toBe('evening')
  })
})
