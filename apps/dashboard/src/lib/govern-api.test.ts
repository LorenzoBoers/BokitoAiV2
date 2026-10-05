import { describe, expect, it } from 'vitest'
import { normalizeAutonomyScopeLevel } from './govern-api'

describe('normalizeAutonomyScopeLevel', () => {
  it('keeps the operator dialect', () => {
    expect(normalizeAutonomyScopeLevel('manual')).toBe('manual')
    expect(normalizeAutonomyScopeLevel('assisted')).toBe('assisted')
    expect(normalizeAutonomyScopeLevel('autonomous')).toBe('autonomous')
  })

  it('maps legacy Govern words', () => {
    expect(normalizeAutonomyScopeLevel('approval')).toBe('assisted')
    expect(normalizeAutonomyScopeLevel('auto')).toBe('autonomous')
    expect(normalizeAutonomyScopeLevel('')).toBe('assisted')
  })
})
