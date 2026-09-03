import { describe, expect, it } from 'vitest'
import {
  REMOTE_MCP_HOSTS,
  REMOTE_MCP_PROVIDERS,
  logoUrlForHost,
  remoteMcpBySlug,
} from './mcp-remote-providers'

describe('mcp-remote-providers', () => {
  it('loads the shared catalog with unique slugs', () => {
    const slugs = REMOTE_MCP_PROVIDERS.map((p) => p.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    expect(slugs).toEqual(expect.arrayContaining(['moneybird_mcp', 'mollie_mcp', 'notion_mcp']))
  })

  it('keeps US-centric accounting out of the preset list', () => {
    const slugs = REMOTE_MCP_PROVIDERS.map((p) => p.slug)
    expect(slugs).not.toContain('quickbooks_mcp')
    expect(slugs).not.toContain('xero_mcp')
  })

  it('marks live OAuth URLs available and missing URLs as coming soon', () => {
    expect(remoteMcpBySlug('notion_mcp')?.defaultStatus).toBe('available')
    expect(remoteMcpBySlug('mollie_mcp')?.mcpRemoteUrl).toBe('https://mcp.mollie.com/mcp')
    expect(remoteMcpBySlug('yuki_mcp')?.defaultStatus).toBe('coming_soon')
    expect(remoteMcpBySlug('pipedrive_mcp')?.defaultStatus).toBe('coming_soon')
  })

  it('resolves a logo URL for hosts with Simple Icons or a domain favicon', () => {
    expect(logoUrlForHost('stripe')).toContain('cdn.simpleicons.org/stripe')
    expect(logoUrlForHost('mollie')).toContain('favicons')
    expect(logoUrlForHost('mollie')).toContain('mollie.com')
    expect(REMOTE_MCP_HOSTS.every((h) => h.initials && h.brand_color)).toBe(true)
    expect(REMOTE_MCP_HOSTS.every((h) => Boolean(h.simpleicons || h.logo_domain))).toBe(true)
  })

  it('points every provider at a known host', () => {
    const hosts = new Set(REMOTE_MCP_HOSTS.map((h) => h.slug))
    for (const p of REMOTE_MCP_PROVIDERS) {
      expect(hosts.has(p.hostSlug)).toBe(true)
    }
  })
})
