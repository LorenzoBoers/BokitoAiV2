import { describe, expect, it } from 'vitest'
import { parseContactsAiHandling, parseContactsStatus, withContactsParam } from './contacts-list-query'

describe('contacts list query', () => {
  it('keeps only real status and AI handling values', () => {
    expect(parseContactsStatus('pending')).toBe('pending')
    expect(parseContactsStatus('nope')).toBe('all')
    expect(parseContactsAiHandling('assisted')).toBe('assisted')
    expect(parseContactsAiHandling('custom')).toBe('custom')
    expect(parseContactsAiHandling('')).toBe('all')
  })

  it('drops all and writes the chosen filter', () => {
    const base = new URLSearchParams('q=ada')
    expect(withContactsParam(base, 'status', 'all').toString()).toBe('q=ada')
    expect(withContactsParam(base, 'ai_handling', 'manual').get('ai_handling')).toBe('manual')
  })
})