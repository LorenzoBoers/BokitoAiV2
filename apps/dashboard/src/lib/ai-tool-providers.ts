/**
 * AI tools that connect to this workspace over MCP (inbound), and coding tools
 * Bokito hands work to (outbound Workbench). Copy lives in the nav locale under
 * `developersPage.aiTools.providers.{id}` and `developersPage.workbench.providers.{id}`.
 */
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
  MCP_TOKEN_PLACEHOLDER,
} from './api-token-mcp'

export type AiToolAuthMode = 'oauth' | 'token'

export type AiToolSnippet = {
  id: string
  language: 'json' | 'toml' | 'shell'
  code: string
  /** Offered as a download when set. */
  fileName?: string
}

export type AiToolProviderId =
  | 'cursor'
  | 'claudeCode'
  | 'claudeDesktop'
  | 'codex'
  | 'vscode'
  | 'windsurf'
  | 'chatgpt'
  | 'generic'

export type AiToolProvider = {
  id: AiToolProviderId
  /** Slug in `lib/brand-assets.ts`. */
  brand: string
  /** First entry is the recommended mode. */
  authModes: AiToolAuthMode[]
  /** Number of numbered steps per mode in the locale (`oauth1`, `oauth2`, ...). */
  steps: Partial<Record<AiToolAuthMode, number>>
  /** Matches an OAuth grant's client name to show the row as connected. */
  grantMatch?: RegExp
  snippets: (mode: AiToolAuthMode, origin: string, token: string | null) => AiToolSnippet[]
}

const tokenOrPlaceholder = (token: string | null) => token ?? MCP_TOKEN_PLACEHOLDER

export const AI_TOOL_PROVIDERS: AiToolProvider[] = [
  {
    id: 'cursor',
    brand: 'cursor',
    authModes: ['oauth', 'token'],
    steps: { oauth: 3, token: 3 },
    grantMatch: /cursor/i,
    snippets: (mode, origin, token) => [
      {
        id: 'config',
        language: 'json',
        fileName: 'mcp.json',
        code:
          mode === 'oauth'
            ? buildCursorMcpOAuthConfig(origin)
            : buildCursorMcpConfig(tokenOrPlaceholder(token), origin),
      },
    ],
  },
  {
    id: 'claudeCode',
    brand: 'claude',
    authModes: ['oauth', 'token'],
    steps: { oauth: 3, token: 2 },
    grantMatch: /claude[\s-]?code/i,
    snippets: (mode, origin, token) => [
      {
        id: 'command',
        language: 'shell',
        code: buildClaudeCodeMcpCommand(mode === 'oauth' ? null : tokenOrPlaceholder(token), origin),
      },
    ],
  },
  {
    id: 'claudeDesktop',
    brand: 'claude',
    authModes: ['oauth', 'token'],
    steps: { oauth: 3, token: 3 },
    grantMatch: /^claude(?![\s-]?code)/i,
    snippets: (mode, origin, token) =>
      mode === 'oauth'
        ? []
        : [
            {
              id: 'config',
              language: 'json',
              fileName: 'claude_desktop_config.json',
              code: buildClaudeDesktopMcpConfig(tokenOrPlaceholder(token), origin),
            },
          ],
  },
  {
    id: 'codex',
    brand: 'openai',
    authModes: ['oauth', 'token'],
    steps: { oauth: 3, token: 3 },
    grantMatch: /codex/i,
    snippets: (mode, origin, token) => {
      const config: AiToolSnippet = {
        id: 'config',
        language: 'toml',
        fileName: 'config.toml',
        code: buildCodexMcpConfig(mode === 'token', origin),
      }
      if (mode === 'oauth') return [config]
      return [{ id: 'env', language: 'shell', code: buildMcpTokenEnvLine(tokenOrPlaceholder(token)) }, config]
    },
  },
  {
    id: 'vscode',
    brand: 'vscode',
    authModes: ['oauth', 'token'],
    steps: { oauth: 3, token: 3 },
    grantMatch: /visual studio code|vs ?code/i,
    snippets: (mode, origin) => [
      {
        id: 'config',
        language: 'json',
        fileName: 'mcp.json',
        code: buildVsCodeMcpConfig(mode === 'token', origin),
      },
    ],
  },
  {
    id: 'windsurf',
    brand: 'windsurf',
    authModes: ['oauth', 'token'],
    steps: { oauth: 3, token: 3 },
    grantMatch: /windsurf|codeium/i,
    snippets: (mode, origin, token) => {
      const config: AiToolSnippet = {
        id: 'config',
        language: 'json',
        fileName: 'mcp_config.json',
        code: buildWindsurfMcpConfig(mode === 'token', origin),
      }
      if (mode === 'oauth') return [config]
      return [{ id: 'env', language: 'shell', code: buildMcpTokenEnvLine(tokenOrPlaceholder(token)) }, config]
    },
  },
  {
    id: 'chatgpt',
    brand: 'openai',
    authModes: ['oauth'],
    steps: { oauth: 4 },
    grantMatch: /chatgpt|openai/i,
    snippets: () => [],
  },
  {
    id: 'generic',
    brand: 'custom',
    authModes: ['token'],
    steps: { token: 3 },
    snippets: (_mode, origin, token) => [
      { id: 'curl', language: 'shell', code: buildMcpToolsListCurl(tokenOrPlaceholder(token), origin) },
    ],
  },
]

/** The first OAuth grant whose client name matches the provider, if any. */
export function matchingGrantName(
  provider: AiToolProvider,
  grants: { client_name: string }[],
): string | null {
  if (!provider.grantMatch) return null
  return grants.find((grant) => provider.grantMatch!.test(grant.client_name))?.client_name ?? null
}

export type WorkbenchProviderId = 'cursorAgents' | 'claudeManaged' | 'devin' | 'copilot' | 'claudeCodeCi'

export type WorkbenchProvider = {
  id: WorkbenchProviderId
  brand: string
  /** Phase in docs/architecture/workbench-gateway.md. */
  phase: 1 | 2 | 3
}

/** Outbound coding tools. None can be connected until their adapter ships. */
export const WORKBENCH_PROVIDERS: WorkbenchProvider[] = [
  { id: 'cursorAgents', brand: 'cursor', phase: 1 },
  { id: 'claudeManaged', brand: 'claude', phase: 1 },
  { id: 'devin', brand: 'devin', phase: 1 },
  { id: 'copilot', brand: 'copilot', phase: 2 },
  { id: 'claudeCodeCi', brand: 'claude', phase: 2 },
]
