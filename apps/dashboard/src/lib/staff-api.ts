import { authRoutes } from '../api/routes/auth.routes'
import { AUTH_API_BASE } from './api.config'
import type { AuthSessionResponse } from './api'
import { buildAuthHeaders, requireAccessToken, apiPostAuth } from './api'

export interface StaffTenantOption {
  id: string
  slug: string
  name: string
}

export async function listStaffTenants(token?: string): Promise<StaffTenantOption[]> {
  const resolved = requireAccessToken(token)
  const res = await fetch(`${AUTH_API_BASE}${authRoutes.staff.tenants}`, {
    method: 'GET',
    credentials: 'include',
    headers: buildAuthHeaders(resolved, false),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Unknown error' }))
    const message =
      typeof err === 'object' && err && 'error' in err && typeof (err as { error?: { message?: string } }).error?.message === 'string'
        ? (err as { error: { message: string } }).error.message
        : typeof err === 'object' && err && 'message' in err && typeof (err as { message?: string }).message === 'string'
          ? (err as { message: string }).message
          : `HTTP ${res.status}`
    throw new Error(message)
  }
  const payload = await res.json()
  if (!Array.isArray(payload)) return []
  return payload
    .map((row) => {
      const item = row && typeof row === 'object' ? (row as Record<string, unknown>) : null
      if (!item) return null
      const id = typeof item.id === 'string' ? item.id : String(item.id ?? '')
      const slug = typeof item.slug === 'string' ? item.slug : ''
      const name = typeof item.name === 'string' ? item.name : slug
      if (!id || !slug) return null
      return { id, slug, name } satisfies StaffTenantOption
    })
    .filter((row): row is StaffTenantOption => row !== null)
}

export async function switchStaffTenant(tenantId: string, token?: string): Promise<AuthSessionResponse> {
  return apiPostAuth<AuthSessionResponse>(
    authRoutes.staff.switchTenant,
    { tenant_id: tenantId },
    token,
  )
}
