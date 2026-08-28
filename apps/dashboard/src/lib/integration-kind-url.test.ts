import { describe, expect, it } from 'vitest'
import { parseKindFilter, parseStatusFilter } from './integration-kind-url'

describe('parseKindFilter', () => {
  it('accepts known kinds and defaults to all', () => {
    expect(parseKindFilter('mcp')).toBe('mcp')
    expect(parseKindFilter('nope')).toBe('all')
  })
})

describe('parseStatusFilter', () => {
  it('defaults to available so coming-soon cards stay off the first view', () => {
    expect(parseStatusFilter(null)).toBe('available')
    expect(parseStatusFilter('available')).toBe('available')
    expect(parseStatusFilter('connected')).toBe('connected')
    expect(parseStatusFilter('all')).toBe('all')
  })
})
