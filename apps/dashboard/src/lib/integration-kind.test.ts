import { describe, expect, it } from 'vitest'
import { getManagePath, resolveIntegrationKind } from './integration-kind'

describe('resolveIntegrationKind', () => {
  it('keeps native accounting off the MCP lane', () => {
    expect(resolveIntegrationKind('moneybird', { accounting: true })).toBe('app')
    expect(resolveIntegrationKind('exact_online')).toBe('app')
    expect(resolveIntegrationKind('snelstart')).toBe('app')
  })

  it('keeps KING and custom tools on MCP', () => {
    expect(resolveIntegrationKind('king_accountancy', { mcp_tools: true })).toBe('mcp')
    expect(resolveIntegrationKind('custom_mcp')).toBe('mcp')
  })
})

describe('getManagePath', () => {
  it('sends Moneybird manage to Connections, not tools', () => {
    expect(getManagePath('app')).toBe('/modules/connected?kind=app')
    expect(getManagePath('mcp')).toBe('/modules/connected?kind=mcp')
  })
})
