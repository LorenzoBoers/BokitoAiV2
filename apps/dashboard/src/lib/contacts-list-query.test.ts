import { describe, expect, it } from 'vitest'
import { parseContactsStatus, withContactsParam } from './contacts-list-query'

describe('contacts list query', () => {
  it('keeps only real status values', () => {
    expect(parseContactsStatus('pending')).toBe('pending')
    expect(parseContactsStatus('nope')).toBe('all')
  })

  it('drops all and writes the chosen filter', () => {
    const base = new URLSearchParams('q=ada')
    expect(withContactsParam(base, 'status', 'all').toString()).toBe('q=ada')
    expect(withContactsParam(base, 'status', 'pending').get('status')).toBe('pending')
  })
})