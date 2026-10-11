import { describe, expect, it } from 'vitest'
import {
  connectionsPathWithKind,
  legacyModulesPath,
  parseKindFilter,
} from './integration-kind-url'

describe('parseKindFilter', () => {
  it('accepts known kinds and defaults to all', () => {
    expect(parseKindFilter('mcp')).toBe('mcp')
    expect(parseKindFilter('app')).toBe('app')
    expect(parseKindFilter('modules')).toBe('modules')
    expect(parseKindFilter('ai_tools')).toBe('ai_tools')
    expect(parseKindFilter('nope')).toBe('all')
    expect(parseKindFilter(null)).toBe('all')
  })
})

describe('connectionsPathWithKind', () => {
  it('builds paths under /connections with the kind in the URL only', () => {
    expect(connectionsPathWithKind('all')).toBe('/connections')
    expect(connectionsPathWithKind('mcp')).toBe('/connections?kind=mcp')
    expect(connectionsPathWithKind('modules')).toBe('/connections?kind=modules')
  })
})

describe('legacyModulesPath', () => {
  it('lands every legacy hub path on /connections', () => {
    expect(legacyModulesPath('/modules')).toBe('/connections')
    expect(legacyModulesPath('/modules/connected')).toBe('/connections')
    expect(legacyModulesPath('/modules/tools')).toBe('/connections')
    expect(legacyModulesPath('/modules/marketplace')).toBe('/connections')
    expect(legacyModulesPath('/connections/connected')).toBe('/connections')
    expect(legacyModulesPath('/connections/tools')).toBe('/connections')
    expect(legacyModulesPath('/connections/marketplace')).toBe('/connections')
  })

  it('handles the older Settings-nested paths too', () => {
    expect(legacyModulesPath('/settings/modules')).toBe('/connections')
    expect(legacyModulesPath('/settings/modules/accounting')).toBe('/connections/accounting')
  })
})
