import { staffRoutes } from '../api/routes'
import { staffDelete, staffGet, staffPatch } from './api'

export type StaffOpsTenant = {
  id: string
  slug: string
  name: string
  support_allowed: boolean
  custom_models: boolean
  member_count: number
  created_at: string | null
}

export type StaffOpsUser = {
  id: string
  email: string
  display_name: string
  is_staff: boolean
  is_active: boolean
  membership_count: number
  created_at: string | null
}

export type StaffOpsAccessLog = {
  id: string
  action: string
  created_at: string | null
  staff_user_id: string
  staff_email: string | null
  tenant_id: string
  tenant_slug: string | null
  tenant_name: string | null
}

export type StaffOpsDirectory = {
  environment: string
  api_url: string
  tenant_count: number
  user_count: number
  tenants: StaffOpsTenant[]
  users: StaffOpsUser[]
  access_logs: StaffOpsAccessLog[]
}

export async function getStaffOpsDirectory(
  token?: string,
  q?: string,
): Promise<StaffOpsDirectory> {
  const params = new URLSearchParams()
  if (q?.trim()) params.set('q', q.trim())
  const suffix = params.toString() ? `?${params.toString()}` : ''
  return staffGet<StaffOpsDirectory>(`${staffRoutes.ops}${suffix}`, token)
}

export async function deleteStaffOpsTenant(
  token: string,
  tenantId: string,
  confirmSlug: string,
): Promise<{ ok: boolean; id: string; slug: string; name: string }> {
  return staffDelete(staffRoutes.opsTenant(tenantId), token, {
    confirm_slug: confirmSlug,
  }) as Promise<{ ok: boolean; id: string; slug: string; name: string }>
}

export async function setStaffTenantCustomModels(
  token: string,
  tenantId: string,
  enabled: boolean,
): Promise<{ ok: boolean; tenant_id: string; custom_models: Record<string, boolean> }> {
  return staffPatch(staffRoutes.opsTenantFeatures(tenantId), { custom_models: enabled }, token)
}
