import { describe, expect, it } from 'vitest'
import {
  connectedPathWithKind,
  legacyModulesPath,
  marketplacePathWithKind,
  parseKindFilter,
} from './integration-kind-url'

describe('parseKindFilter', () => {
  it('accepts known kinds and defaults to all', () => {
    expect(parseKindFilter('mcp')).toBe('mcp')
    expect(parseKindFilter('app')).toBe('app')
    expect(parseKindFilter('nope')).toBe('all')
  })
})

describe('hub paths', () => {
  it('builds hub paths under /connections', () => {
    expect(connectedPathWithKind('all')).toBe('/connections')
    expect(connectedPathWithKind('mcp')).toBe('/connections?kind=mcp')
    expect(marketplacePathWithKind('all')).toBe('/connections/marketplace')
    expect(marketplacePathWithKind('app')).toBe('/connections/marketplace?kind=app')
  })
})

describe('legacyModulesPath', () => {
  it('lands every legacy hub path on its /connections twin', () => {
    expect(legacyModulesPath('/modules')).toBe('/connections')
    expect(legacyModulesPath('/modules/connected')).toBe('/connections')
    expect(legacyModulesPath('/modules/tools')).toBe('/connections')
    expect(legacyModulesPath('/modules/marketplace')).toBe('/connections/marketplace')
    expect(legacyModulesPath('/connections/connected')).toBe('/connections')
    expect(legacyModulesPath('/connections/tools')).toBe('/connections')
  })

  it('handles the older Settings-nested paths too', () => {
    expect(legacyModulesPath('/settings/modules')).toBe('/connections')
    expect(legacyModulesPath('/settings/modules/accounting')).toBe('/connections/accounting')
  })
})

