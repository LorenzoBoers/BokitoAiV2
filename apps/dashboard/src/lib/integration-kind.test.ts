import { describe, expect, it } from 'vitest'
import { getManagePath, resolveIntegrationKind } from './integration-kind'

describe('resolveIntegrationKind', () => {
  it('keeps native accounting off the MCP lane', () => {
    expect(resolveIntegrationKind('moneybird', { accounting: true })).toBe('app')
    expect(resolveIntegrationKind('exact_online')).toBe('app')
    expect(resolveIntegrationKind('google_drive')).toBe('app')
    expect(resolveIntegrationKind('tink')).toBe('app')
  })

  it('maps documents and calendar from capabilities without slug allowlists', () => {
    expect(resolveIntegrationKind('dropbox', { documents: true })).toBe('app')
    expect(resolveIntegrationKind('any_drive_vendor', { documents: true })).toBe('app')
    expect(resolveIntegrationKind('outlook_calendar', { calendar: true })).toBe('calendar')
    expect(resolveIntegrationKind('dropbox_mcp', { mcp_tools: true })).toBe('mcp')
  })

  it('keeps KING and custom tools on MCP', () => {
    expect(resolveIntegrationKind('king_accountancy', { mcp_tools: true, accounting: true })).toBe(
      'mcp',
    )
    expect(resolveIntegrationKind('custom_mcp')).toBe('mcp')
    expect(resolveIntegrationKind('moneybird_mcp')).toBe('mcp')
    expect(resolveIntegrationKind('twinfield_mcp')).toBe('mcp')
  })
})

describe('getManagePath', () => {
  it('sends Moneybird manage to Connections, not tools', () => {
    expect(getManagePath('app')).toBe('/connections?kind=app')
    expect(getManagePath('mcp')).toBe('/connections?kind=mcp')
  })
})
