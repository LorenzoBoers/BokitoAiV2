/** Remote MCP marketplace presets. Source: apps/api/app/data/mcp_remote_catalog.json */

import catalog from '../../../api/app/data/mcp_remote_catalog.json'

export type McpMarketplaceCategory =
  | 'Accounting'
  | 'Banking'
  | 'Communication'
  | 'Productivity'
  | 'CRM'
  | 'Development'

export type McpPresetAuth = 'mcp_remote_oauth' | 'api_key' | 'bearer'

export type RemoteMcpHostDef = {
  slug: string
  name: string
  brand_color: string
  initials: string
  simpleicons?: string
  /** Public website domain for favicon fallback when Simple Icons has no mark. */
  logo_domain?: string
  description?: string
}

export type RemoteMcpProviderDef = {
  slug: string
  staticId: string
  hostSlug: string
  name: string
  description: string
  category: McpMarketplaceCategory
  mcpRemoteUrl: string
  mcpTransport: 'streamable_http' | 'sse'
  authMethod: McpPresetAuth
  defaultStatus: 'available' | 'coming_soon'
  module?: 'accounting' | 'banking'
}

type CatalogJson = {
  hosts: RemoteMcpHostDef[]
  providers: Array<{
    slug: string
    static_id: string
    host_slug: string
    name: string
    description: string
    category: McpMarketplaceCategory
    auth_type: McpPresetAuth
    mcp_remote_url?: string
    mcp_transport?: 'streamable_http' | 'sse'
    status?: 'available' | 'coming_soon'
    module?: 'accounting' | 'banking'
  }>
}

const data = catalog as CatalogJson

export const REMOTE_MCP_HOSTS: RemoteMcpHostDef[] = data.hosts

export const REMOTE_MCP_HOST_BY_SLUG: Record<string, RemoteMcpHostDef> = Object.fromEntries(
  REMOTE_MCP_HOSTS.map((h) => [h.slug, h]),
)

export const REMOTE_MCP_PROVIDERS: RemoteMcpProviderDef[] = data.providers.map((p) => {
  const url = (p.mcp_remote_url || '').trim()
  const authMethod = p.auth_type
  const defaultStatus: 'available' | 'coming_soon' =
    authMethod === 'mcp_remote_oauth' && !url ? 'coming_soon' : (p.status ?? 'coming_soon')
  return {
    slug: p.slug,
    staticId: p.static_id,
    hostSlug: p.host_slug,
    name: p.name,
    description: p.description,
    category: p.category,
    mcpRemoteUrl: url,
    mcpTransport: p.mcp_transport ?? 'streamable_http',
    authMethod,
    defaultStatus,
    module: p.module,
  }
})

export const REMOTE_MCP_SLUGS = REMOTE_MCP_PROVIDERS.map((p) => p.slug)

export function simpleIconsLogoUrl(iconSlug: string, color: string): string {
  const hex = color.replace('#', '')
  return `https://cdn.simpleicons.org/${iconSlug}/${hex}`
}

export function faviconLogoUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`
}

export function logoUrlForHost(hostSlug: string): string | null {
  const host = REMOTE_MCP_HOST_BY_SLUG[hostSlug]
  if (!host) return null
  if (host.simpleicons) return simpleIconsLogoUrl(host.simpleicons, host.brand_color)
  if (host.logo_domain) return faviconLogoUrl(host.logo_domain)
  return null
}

export function remoteMcpBySlug(slug: string): RemoteMcpProviderDef | undefined {
  return REMOTE_MCP_PROVIDERS.find((p) => p.slug === slug)
}

export function remoteMcpByStaticId(staticId: string): RemoteMcpProviderDef | undefined {
  return REMOTE_MCP_PROVIDERS.find((p) => p.staticId === staticId)
}

export function hostSlugForRemoteStaticId(staticId: string): string | undefined {
  return remoteMcpByStaticId(staticId)?.hostSlug
}
