import { appRoutes } from '../api/routes'
import { apiGet } from './api'

export interface TenantDocRow {
  id: string
  name: string
  source_url?: string | null
  updated_at?: string | null
  status?: string
}

export async function listTenantDocs(): Promise<TenantDocRow[]> {
  try {
    const data = await apiGet<TenantDocRow[] | { items: TenantDocRow[] }>(appRoutes.docs.list)
    return Array.isArray(data) ? data : data.items ?? []
  } catch {
    return []
  }
}
