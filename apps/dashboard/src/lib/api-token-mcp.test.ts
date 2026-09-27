import { describe, expect, it } from 'vitest'
import {
  buildClaudeDesktopMcpConfig,
  buildCursorMcpConfig,
  buildCursorMcpOAuthConfig,
  buildMcpToolsListCurl,
  mcpEndpointUrl,
  TOKEN_SCOPE_PRESETS,
} from './api-token-mcp'

describe('api-token-mcp', () => {
  it('builds Cursor URL-only OAuth config', () => {
    const raw = buildCursorMcpOAuthConfig('https://app.bokito.ai/')
    const parsed = JSON.parse(raw) as {
      mcpServers: { bokito: { url: string; headers?: unknown } }
    }
    expect(parsed.mcpServers.bokito.url).toBe('https://app.bokito.ai/api/mcp')
    expect(parsed.mcpServers.bokito.headers).toBeUndefined()
  })

  it('builds Cursor mcpServers JSON with bearer header', () => {
    const raw = buildCursorMcpConfig('bok_test', 'https://app.bokito.ai/')
    const parsed = JSON.parse(raw) as {
      mcpServers: { bokito: { url: string; headers: { Authorization: string } } }
    }
    expect(parsed.mcpServers.bokito.url).toBe('https://app.bokito.ai/api/mcp')
    expect(parsed.mcpServers.bokito.headers.Authorization).toBe('Bearer bok_test')
  })

  it('builds Claude Desktop mcp-remote bridge config', () => {
    const raw = buildClaudeDesktopMcpConfig('bok_x', 'http://127.0.0.1:8000')
    expect(raw).toContain('mcp-remote')
    expect(raw).toContain('http://127.0.0.1:8000/api/mcp')
    expect(raw).toContain('bok_x')
  })

  it('builds tools/list curl and presets', () => {
    expect(mcpEndpointUrl('https://x.test/')).toBe('https://x.test/api/mcp')
    expect(buildMcpToolsListCurl('bok_y', 'https://x.test')).toContain('tools/list')
    expect(TOKEN_SCOPE_PRESETS.find((p) => p.id === 'full')?.scopes).toEqual([])
    expect(TOKEN_SCOPE_PRESETS.find((p) => p.id === 'ops')?.scopes).toContain('cases')
  })
})
