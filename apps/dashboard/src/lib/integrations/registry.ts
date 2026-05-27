import type { IntegrationKind } from '../integration-kind'
import type { OAuthProvider } from '../email-oauth'

export type McpSetupPreset = 'bjorn_lunden_mcp' | 'custom_mcp'

/** How the dashboard starts OAuth for this provider. */
export type IntegrationOAuthStrategy = 'github' | 'inbox' | 'platform'

export type IntegrationSetupMode = 'oauth2' | 'api_key' | 'custom_mcp'

export type ConnectionCountSource =
  | 'github_api'
  | 'email_outlook'
  | 'email_gmail'
  | 'platform'

export type ProviderRegistryEntry = {
  /** Marketplace card id (e.g. microsoft-365). */
  staticId: string
  /** Xano integration_providers.slug. */
  platformSlug: string
  kind: IntegrationKind
  setupMode: IntegrationSetupMode
  oauthStrategy?: IntegrationOAuthStrategy
  inboxOAuthProvider?: OAuthProvider
  mcpPreset?: McpSetupPreset
  /** Default Xano MCP server id for platform MCP install. */
  mcpServerId?: number
  connectionCountSource: ConnectionCountSource
}

const REGISTRY_LIST: ProviderRegistryEntry[] = [
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
    staticId: 'bjorn_lunden_mcp',
    platformSlug: 'bjorn_lunden_mcp',
    kind: 'mcp',
    setupMode: 'api_key',
    mcpPreset: 'bjorn_lunden_mcp',
    mcpServerId: 8,
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
]

const BY_STATIC_ID = new Map(REGISTRY_LIST.map((e) => [e.staticId, e]))
const BY_PLATFORM_SLUG = new Map(REGISTRY_LIST.map((e) => [e.platformSlug, e]))

/** Maps Xano provider slug to marketplace integration card id. */
export const SLUG_TO_STATIC_ID: Record<string, string> = {
  github: 'github',
  outlook: 'microsoft-365',
  gmail: 'google-workspace',
  microsoft_mail: 'microsoft-365',
  google_mail: 'google-workspace',
  bjorn_lunden_mcp: 'bjorn_lunden_mcp',
  custom_mcp: 'custom_mcp',
}

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
