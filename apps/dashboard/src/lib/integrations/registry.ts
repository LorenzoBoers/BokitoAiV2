import type { IntegrationKind } from '../integration-kind'
import type { OAuthProvider } from '../email-oauth'
import { REMOTE_MCP_PROVIDERS } from '../mcp-remote-providers'

export type McpSetupPreset = 'bjorn_lunden_mcp' | 'king_accountancy' | 'custom_mcp'

/** How the dashboard starts OAuth for this provider. */
export type IntegrationOAuthStrategy = 'github' | 'inbox' | 'platform' | 'mcp_remote'

export type IntegrationSetupMode = 'oauth2' | 'api_key' | 'custom_mcp' | 'remote_mcp_oauth'

export type ConnectionCountSource =
  | 'github_api'
  | 'email_outlook'
  | 'email_gmail'
  | 'platform'

export type ProviderRegistryEntry = {
  /** Marketplace card id (e.g. microsoft-365). */
  staticId: string
  /** integration_providers.slug. */
  platformSlug: string
  kind: IntegrationKind
  setupMode: IntegrationSetupMode
  oauthStrategy?: IntegrationOAuthStrategy
  inboxOAuthProvider?: OAuthProvider
  mcpPreset?: McpSetupPreset
  /** Default MCP server id for platform MCP install. */
  mcpServerId?: number
  mcpRemoteUrl?: string
  connectionCountSource: ConnectionCountSource
}

const CORE_REGISTRY: ProviderRegistryEntry[] = [
  {
    staticId: 'github',
    platformSlug: 'github',
    kind: 'repository',
    setupMode: 'oauth2',
    oauthStrategy: 'github',
    connectionCountSource: 'github_api',
  },
  {
    staticId: 'microsoft-365',
    platformSlug: 'outlook',
    kind: 'inbox',
    setupMode: 'oauth2',
    oauthStrategy: 'inbox',
    inboxOAuthProvider: 'outlook',
    connectionCountSource: 'email_outlook',
  },
  {
    staticId: 'google-workspace',
    platformSlug: 'gmail',
    kind: 'inbox',
    setupMode: 'oauth2',
    oauthStrategy: 'inbox',
    inboxOAuthProvider: 'gmail',
    connectionCountSource: 'email_gmail',
  },
  {
    staticId: 'google-calendar',
    platformSlug: 'google_calendar',
    kind: 'calendar',
    setupMode: 'oauth2',
    oauthStrategy: 'platform',
    connectionCountSource: 'platform',
  },
  {
    staticId: 'outlook-calendar',
    platformSlug: 'outlook_calendar',
    kind: 'calendar',
    setupMode: 'oauth2',
    oauthStrategy: 'platform',
    connectionCountSource: 'platform',
  },
  {
    staticId: 'king_accountancy',
    platformSlug: 'king_accountancy',
    kind: 'mcp',
    setupMode: 'api_key',
    mcpPreset: 'king_accountancy',
    connectionCountSource: 'platform',
  },
  {
    staticId: 'bjorn_lunden_mcp',
    platformSlug: 'bjorn_lunden_mcp',
    kind: 'mcp',
    setupMode: 'api_key',
    mcpPreset: 'bjorn_lunden_mcp',
    mcpServerId: 8,
    connectionCountSource: 'platform',
  },
  {
    staticId: 'moneybird',
    platformSlug: 'moneybird',
    kind: 'mcp',
    setupMode: 'oauth2',
    oauthStrategy: 'platform',
    connectionCountSource: 'platform',
  },
  {
    staticId: 'exact_online',
    platformSlug: 'exact_online',
    kind: 'mcp',
    setupMode: 'oauth2',
    oauthStrategy: 'platform',
    connectionCountSource: 'platform',
  },
  {
    staticId: 'snelstart',
    platformSlug: 'snelstart',
    kind: 'mcp',
    setupMode: 'api_key',
    connectionCountSource: 'platform',
  },
  {
    staticId: 'custom_mcp',
    platformSlug: 'custom_mcp',
    kind: 'mcp',
    setupMode: 'custom_mcp',
    mcpPreset: 'custom_mcp',
    connectionCountSource: 'platform',
  },
  {
    staticId: 'shopify',
    platformSlug: 'shopify_mcp',
    kind: 'mcp',
    setupMode: 'oauth2',
    oauthStrategy: 'platform',
    connectionCountSource: 'platform',
  },
]

const REMOTE_MCP_REGISTRY: ProviderRegistryEntry[] = REMOTE_MCP_PROVIDERS.map((p) => ({
  staticId: p.staticId,
  platformSlug: p.slug,
  kind: 'mcp' as IntegrationKind,
  setupMode: 'remote_mcp_oauth' as IntegrationSetupMode,
  oauthStrategy: 'mcp_remote' as IntegrationOAuthStrategy,
  mcpRemoteUrl: p.mcpRemoteUrl,
  connectionCountSource: 'platform' as ConnectionCountSource,
}))

const REGISTRY_LIST: ProviderRegistryEntry[] = [...CORE_REGISTRY, ...REMOTE_MCP_REGISTRY]

const BY_STATIC_ID = new Map(REGISTRY_LIST.map((e) => [e.staticId, e]))
const BY_PLATFORM_SLUG = new Map(REGISTRY_LIST.map((e) => [e.platformSlug, e]))

const SLUG_TO_STATIC_ID_RECORD: Record<string, string> = {
  github: 'github',
  outlook: 'microsoft-365',
  gmail: 'google-workspace',
  google_calendar: 'google-calendar',
  outlook_calendar: 'outlook-calendar',
  microsoft_mail: 'microsoft-365',
  google_mail: 'google-workspace',
  king_accountancy: 'king_accountancy',
  bjorn_lunden_mcp: 'bjorn_lunden_mcp',
  moneybird: 'moneybird',
  exact_online: 'exact_online',
  snelstart: 'snelstart',
  custom_mcp: 'custom_mcp',
  shopify_mcp: 'shopify',
}

for (const p of REMOTE_MCP_PROVIDERS) {
  SLUG_TO_STATIC_ID_RECORD[p.slug] = p.staticId
}

/** Maps provider slug to marketplace integration card id. */
export const SLUG_TO_STATIC_ID: Record<string, string> = SLUG_TO_STATIC_ID_RECORD

export const STATIC_ID_TO_SLUG: Record<string, string> = Object.fromEntries(
  REGISTRY_LIST.map((e) => [e.staticId, e.platformSlug]),
)

export const PROVIDER_REGISTRY = REGISTRY_LIST

export function getRegistryEntryByStaticId(staticId: string): ProviderRegistryEntry | undefined {
  return BY_STATIC_ID.get(staticId)
}

export function getRegistryEntryByPlatformSlug(slug: string): ProviderRegistryEntry | undefined {
  return BY_PLATFORM_SLUG.get(slug) ?? BY_STATIC_ID.get(SLUG_TO_STATIC_ID[slug] ?? '')
}

export function resolveRegistryEntry(
  staticId: string,
  platformSlug?: string,
): ProviderRegistryEntry | undefined {
  return (
    getRegistryEntryByStaticId(staticId) ??
    (platformSlug ? getRegistryEntryByPlatformSlug(platformSlug) : undefined)
  )
}
