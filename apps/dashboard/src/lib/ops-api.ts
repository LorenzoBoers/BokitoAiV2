import { staffRoutes } from '../api/routes'
import {
  staffDelete,
  staffGet,
  staffPatch,
  staffPost,
  staffPut,
  type AuthSessionResponse,
} from './api'

export type StaffOpsTenant = {
  id: string
  slug: string
  name: string
  support_allowed: boolean
  custom_models: boolean
  member_count: number
  created_at: string | null
}

export type StaffOpsUserMembership = {
  tenant_id: string
  slug: string
  name: string
  role: string
  support_allowed: boolean
}

export type StaffOpsUser = {
  id: string
  email: string
  display_name: string
  is_staff: boolean
  is_active: boolean
  membership_count: number
  memberships: StaffOpsUserMembership[]
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

export async function impersonateStaffOpsUser(
  token: string,
  userId: string,
  tenantId?: string,
): Promise<AuthSessionResponse> {
  const body: { tenant_id?: string } = {}
  if (tenantId) body.tenant_id = tenantId
  return staffPost<AuthSessionResponse>(staffRoutes.opsUserImpersonate(userId), body, token)
}

export type StaffTimeSavedWeight = {
  action: string
  mode: 'autonomous' | 'assisted' | 'manual' | string
  minutes: number
  counts_as_saved: boolean
}

export async function getStaffTimeSavedWeights(
  token: string,
): Promise<{ actions: StaffTimeSavedWeight[] }> {
  return staffGet<{ actions: StaffTimeSavedWeight[] }>(staffRoutes.opsTimeSavedWeights, token)
}

export async function putStaffTimeSavedWeights(
  token: string,
  minutes: Record<string, number>,
): Promise<{ ok: boolean; actions: StaffTimeSavedWeight[] }> {
  return staffPut<{ ok: boolean; actions: StaffTimeSavedWeight[] }>(
    staffRoutes.opsTimeSavedWeights,
    { minutes },
    token,
  )
}

export type StaffVoiceModelChoice = {
  id: string
  label: string
  tts_model: string
  realtime_model: string
}

export type StaffVoiceModel = {
  ok?: boolean
  tier: string
  tts_model: string
  realtime_model: string
  choices: StaffVoiceModelChoice[]
}

export async function getStaffVoiceModel(token: string): Promise<StaffVoiceModel> {
  return staffGet<StaffVoiceModel>(staffRoutes.opsVoiceModel, token)
}

export async function putStaffVoiceModel(
  token: string,
  tier: string,
): Promise<StaffVoiceModel> {
  return staffPut<StaffVoiceModel>(staffRoutes.opsVoiceModel, { tier }, token)
}

export type StaffOpsUsageSpend = {
  daily_tokens_used: number
  daily_token_cap: number | null
  monthly_customer_micros_used: number
  monthly_customer_micros_cap: number | null
  blocked: boolean
}

export type StaffOpsUsageTenantRow = {
  tenant_id: string
  slug: string
  name: string
  tokens: number
  provider_cost_micros: number
  customer_cost_micros: number
  margin_micros: number
  margin_pct: number | null
  calls: number
  price_book_slug: string | null
  price_book_name: string | null
  spend: StaffOpsUsageSpend
}

export type StaffOpsUsageOverview = {
  period: string
  from: string
  to: string
  totals: {
    tokens: number
    provider_cost_micros: number
    customer_cost_micros: number
    margin_micros: number
    provider_usd: number
    customer_usd: number
    margin_usd: number
  }
  tenants: StaffOpsUsageTenantRow[]
}

export type StaffOpsUsageDetail = {
  tenant_id: string
  slug: string
  name: string
  period: string
  from: string
  to: string
  price_book: { id: string; slug: string; name: string }
  totals: {
    tokens: number
    tokens_in: number
    tokens_out: number
    tokens_in_uncached: number
    tokens_cache_write: number
    tokens_cache_read: number
    provider_cost_micros: number
    customer_cost_micros: number
    margin_micros: number
    calls: number
  }
  by_token_kind: { kind: string; tokens: number }[]
  by_model: {
    model: string
    provider: string
    backing_provider: string
    backing_model: string
    tokens: number
    provider_cost_micros: number
    customer_cost_micros: number
    margin_micros: number
    calls: number
  }[]
  by_call_type: {
    call_type: string
    tokens: number
    units: number
    provider_cost_micros: number
    customer_cost_micros: number
    calls: number
  }[]
  by_backing_provider: {
    provider: string
    tokens: number
    provider_cost_micros: number
    customer_cost_micros: number
    calls: number
  }[]
  by_day: {
    day: string
    tokens: number
    provider_cost_micros: number
    customer_cost_micros: number
  }[]
  spend: StaffOpsUsageSpend
}

export type StaffPriceBookRule = {
  id: string
  match_kind: string
  match_value: string
  pricing_mode: string
  list_input_cents_per_mtok: number | null
  list_output_cents_per_mtok: number | null
  markup_multiplier: number | null
  unit_list_micros: number | null
  provider_unit_micros: number | null
  priority: number
  version: number
}

export type StaffPriceBook = {
  id: string
  slug: string
  name: string
  is_default: boolean
  currency: string
  rules: StaffPriceBookRule[]
}

export async function getStaffOpsUsage(
  token: string,
  period: string = '30d',
): Promise<StaffOpsUsageOverview> {
  return staffGet<StaffOpsUsageOverview>(staffRoutes.opsUsage(period), token)
}

export async function getStaffOpsUsageTenant(
  token: string,
  tenantId: string,
  period: string = '30d',
): Promise<StaffOpsUsageDetail> {
  return staffGet<StaffOpsUsageDetail>(staffRoutes.opsUsageTenant(tenantId, period), token)
}

export async function getStaffPriceBooks(
  token: string,
): Promise<{ books: StaffPriceBook[] }> {
  return staffGet<{ books: StaffPriceBook[] }>(staffRoutes.opsPriceBooks, token)
}

export async function putStaffTenantPriceBook(
  token: string,
  tenantId: string,
  priceBookId: string,
  notes?: string,
): Promise<{
  ok: boolean
  tenant_id: string
  price_book_id: string
  price_book_slug: string | null
  price_book_name: string | null
}> {
  return staffPut(staffRoutes.opsTenantPriceBook(tenantId), {
    price_book_id: priceBookId,
    notes: notes || '',
  }, token)
}
