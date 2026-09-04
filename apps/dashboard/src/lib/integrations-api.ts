import { integrationsRoutes } from '../api/routes'
import { attachHostsToProviders } from './integration-brand'
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
} from './api'

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
  /** Integration module this provider connects under (e.g. `accounting`). */
  module?: string | null
}

export interface ModuleToolCard {
  verb: string
  label: string
  description: string
  kind: 'read' | 'propose'
  exposure?: 'internal' | 'customer' | 'both'
  sensitivity?: string
  min_assurance?: string
}

export interface AttachedMcpToolServer {
  server_id: string
  server_name: string
  provider: string
  server_url?: string
  tools_synced_at?: string | null
  tools: Array<{ name: string; description?: string }>
}

export interface IntegrationModuleRow {
  slug: string
  name: string
  description: string
  status: 'available' | 'coming_soon'
  provider_slugs: string[]
  planned_provider_slugs: string[]
  tool_cards?: ModuleToolCard[]
  verbs?: string[]
  propose_verbs?: string[]
  verb_labels?: string[]
  needs_when?: string
  setup_steps?: string[]
  capability_summary?: string
  setup_path?: string
  workspace_path?: string
  enabled?: boolean
  connected?: boolean
  install_state?: 'not_installed' | 'setup' | 'installed'
  assigned_agent_count?: number
  attached_connection_count?: number
  /** Exact MCP tools from servers attached to this module. */
  attached_mcp_tools?: AttachedMcpToolServer[]
  default_agent_id?: string | null
  /** False when this member is outside the module's user_access selection. */
  user_accessible?: boolean
  tenant_status?:
    | 'not_installed'
    | 'setup'
    | 'installed'
    | 'connected'
    | 'coming_soon'
    | 'off'
    | 'on'
    | 'available'
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
  modules?: IntegrationModuleRow[]
}

export interface AccountingCompanyRow {
  id: string
  name: string
  vendor?: string
  connection_id?: string
  external_id?: string
}

export interface AccountingCompaniesResponse {
  ok: boolean
  code?: string
  message?: string
  companies?: AccountingCompanyRow[]
  connections?: Array<{
    connection_id: string
    vendor: string
    name: string
    ready: boolean
  }>
}

export async function listModuleCompanies(
  moduleSlug = 'accounting',
): Promise<AccountingCompaniesResponse> {
  return apiGet<AccountingCompaniesResponse>(
    integrationsRoutes.platform.moduleCompanies(moduleSlug),
  )
}

export interface ConnectionsListResponse {
  connections: IntegrationConnectionRow[]
}

export type ConnectedSummaryKind = 'inbox' | 'repository' | 'calendar' | 'mcp' | 'app'

export type ConnectedSummaryConnection = IntegrationConnectionRow & {
  provider: string
  kind: ConnectedSummaryKind
  attached_modules: string[]
  eligible_module: string | null
}

export type ConnectedSummaryResponse = {
  connections: ConnectedSummaryConnection[]
  email_outlook: number
  email_gmail: number
  counts: {
    all: number
    inbox: number
    repository: number
    calendar: number
    mcp: number
    app: number
  }
}

export async function fetchConnectedSummary(): Promise<ConnectedSummaryResponse> {
  return apiGet<ConnectedSummaryResponse>(integrationsRoutes.platform.connectedSummary)
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
  const data = await apiGet<ProvidersListResponse>(
    integrationsRoutes.platform.providers,
  )
  const providers = attachHostsToProviders(data.providers ?? [], data.hosts ?? [])
  return { ...data, providers }
}

export async function patchIntegrationModule(
  slug: string,
  body: { enabled?: boolean; action?: 'install' | 'complete_setup' | 'uninstall' },
): Promise<IntegrationModuleRow> {
  const data = await apiPatch<{ module: IntegrationModuleRow }>(
    integrationsRoutes.platform.moduleBySlug(slug),
    body,
  )
  return data.module
}

export interface ModuleAgentRow {
  id: string
  module_slug: string
  agent_id: string
  name: string
  role: string
  is_active: boolean
  is_default: boolean
  /** Company/administration ids this agent may access; null = all. */
  company_ids: string[] | null
  /** Without this flag the agent gets read tools only. */
  can_write: boolean
  created_at: string
  avatar_kind?: string | null
  avatar_icon?: string | null
  avatar_color?: string | null
  avatar_image_url?: string | null
}

export interface ModuleWorkstreamTemplate {
  slug: string
  module_slug: string
  name: string
  description: string
  steps_count: number
  required_agent_roles: string[]
  requires_module_connection: boolean
  problems: string[]
  installable: boolean
  already_installed: boolean
}

export async function listModuleTemplates(
  slug: string,
): Promise<ModuleWorkstreamTemplate[]> {
  const res = await apiGet<{ items: ModuleWorkstreamTemplate[] }>(
    integrationsRoutes.platform.moduleTemplates(slug),
  )
  return res.items
}

export async function installModuleTemplate(
  slug: string,
  templateSlug: string,
): Promise<{ workstream: { id: string; name: string } }> {
  return apiPost(integrationsRoutes.platform.moduleTemplateInstall(slug, templateSlug), {})
}

export type ModuleCaseTypeTemplate = {
  slug: string
  module_slug: string
  name: string
  description: string
  create_mode: string
  requires_verification: boolean
  already_installed: boolean
}

export async function listModuleCaseTypeTemplates(
  slug: string,
): Promise<ModuleCaseTypeTemplate[]> {
  const res = await apiGet<{ items: ModuleCaseTypeTemplate[] }>(
    integrationsRoutes.platform.moduleCaseTypeTemplates(slug),
  )
  return res.items ?? []
}

export async function installModuleCaseTypeTemplate(
  slug: string,
  templateSlug: string,
): Promise<{ case_type: { id: string; name: string } }> {
  return apiPost(integrationsRoutes.platform.moduleCaseTypeTemplateInstall(slug, templateSlug), {})
}

export async function listModuleAgents(slug: string): Promise<ModuleAgentRow[]> {
  return apiGet<ModuleAgentRow[]>(integrationsRoutes.platform.moduleAgents(slug))
}

export async function addModuleAgent(
  slug: string,
  agentId: string,
  isDefault = false,
): Promise<ModuleAgentRow> {
  return apiPost<ModuleAgentRow>(integrationsRoutes.platform.moduleAgents(slug), {
    agent_id: agentId,
    is_default: isDefault,
  })
}

export async function setModuleAgentDefault(
  slug: string,
  agentId: string,
  isDefault: boolean,
): Promise<ModuleAgentRow> {
  return apiPatch<ModuleAgentRow>(integrationsRoutes.platform.moduleAgentById(slug, agentId), {
    is_default: isDefault,
  })
}

export async function removeModuleAgent(slug: string, agentId: string): Promise<void> {
  await apiDelete(integrationsRoutes.platform.moduleAgentById(slug, agentId))
}

export async function updateModuleAgentAccess(
  slug: string,
  agentId: string,
  body: { company_ids?: string[]; clear_company_scope?: boolean; can_write?: boolean },
): Promise<ModuleAgentRow> {
  return apiPatch<ModuleAgentRow>(integrationsRoutes.platform.moduleAgentById(slug, agentId), body)
}

export async function listIntegrationConnections(
  provider?: string,
): Promise<IntegrationConnectionRow[]> {
  const data = await apiGet<ConnectionsListResponse>(
    integrationsRoutes.platform.connections(provider),
  )
  return data.connections ?? []
}

export async function startIntegrationOAuth(
  provider: string,
  returnUrl: string,
  projectId?: string,
): Promise<{ authorize_url: string; provider: string }> {
  return apiGet(integrationsRoutes.platform.oauthStart(provider, returnUrl, projectId))
}

export async function startMcpRemoteOAuth(
  provider: string,
  returnUrl: string,
): Promise<{ authorize_url: string; provider: string; state?: string }> {
  return apiGet(integrationsRoutes.platform.mcpOAuthStart(provider, returnUrl))
}

export async function revokeIntegrationConnection(connectionId: string): Promise<void> {
  await apiDelete(integrationsRoutes.platform.connectionById(connectionId))
}

export async function createApiKeyConnection(input: {
  provider: string
  api_key: string
  display_name?: string
}): Promise<IntegrationConnectionRow> {
  return apiPost<IntegrationConnectionRow>(
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
  auth?: Record<string, unknown>
  use_mock?: boolean
  module_slug?: string
}): Promise<{
  connection: IntegrationConnectionRow
  binding: { id: string; config: unknown }
  discovery?: McpTestResult | null
  mcp_server_id?: string
  verified?: boolean
}> {
  return apiPost(integrationsRoutes.platform.mcpInstall, input)
}

export async function listMcpBindings(): Promise<McpBindingsResponse> {
  return apiGet<McpBindingsResponse>(integrationsRoutes.platform.mcpBindings)
}

export type McpServerRow = {
  id: string
  name: string
  server_url: string
  is_active: boolean
  provider?: string | null
  connection_id?: string | null
  tools: Array<{ name: string; description?: string }>
  tools_synced_at?: string | null
}

export async function listMcpServers(): Promise<McpServerRow[]> {
  return apiGet<McpServerRow[]>(integrationsRoutes.platform.mcpServers)
}

export type McpTestResult = {
  ok: boolean
  server_id: string
  server_name: string
  tool_count: number
  tools: Array<{ name: string; description?: string }>
  error?: string
}

export async function testMcpServer(serverId: string): Promise<McpTestResult> {
  return apiPost<McpTestResult>(integrationsRoutes.platform.mcpTest(serverId), {})
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
