import { describe, expect, it } from 'vitest'
import {
  buildInstalledConnectionRows,
  filterInstalledConnections,
  groupInstalledByProgram,
} from './installed-connections'

describe('buildInstalledConnectionRows', () => {
  it('keeps two administrations of the same host as separate rows', () => {
    const rows = buildInstalledConnectionRows({
      connections: [
        {
          id: 'k1',
          tenant_id: 't',
          provider: 'king_accountancy',
          provider_id: 'king',
          external_account_id: 'adm-1',
          display_name: 'King Admin A',
          instance_key: 'adm-1',
          status: 'active',
          kind: 'app',
          attached_modules: ['accounting'],
          eligible_module: 'accounting',
        },
        {
          id: 'k2',
          tenant_id: 't',
          provider: 'king_accountancy',
          provider_id: 'king',
          external_account_id: 'adm-2',
          display_name: 'King Admin B',
          instance_key: 'adm-2',
          status: 'active',
          kind: 'app',
          attached_modules: ['accounting'],
          eligible_module: 'accounting',
        },
      ],
      mcpRows: [],
      calendarRows: [],
      github: [],
      mailboxes: [],
    })

    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.title)).toEqual(['King Admin A', 'King Admin B'])
    expect(groupInstalledByProgram(rows)[0].items).toHaveLength(2)
  })
})

describe('filterInstalledConnections', () => {
  it('filters by kind and query', () => {
    const rows = buildInstalledConnectionRows({
      connections: [
        {
          id: '1',
          tenant_id: 't',
          provider: 'slack_mcp',
          provider_id: 'slack',
          external_account_id: 'x',
          display_name: 'Ops Slack',
          status: 'active',
          kind: 'mcp',
          attached_modules: [],
          eligible_module: null,
        },
      ],
      mcpRows: [],
      calendarRows: [],
      github: [],
      mailboxes: [],
    })
    expect(filterInstalledConnections(rows, { kind: 'app' })).toHaveLength(0)
    expect(filterInstalledConnections(rows, { query: 'ops' })).toHaveLength(1)
  })
})
