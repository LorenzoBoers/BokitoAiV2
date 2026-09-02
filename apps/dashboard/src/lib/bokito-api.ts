import type { RuntimeAgent } from './workforce-api'
import { APP_API_BASE, AUTH_API_BASE, SETTINGS_API_BASE, WORKFORCE_API_BASE } from './api.config'
import { appRoutes, authRoutes, settingsRoutes, workforceRoutes } from '../api/routes'

export type AuthUser = {
  id: string
  email: string
  display_name: string
  role: string
  is_staff?: boolean
  tenant?: { id: string; slug: string; name: string }
}

export type AuthMeResponse = {
  user: AuthUser
  tenant: { id: string; slug: string; name: string; logo?: string | null }
}

export type CockpitSummary = {
  volume_week: number
  open_decisions: number
  autonomy_rate_pct: number
  avg_feedback_score: number
  csat_score: number | null
  csat_responses: number
  tokens_month: number
  cost_cents_month: number
  time_saved_minutes_week: number
}

export type PushSubscriptionPayload = {
  endpoint: string
  keys: Record<string, string>
}

function resolveBaseUrl(): string {
  if (import.meta.env.DEV) {
    return ''
  }
  const configured = (import.meta.env.VITE_BOKITO_API_URL || '').replace(/\/$/, '')
  return configured
}

function parseBokitoErrorBody(body: unknown): string {
  const o = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  if (typeof o.message === 'string' && o.message.trim()) return o.message.trim()
  const nested = o.error && typeof o.error === 'object' ? (o.error as Record<string, unknown>) : null
  if (nested && typeof nested.message === 'string' && nested.message.trim()) return nested.message.trim()
  if (typeof o.detail === 'string' && o.detail.trim()) return o.detail.trim()
  return 'Unknown error'
}

async function bokitoFetch<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${resolveBaseUrl()}${path}`, { ...init, headers, credentials: 'include' })
  if (!res.ok) {
    const text = await res.text()
    try {
      throw new Error(parseBokitoErrorBody(JSON.parse(text)))
    } catch (err) {
      if (err instanceof Error && err.message !== 'Unknown error') throw err
      throw new Error(text.trim() || `HTTP ${res.status}`)
    }
  }
  return res.json() as Promise<T>
}

export async function bokitoLogin(email: string, password: string) {
  return bokitoFetch<{ access_token: string; user: AuthMeResponse['user']; tenant: AuthMeResponse['tenant'] }>(
    `${AUTH_API_BASE}${authRoutes.proxy.login}`,
    null,
    { method: 'POST', body: JSON.stringify({ email, password }) },
  )
}

export async function bokitoMe(token: string) {
  return bokitoFetch<AuthMeResponse>(`${AUTH_API_BASE}${authRoutes.proxy.me}`, token)
}

export async function bokitoGetCockpitSummary(token: string) {
  return bokitoFetch<CockpitSummary>(`${APP_API_BASE}${appRoutes.cockpit.summary}`, token)
}

export type CockpitActivityEvent = {
  id?: string
  /** 'agent_run' for run events, 'audit' for human actions. */
  kind: string
  event_type: string
  message: string
  /** Acting user (audit events) or agent name (run events). */
  actor_name?: string | null
  created_at: string
  /** Deep-link targets resolved by the backend. */
  run_id?: string | null
  agent_id?: string | null
  signal_id?: string | null
  resource_type?: string | null
  resource_id?: string | null
}

export async function bokitoGetCockpitActivity(token: string, limit = 50, before?: string) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (before) params.set('before', before)
  return bokitoFetch<CockpitActivityEvent[]>(
    `${APP_API_BASE}${appRoutes.cockpit.activity(params)}`,
    token,
  )
}

// Assistant conversation helpers live in lib/signals-api.ts (Signals API).

// Model/provider types and API — see lib/models-api.ts
export type {
  CatalogModel,
  TenantModelPrefs,
  TenantModelsPayload,
  PlatformKeysPayload,
} from './models-api'

export {
  getTenantModels as bokitoGetTenantModels,
  setAgentModel as bokitoSetAgentModel,
  staffListModels as bokitoStaffListModels,
  staffUpsertModel as bokitoStaffUpsertModel,
  staffDeleteModel as bokitoStaffDeleteModel,
  staffGetPlatformKeys as bokitoStaffGetPlatformKeys,
  staffSetPlatformKey as bokitoStaffSetPlatformKey,
  staffDeletePlatformKey as bokitoStaffDeletePlatformKey,
  staffSetMarkup as bokitoStaffSetMarkup,
} from './models-api'

export async function bokitoUpdateTenantModels(
  token: string,
  patch: Partial<{ default_chat: string; default_embedding: string; allowed_chat: string[] }>,
) {
  return bokitoFetch<import('./models-api').TenantModelsPayload>(
    `${SETTINGS_API_BASE}${settingsRoutes.models.list}`,
    token,
    {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

export type UsageModelRow = {
  model: string
  provider: string
  key_source: string
  billable: boolean
  tokens: number
  provider_cost_micros: number
  customer_cost_micros: number
}

export type UsageAgentRow = {
  agent_id: string | null
  agent_name: string
  tokens: number
  customer_cost_micros: number
}

export type UsageUserRow = {
  user_id: string | null
  user_name: string
  tokens: number
  customer_cost_micros: number
}

export type UsageBreakdown = {
  days: number
  total_tokens: number
  total_provider_cost_micros: number
  total_customer_cost_micros: number
  by_model: UsageModelRow[]
  by_agent: UsageAgentRow[]
  by_user: UsageUserRow[]
}

export async function bokitoGetUsageBreakdown(token: string, days = 30) {
  return bokitoFetch<UsageBreakdown>(`${APP_API_BASE}${appRoutes.cockpit.usage(days)}`, token)
}

export type SpendPeriodStatus = {
  used: number
  cap: number | null
  ratio: number
  exceeded: boolean
}

export type SpendBudget = {
  config: {
    daily_token_cap: number | null
    monthly_customer_micros_cap: number | null
  }
  status: {
    daily_tokens: SpendPeriodStatus
    monthly_customer_micros: SpendPeriodStatus
    blocked: boolean
  }
}

export async function bokitoGetBudget(token: string) {
  return bokitoFetch<SpendBudget>(`${APP_API_BASE}${appRoutes.cockpit.budget}`, token)
}

export async function bokitoPatchBudget(
  token: string,
  updates: Partial<SpendBudget['config']>,
) {
  return bokitoFetch<SpendBudget>(`${APP_API_BASE}${appRoutes.cockpit.budget}`, token, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
}

export type CreateAgentInput = {
  name: string
  role?: string
  system_prompt?: string
  model?: string
  chat_access?: 'everyone' | 'selected' | 'nobody'
}

export async function bokitoCreateAgent(token: string, input: CreateAgentInput) {
  return bokitoFetch<{ ok: boolean; agent: RuntimeAgent }>(
    `${WORKFORCE_API_BASE}${workforceRoutes.agents.list}`,
    token,
    {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function bokitoUpdateAgent(
  token: string,
  agentId: string,
  input: {
    name?: string
    system_prompt?: string
    email_signature_html?: string
    email_signature_text?: string
    reply_send_as?: 'user' | 'agent'
    avatar_kind?: string | null
    avatar_icon?: string | null
    avatar_color?: string | null
    avatar_image_url?: string | null
  },
) {
  return bokitoFetch<{ ok: boolean; agent: RuntimeAgent }>(
    `${WORKFORCE_API_BASE}${workforceRoutes.agents.detail(agentId)}`,
    token,
    { method: 'PATCH', body: JSON.stringify(input) },
  )
}

export async function bokitoSubscribePush(token: string, subscription: PushSubscriptionPayload) {
  return bokitoFetch<{ ok: boolean; user_id: string }>(
    `${APP_API_BASE}${appRoutes.push.subscribe}`,
    token,
    {
    method: 'POST',
    body: JSON.stringify(subscription),
  })
}

export async function bokitoUnsubscribePush(token: string, endpoint: string) {
  return bokitoFetch<{ ok: boolean; removed: number }>(
    `${APP_API_BASE}${appRoutes.push.unsubscribe}`,
    token,
    {
    method: 'POST',
    body: JSON.stringify({ endpoint }),
  })
}

export async function bokitoGetVapidPublicKey(token: string) {
  return bokitoFetch<{ public_key: string }>(
    `${APP_API_BASE}${appRoutes.push.vapidPublicKey}`,
    token,
  )
}
