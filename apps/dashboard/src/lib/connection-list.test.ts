import { describe, expect, it } from 'vitest'
import {
  filterConnectionItems,
  groupConnectionItems,
  type ConnectionListItem,
} from './connection-list'
import type { ResolvedIntegrationBrand } from './integration-brand'

const brand = (name: string): ResolvedIntegrationBrand => ({
  name,
  initials: name.slice(0, 2).toUpperCase(),
  color: '#111',
  logoUrl: null,
  logoDarkUrl: null,
  hostSlug: name.toLowerCase(),
})

function item(partial: Partial<ConnectionListItem> & Pick<ConnectionListItem, 'id' | 'kind' | 'programKey'>): ConnectionListItem {
  return {
    programName: partial.programKey,
    title: partial.id,
    subtitle: null,
    brand: brand(partial.programKey),
    attachedModules: [],
    eligibleModule: null,
    source: 'app',
    connectionId: partial.id,
    ...partial,
  }
}

describe('groupConnectionItems', () => {
  it('groups by kind then program, with code last', () => {
    const groups = groupConnectionItems([
      item({ id: 'gh-1', kind: 'repository', programKey: 'github' }),
      item({ id: 'mb-2', kind: 'app', programKey: 'moneybird', programName: 'Moneybird' }),
      item({ id: 'mb-1', kind: 'app', programKey: 'moneybird', programName: 'Moneybird' }),
      item({ id: 'ms-1', kind: 'inbox', programKey: 'microsoft', programName: 'Microsoft 365' }),
    ])

    expect(groups.map((g) => g.kind)).toEqual(['inbox', 'app', 'repository'])
    expect(groups[1].programs[0].items.map((row) => row.id)).toEqual(['mb-2', 'mb-1'])
  })
})

describe('filterConnectionItems', () => {
  it('matches program or title', () => {
    const rows = [
      item({ id: 'a', kind: 'app', programKey: 'moneybird', programName: 'Moneybird', title: 'Kantoor' }),
      item({ id: 'b', kind: 'mcp', programKey: 'slack', programName: 'Slack', title: 'Ops' }),
    ]
    expect(filterConnectionItems(rows, 'money').map((r) => r.id)).toEqual(['a'])
    expect(filterConnectionItems(rows, 'ops').map((r) => r.id)).toEqual(['b'])
  })
})
