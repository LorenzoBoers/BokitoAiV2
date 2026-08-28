import { integrationsRoutes } from '../api/routes'
import { apiDelete, apiGet, apiPatch, apiPost } from './api'

export type ModuleConnectionCompany = {
  id?: string
  name?: string
  connection_id?: string
  vendor?: string
  [key: string]: unknown
}

export type ModuleConnectionRow = {
  id: string
  kind: string
  provider: string
  vendor: string
  display_name: string
  ready: boolean
  is_default: boolean
  default_company_id?: string | null
  companies: ModuleConnectionCompany[]
}

export type ModuleConnectionsResponse = {
  module_slug: string
  default_connection_id?: string | null
  connections: ModuleConnectionRow[]
  prefs?: {
    default_connection_id?: string | null
    default_company_by_connection?: Record<string, string>
  }
}

export type ModuleSourceRow = {
  id: string
  tenant_id: string
  module_slug: string
  kind: string
  origin: 'platform' | 'tenant' | string
  title: string
  url: string
  status: string
  auto_reindex: boolean
  workspace_doc_id?: string | null
  last_synced_at?: string | null
  sync_error?: string
  created_at?: string | null
  updated_at?: string | null
}

export async function listModuleConnections(slug: string): Promise<ModuleConnectionsResponse> {
  return apiGet(integrationsRoutes.platform.moduleConnections(slug))
}

export async function setModulePrefs(
  slug: string,
  body: {
    default_connection_id?: string | null
    default_company_id?: string | null
    clear_default_connection?: boolean
  },
): Promise<{ prefs: Record<string, unknown> }> {
  return apiPatch(integrationsRoutes.platform.modulePrefs(slug), body)
}

export async function renameModuleConnection(
  slug: string,
  connectionId: string,
  displayName: string,
): Promise<{ connection: { id: string; display_name: string; kind: string } }> {
  return apiPatch(integrationsRoutes.platform.moduleConnectionById(slug, connectionId), {
    display_name: displayName,
  })
}

export async function listModuleSources(slug: string): Promise<{ sources: ModuleSourceRow[] }> {
  return apiGet(integrationsRoutes.platform.moduleSources(slug))
}

export async function createModuleSource(
  slug: string,
  body: { title?: string; url: string; auto_reindex?: boolean },
): Promise<{ source: ModuleSourceRow }> {
  return apiPost(integrationsRoutes.platform.moduleSources(slug), body)
}

export async function reindexModuleSource(
  slug: string,
  sourceId: string,
): Promise<{ source: ModuleSourceRow; queued?: boolean }> {
  return apiPost(integrationsRoutes.platform.moduleSourceReindex(slug, sourceId), {})
}

export async function setModuleSourceDisabled(
  slug: string,
  sourceId: string,
  disabled: boolean,
): Promise<{ source: ModuleSourceRow }> {
  return apiPatch(integrationsRoutes.platform.moduleSourceById(slug, sourceId), { disabled })
}

export async function deleteModuleSource(slug: string, sourceId: string): Promise<void> {
  await apiDelete(integrationsRoutes.platform.moduleSourceById(slug, sourceId))
}

/** Append create_new flag so OAuth/API flows can add another registration. */
export function withCreateNewRegistration(returnUrl: string): string {
  const url = new URL(returnUrl, window.location.origin)
  url.searchParams.set('bokito_create_new', '1')
  return url.toString()
}
