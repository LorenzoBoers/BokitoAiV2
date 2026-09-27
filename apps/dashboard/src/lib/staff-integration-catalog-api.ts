import { STAFF_API_BASE } from './api.config'
import { staffRoutes } from '../api/routes'
import { apiDelete, apiGet, apiPatch, apiPost } from './api'

export type CatalogHostRow = {
  slug: string
  name: string
  brand_color: string
  initials: string
  logo_domain?: string | null
  simpleicons?: string | null
  description?: string | null
}

export type CatalogProviderRow = {
  slug: string
  static_id: string
  host_slug: string
  name: string
  description: string
  category: string
  category_nl: string
  auth_type: string
  mcp_remote_url: string
  mcp_transport: string
  status: string
  module?: string | null
  sort_order: number
  enabled: boolean
}

export async function listCatalogHosts(): Promise<CatalogHostRow[]> {
  const data = await apiGet<{ items: CatalogHostRow[] }>(
    `${STAFF_API_BASE}${staffRoutes.integrationCatalog.hosts}`,
  )
  return data.items ?? []
}

export async function createCatalogHost(
  body: Partial<CatalogHostRow> & { slug: string; name: string },
): Promise<CatalogHostRow> {
  return apiPost<CatalogHostRow>(
    `${STAFF_API_BASE}${staffRoutes.integrationCatalog.hosts}`,
    body,
  )
}

export async function listCatalogProviders(): Promise<CatalogProviderRow[]> {
  const data = await apiGet<{ items: CatalogProviderRow[] }>(
    `${STAFF_API_BASE}${staffRoutes.integrationCatalog.providers}`,
  )
  return data.items ?? []
}

export async function createCatalogProvider(
  body: Partial<CatalogProviderRow> & { slug: string; name: string; host_slug: string },
): Promise<CatalogProviderRow> {
  return apiPost<CatalogProviderRow>(
    `${STAFF_API_BASE}${staffRoutes.integrationCatalog.providers}`,
    body,
  )
}

export async function patchCatalogProvider(
  slug: string,
  body: Partial<CatalogProviderRow>,
): Promise<CatalogProviderRow> {
  return apiPatch<CatalogProviderRow>(
    `${STAFF_API_BASE}${staffRoutes.integrationCatalog.providerBySlug(slug)}`,
    body,
  )
}

export async function deleteCatalogProvider(slug: string): Promise<void> {
  await apiDelete(`${STAFF_API_BASE}${staffRoutes.integrationCatalog.providerBySlug(slug)}`)
}
