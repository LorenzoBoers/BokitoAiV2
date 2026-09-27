import { describe, expect, it } from 'vitest'
import { resolveSetupConfig } from './integration-setup'
import type { Integration } from '../data/integrations-data'
import type { IntegrationProviderRow } from './integrations-api'

const baseIntegration: Integration = {
  id: 'acme_live_mcp',
  name: 'Acme',
  description: 'Test',
  category: 'Productivity',
  status: 'available',
  kind: 'mcp',
  color: '#111',
  initials: 'AC',
}

describe('resolveSetupConfig for Alpaca Connect flip', () => {
  it('keeps api_key when catalog auth_type is api_key', () => {
    const config = resolveSetupConfig(
      {
        id: 'alpaca_mcp',
        name: 'Alpaca',
        description: '',
        category: 'tools',
        status: 'available',
        kind: 'mcp',
      } as any,
      {
        id: 'p1',
        slug: 'alpaca_mcp',
        name: 'Alpaca',
        description: '',
        category: 'Investeren',
        auth_type: 'api_key',
        status: 'available',
        capabilities: { mcp_tools: true, auth_modes: ['api_key', 'oauth2'] },
      },
    )
    expect(config.mode).toBe('api_key')
    expect(config.mcpPreset).toBe('alpaca_mcp')
  })

  it('switches to oauth2 when catalog auth_type is oauth2', () => {
    const config = resolveSetupConfig(
      {
        id: 'alpaca_mcp',
        name: 'Alpaca',
        description: '',
        category: 'tools',
        status: 'available',
        kind: 'mcp',
      } as any,
      {
        id: 'p1',
        slug: 'alpaca_mcp',
        name: 'Alpaca',
        description: '',
        category: 'Investeren',
        auth_type: 'oauth2',
        status: 'available',
        capabilities: { mcp_tools: true, auth_modes: ['api_key', 'oauth2'] },
      },
    )
    expect(config.mode).toBe('oauth2')
  })
})

describe('resolveSetupConfig for API-only remotes', () => {
  it('uses remote_mcp_oauth from provider auth_type without static registry', () => {
    const provider: IntegrationProviderRow = {
      id: 'x',
      slug: 'acme_live_mcp',
      name: 'Acme',
      description: '',
      category: 'Productivity',
      auth_type: 'mcp_remote_oauth',
      status: 'available',
      capabilities: { mcp_tools: true },
      mcp_remote_url: 'https://mcp.acme.test/mcp',
    }
    const config = resolveSetupConfig(baseIntegration, provider)
    expect(config.mode).toBe('remote_mcp_oauth')
    expect(config.platformSlug).toBe('acme_live_mcp')
  })

  it('prefills custom MCP install for api_key remotes with URL', () => {
    const provider: IntegrationProviderRow = {
      id: 'y',
      slug: 'acme_key_mcp',
      name: 'Acme Key',
      description: '',
      category: 'Productivity',
      auth_type: 'api_key',
      status: 'available',
      capabilities: { mcp_tools: true },
      mcp_remote_url: 'https://mcp.acme.test/key',
    }
    const config = resolveSetupConfig(
      { ...baseIntegration, id: 'acme_key_mcp', name: 'Acme Key' },
      provider,
    )
    expect(config.mode).toBe('api_key')
    expect(config.mcpPreset).toBe('custom_mcp')
    expect(config.mcpServerUrl).toBe('https://mcp.acme.test/key')
    expect(config.mcpDisplayName).toBe('Acme Key')
  })
})
