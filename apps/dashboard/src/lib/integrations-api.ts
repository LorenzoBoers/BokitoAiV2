import { integrationsRoutes } from '../api/routes'
import { attachHostsToProviders } from './integration-brand'
import {
  xanoDeleteIntegrations,
  xanoGetIntegrations,
  xanoPostIntegrations,
} from './xano'

export type IntegrationAuthType = 'oauth2' | 'api_key' | 'mcp_remote_oauth' | 'none'
export type IntegrationProviderStatus = 'available' | 'coming_soon' | 'deprecated'

export interface IntegrationHostRow {
  id?: string
  slug: string
  name: string
  website_url?: string | null
  logo_url?: string | null
  logo_dark_url?: string | null
  brand_color?: string | null
  initials?: string | null
}

export interface IntegrationProviderRow {
  id: string
  slug: string
  name: string
  description: string
  category: string
  auth_type: IntegrationAuthType
  capabilities?: Record<string, boolean>
  status: IntegrationProviderStatus
  host_id?: string
  host?: IntegrationHostRow | null
  logo_meta?: { initials?: string; color?: string }
  sort_order?: number
  mcp_remote_url?: string | null
  mcp_transport?: string | null
  oauth_profile?: Record<string, unknown> | null
}

export interface IntegrationConnectionRow {
  id: string
  tenant_id: string
  provider_id: string
  external_account_id: string
  display_name: string
  status: 'active' | 'revoked' | 'error'
  metadata?: Record<string, unknown>
  connected_by_user_id?: number
  created_at?: string
  updated_at?: string
}

export interface ProvidersListResponse {
  providers: IntegrationProviderRow[]
  hosts?: IntegrationHostRow[]
  connection_counts: {
    by_provider_id: Record<string, number>
    email_outlook: number
    email_gmail: number
  }
}

export interface ConnectionsListResponse {
  connections: IntegrationConnectionRow[]
}

export interface McpBindingsResponse {
  bindings: Array<{
    id: string
    connection_id?: string
    config: {
      mcp_server_id?: number | string
      provider?: string
      server_url?: string
      auth_type?: string
    }
  }>
  mcp_server_ids: Array<number | string>
}

export async function listIntegrationProviders(): Promise<ProvidersListResponse> {
  const data = await xanoGetIntegrations<ProvidersListResponse>(
    integrationsRoutes.platform.providers,
  )
  const providers = attachHostsToProviders(data.providers ?? [], data.hosts ?? [])
  return { ...data, providers }
}

export async function listIntegrationConnections(
  provider?: string,
): Promise<IntegrationConnectionRow[]> {
  const data = await xanoGetIntegrations<ConnectionsListResponse>(
    integrationsRoutes.platform.connections(provider),
  )
  return data.connections ?? []
}

export async function startIntegrationOAuth(
  provider: string,
  returnUrl: string,
  projectId?: string,
): Promise<{ authorize_url: string; provider: string }> {
  return xanoGetIntegrations(integrationsRoutes.platform.oauthStart(provider, returnUrl, projectId))
}

export async function startMcpRemoteOAuth(
  provider: string,
  returnUrl: string,
): Promise<{ authorize_url: string; provider: string; state?: string }> {
  return xanoGetIntegrations(integrationsRoutes.platform.mcpOAuthStart(provider, returnUrl))
}

export async function revokeIntegrationConnection(connectionId: string): Promise<void> {
  await xanoDeleteIntegrations(integrationsRoutes.platform.connectionById(connectionId))
}

export async function createApiKeyConnection(input: {
  provider: string
  api_key: string
  display_name?: string
}): Promise<IntegrationConnectionRow> {
  return xanoPostIntegrations<IntegrationConnectionRow>(
    integrationsRoutes.platform.connections(),
    input,
  )
}

export async function installMcpIntegration(input: {
  provider: string
  api_key: string
  display_name?: string
  mcp_server_id?: number
  server_url?: string
  auth_type?: 'api_key' | 'bearer'
}): Promise<{ connection: IntegrationConnectionRow; binding: { id: string; config: unknown } }> {
  return xanoPostIntegrations(integrationsRoutes.platform.mcpInstall, input)
}

export async function listMcpBindings(): Promise<McpBindingsResponse> {
  return xanoGetIntegrations<McpBindingsResponse>(integrationsRoutes.platform.mcpBindings)
}

export function connectionCountForProvider(
  provider: IntegrationProviderRow,
  counts: ProvidersListResponse['connection_counts'],
): number {
  const byId = counts.by_provider_id?.[provider.id] ?? 0
  if (provider.slug === 'outlook') return byId + (counts.email_outlook ?? 0)
  if (provider.slug === 'gmail') return byId + (counts.email_gmail ?? 0)
  return byId
}
