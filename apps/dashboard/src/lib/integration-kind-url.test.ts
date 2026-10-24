import { describe, expect, it } from 'vitest'
import {
  CONNECTIONS_INSTALLED_PATH,
  connectionsInstalledPath,
  connectionsPathWithKind,
  legacyModulesPath,
  parseConnectionsView,
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

describe('connectionsInstalledPath', () => {
  it('keeps list view and filters in the URL', () => {
    expect(connectionsInstalledPath()).toBe(CONNECTIONS_INSTALLED_PATH)
    expect(connectionsInstalledPath({ view: 'list', kind: 'app', q: 'king' })).toBe(
      '/connections/installed?kind=app&q=king&view=list',
    )
  })
})

describe('parseConnectionsView', () => {
  it('defaults to cards', () => {
    expect(parseConnectionsView(null)).toBe('cards')
    expect(parseConnectionsView('list')).toBe('list')
    expect(parseConnectionsView('cards')).toBe('cards')
  })
})

describe('legacyModulesPath', () => {
  it('lands Discover leaves on /connections and Connected on Installed', () => {
    expect(legacyModulesPath('/modules')).toBe('/connections')
    expect(legacyModulesPath('/modules/connected')).toBe('/connections/installed')
    expect(legacyModulesPath('/modules/tools')).toBe('/connections')
    expect(legacyModulesPath('/modules/marketplace')).toBe('/connections')
    expect(legacyModulesPath('/connections/connected')).toBe('/connections/installed')
    expect(legacyModulesPath('/connections/tools')).toBe('/connections')
    expect(legacyModulesPath('/connections/marketplace')).toBe('/connections')
  })

  it('handles the older Settings-nested paths too', () => {
    expect(legacyModulesPath('/settings/modules')).toBe('/connections')
    expect(legacyModulesPath('/settings/modules/accounting')).toBe('/connections/accounting')
  })
})
