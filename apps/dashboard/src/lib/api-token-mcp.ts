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

/** Env var the token-mode snippets read, so the token stays out of config files. */
export const MCP_TOKEN_ENV = 'BOKITO_MCP_TOKEN'

/** Claude Code CLI. Without a token, `/mcp` in Claude Code runs the OAuth sign-in. */
export function buildClaudeCodeMcpCommand(token: string | null, origin = ''): string {
  const base = `claude mcp add --transport http --scope user bokito ${mcpEndpointUrl(origin)}`
  return token ? `${base} --header "Authorization: Bearer ${token}"` : base
}

/** Codex CLI `~/.codex/config.toml`. OAuth mode signs in with `codex mcp login bokito`. */
export function buildCodexMcpConfig(useToken: boolean, origin = ''): string {
  const lines = ['[mcp_servers.bokito]', `url = "${mcpEndpointUrl(origin)}"`]
  if (useToken) lines.push(`bearer_token_env_var = "${MCP_TOKEN_ENV}"`)
  return lines.join('\n')
}

/** VS Code `.vscode/mcp.json`. Token mode prompts once and stores it in VS Code's secret storage. */
export function buildVsCodeMcpConfig(useToken: boolean, origin = ''): string {
  const url = mcpEndpointUrl(origin)
  const config = useToken
    ? {
        inputs: [
          { type: 'promptString', id: 'bokito-token', description: 'Bokito API token', password: true },
        ],
        servers: {
          bokito: { type: 'http', url, headers: { Authorization: 'Bearer ${input:bokito-token}' } },
        },
      }
    : { servers: { bokito: { type: 'http', url } } }
  return JSON.stringify(config, null, 2)
}

/** Windsurf `mcp_config.json`. */
export function buildWindsurfMcpConfig(useToken: boolean, origin = ''): string {
  const url = mcpEndpointUrl(origin)
  const server = useToken
    ? { serverUrl: url, headers: { Authorization: `Bearer \${env:${MCP_TOKEN_ENV}}` } }
    : { serverUrl: url }
  return JSON.stringify({ mcpServers: { bokito: server } }, null, 2)
}

/** Shell line that sets the token env var for Codex and Windsurf. */
export function buildMcpTokenEnvLine(token: string): string {
  return `export ${MCP_TOKEN_ENV}="${token}"`
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
    scopes: ['workspace', 'projects', 'messaging', 'agents', 'delegation', 'tickets', 'triggers'],
  },
  {
    id: 'full',
    scopes: [],
  },
]
