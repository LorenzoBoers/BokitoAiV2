import type { Integration } from '../data/integrations-data'
import type { IntegrationAuthType, IntegrationProviderRow } from './integrations-api'
import {
  getRegistryEntryByPlatformSlug,
  getRegistryEntryByStaticId,
  resolveRegistryEntry,
  STATIC_ID_TO_SLUG,
  type IntegrationSetupMode,
} from './integrations/registry'
import type { OAuthProvider } from './email-oauth'

export type { IntegrationSetupMode, McpSetupPreset } from './integrations/registry'

export type IntegrationSetupConfig = {
  mode: IntegrationSetupMode
  platformSlug: string
  oauthProvider?: OAuthProvider
  mcpPreset?: import('./integrations/registry').McpSetupPreset
}

export function integrationIdToPlatformSlug(integrationId: string): string {
  return STATIC_ID_TO_SLUG[integrationId] ?? integrationId
}

export function resolveSetupConfig(
  integration: Integration,
  provider?: IntegrationProviderRow | null,
): IntegrationSetupConfig {
  if (integration.status === 'coming_soon' || provider?.status === 'coming_soon') {
    return {
      mode: 'oauth2',
      platformSlug: provider?.slug ?? integrationIdToPlatformSlug(integration.id),
    }
  }
  const platformSlug = provider?.slug ?? integrationIdToPlatformSlug(integration.id)
  const entry =
    resolveRegistryEntry(integration.id, platformSlug) ??
    getRegistryEntryByStaticId(integration.id) ??
    getRegistryEntryByPlatformSlug(platformSlug)

  if (entry) {
    return {
      mode: entry.setupMode,
      platformSlug: entry.platformSlug,
      oauthProvider: entry.inboxOAuthProvider,
      mcpPreset: entry.mcpPreset,
    }
  }

  if (provider?.auth_type === 'mcp_remote_oauth') {
    return { mode: 'remote_mcp_oauth', platformSlug }
  }

  const authType: IntegrationAuthType = provider?.auth_type ?? defaultAuthType(integration.id)
  if (authType === 'oauth2' || integration.id === 'github') {
    return { mode: 'oauth2', platformSlug }
  }
  if (provider?.capabilities?.mcp_tools || provider?.capabilities?.remote_mcp) {
    return { mode: 'api_key', platformSlug, mcpPreset: 'custom_mcp' }
  }
  return { mode: 'oauth2', platformSlug }
}

function defaultAuthType(integrationId: string): IntegrationAuthType {
  const entry = getRegistryEntryByStaticId(integrationId)
  if (entry?.setupMode === 'api_key' || entry?.setupMode === 'custom_mcp') return 'api_key'
  if (entry?.setupMode === 'oauth2') return 'oauth2'
  if (integrationId === 'github' || integrationId === 'microsoft-365' || integrationId === 'google-workspace') {
    return 'oauth2'
  }
  if (
    integrationId === 'king_accountancy' ||
    integrationId === 'bjorn_lunden_mcp' ||
    integrationId === 'custom_mcp'
  ) {
    return 'api_key'
  }
  return 'oauth2'
}

export function capabilityLabels(
  provider?: IntegrationProviderRow | null,
  integration?: Integration,
): string[] {
  const caps = provider?.capabilities ?? {}
  const labels: string[] = []
  if (caps.inbox_sync) labels.push('inbox_sync')
  if (caps.repo_index) labels.push('repo_index')
  if (caps.remote_mcp) labels.push('remote_mcp')
  if (caps.mcp_tools || integration?.kind === 'mcp') labels.push('mcp_tools')
  if (labels.length === 0 && integration?.kind === 'inbox') labels.push('inbox_sync')
  if (labels.length === 0 && integration?.kind === 'repository') labels.push('repo_index')
  if (labels.length === 0 && integration?.kind === 'mcp') labels.push('mcp_tools')
  return labels
}
