/** Paste-ready MCP client configs for a workspace API token / OAuth URL. */

/** Shown in at-rest MCP setup cards so secrets never sit in the page. */
export const MCP_TOKEN_PLACEHOLDER = 'YOUR_BOKITO_API_TOKEN'

export function mcpEndpointUrl(origin = ''): string {
  const base = origin.replace(/\/$/, '')
  return `${base}/api/mcp`
}

/**
 * Preferred Cursor config: URL only. Cursor discovers OAuth, opens the
 * browser, and the operator picks a workspace under their account.
 */
export function buildCursorMcpOAuthConfig(origin = ''): string {
  const url = mcpEndpointUrl(origin)
  return JSON.stringify(
    {
      mcpServers: {
        bokito: {
          url,
        },
      },
    },
    null,
    2,
  )
}

/** Cursor / VS Code style mcpServers entry (streamable HTTP + bearer). */
export function buildCursorMcpConfig(token: string, origin = ''): string {
  const url = mcpEndpointUrl(origin)
  return JSON.stringify(
    {
      mcpServers: {
        bokito: {
          url,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    },
    null,
    2,
  )
}

/**
 * Claude Desktop still prefers a stdio bridge for remote HTTP MCP in many
 * builds. Document the HTTP endpoint + token so operators can use mcp-remote
 * or any HTTP-capable client.
 */
export function buildClaudeDesktopMcpConfig(token: string, origin = ''): string {
  const url = mcpEndpointUrl(origin)
  return JSON.stringify(
    {
      mcpServers: {
        bokito: {
          command: 'npx',
          args: ['-y', 'mcp-remote', url, '--header', `Authorization: Bearer ${token}`],
        },
      },
    },
    null,
    2,
  )
}

export function buildMcpToolsListCurl(token: string, origin = ''): string {
  const url = mcpEndpointUrl(origin)
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
  return `curl -sS -X POST "${url}" -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '${body}'`
}

export type TokenScopePreset = {
  id: 'read' | 'ops' | 'full'
  scopes: string[]
}

/** Recommended scope presets for Developers UI (empty = full access). */
export const TOKEN_SCOPE_PRESETS: TokenScopePreset[] = [
  {
    id: 'read',
    scopes: ['workspace', 'projects', 'messaging'],
  },
  {
    id: 'ops',
    scopes: ['workspace', 'projects', 'messaging', 'agents', 'delegation', 'cases', 'triggers'],
  },
  {
    id: 'full',
    scopes: [],
  },
]
