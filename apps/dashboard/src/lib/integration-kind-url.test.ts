import { describe, expect, it } from 'vitest'
import { parseKindFilter, parseStatusFilter } from './integration-kind-url'

describe('parseKindFilter', () => {
  it('accepts known kinds and defaults to all', () => {
    expect(parseKindFilter('mcp')).toBe('mcp')
    expect(parseKindFilter('nope')).toBe('all')
  })
})

describe('parseStatusFilter', () => {
  it('accepts connected and available', () => {
    expect(parseStatusFilter('connected')).toBe('connected')
    expect(parseStatusFilter('available')).toBe('available')
    expect(parseStatusFilter(null)).toBe('all')
  })
})
