import { appRoutes } from '../api/routes'
import { xanoGet } from './xano'

export interface TenantDocRow {
  id: string
  name: string
  source_url?: string | null
  updated_at?: string | null
  status?: string
}

export async function listTenantDocs(): Promise<TenantDocRow[]> {
  try {
    const data = await xanoGet<TenantDocRow[] | { items: TenantDocRow[] }>(appRoutes.docs.list)
    return Array.isArray(data) ? data : data.items ?? []
  } catch {
    return []
  }
}
