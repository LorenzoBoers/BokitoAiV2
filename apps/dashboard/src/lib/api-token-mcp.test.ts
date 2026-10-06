import { describe, expect, it } from 'vitest'
import {
  buildClaudeCodeMcpCommand,
  buildClaudeDesktopMcpConfig,
  buildCodexMcpConfig,
  buildCursorMcpConfig,
  buildCursorMcpOAuthConfig,
  buildMcpTokenEnvLine,
  buildMcpToolsListCurl,
  buildVsCodeMcpConfig,
  buildWindsurfMcpConfig,
  MCP_TOKEN_ENV,
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

  it('builds Claude Code commands for OAuth and token', () => {
    expect(buildClaudeCodeMcpCommand(null, 'https://x.test')).toBe(
      'claude mcp add --transport http --scope user bokito https://x.test/api/mcp',
    )
    expect(buildClaudeCodeMcpCommand('bok_t', 'https://x.test')).toContain(
      '--header "Authorization: Bearer bok_t"',
    )
  })

  it('keeps tokens out of Codex, VS Code and Windsurf config files', () => {
    expect(buildCodexMcpConfig(false, 'https://x.test')).toBe(
      '[mcp_servers.bokito]\nurl = "https://x.test/api/mcp"',
    )
    expect(buildCodexMcpConfig(true, 'https://x.test')).toContain(`bearer_token_env_var = "${MCP_TOKEN_ENV}"`)

    const vscode = JSON.parse(buildVsCodeMcpConfig(true, 'https://x.test')) as {
      servers: { bokito: { type: string; url: string; headers: { Authorization: string } } }
    }
    expect(vscode.servers.bokito.type).toBe('http')
    expect(vscode.servers.bokito.headers.Authorization).toBe('Bearer ${input:bokito-token}')
    expect(JSON.parse(buildVsCodeMcpConfig(false, 'https://x.test')).servers.bokito.headers).toBeUndefined()

    const windsurf = JSON.parse(buildWindsurfMcpConfig(true, 'https://x.test')) as {
      mcpServers: { bokito: { serverUrl: string; headers: { Authorization: string } } }
    }
    expect(windsurf.mcpServers.bokito.serverUrl).toBe('https://x.test/api/mcp')
    expect(windsurf.mcpServers.bokito.headers.Authorization).toBe(`Bearer \${env:${MCP_TOKEN_ENV}}`)
    expect(buildMcpTokenEnvLine('bok_z')).toBe(`export ${MCP_TOKEN_ENV}="bok_z"`)
  })

  it('builds tools/list curl and presets', () => {
    expect(mcpEndpointUrl('https://x.test/')).toBe('https://x.test/api/mcp')
    expect(buildMcpToolsListCurl('bok_y', 'https://x.test')).toContain('tools/list')
    expect(TOKEN_SCOPE_PRESETS.find((p) => p.id === 'full')?.scopes).toEqual([])
    expect(TOKEN_SCOPE_PRESETS.find((p) => p.id === 'ops')?.scopes).toContain('tickets')
  })
})
