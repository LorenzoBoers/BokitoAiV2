import type { RuntimeAgent } from './workforce-api'

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

export type Conversation = {
  id: string
  title: string
  channel?: string
  audience?: string
  ai_paused?: boolean
  updated_at: string
}

export type ChatDecisionOption = {
  id: string
  label?: string
  action_type?: string
  /** Integration provider slug on `setup_integration` options (brand logo + deep-link). */
  provider?: string | null
  /** Module slug when the card should open `/modules/:slug`. */
  module?: string | null
}

export type ChatDecision = {
  id: string
  status: string
  title?: string | null
  summary?: string | null
  options: ChatDecisionOption[]
  chosen_option_id?: string | null
  resolved_at?: string | null
}

export type ChatMessage = {
  id: string
  role: string
  kind?: string
  content: string
  created_at?: string
  decision_request_id?: string | null
  decision?: ChatDecision | null
  certainty?: number | null
  auto_sent?: boolean
  attachments?: unknown[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
  }
  steps?: Array<{
    step_type?: string
    stepType?: string
    name?: string
    payload?: Record<string, unknown>
  }>
  thinking?: {
    text?: string
    ms?: number
    budget?: number
  }
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

async function bokitoFetch<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${resolveBaseUrl()}${path}`, { ...init, headers, credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<T>
}

export async function bokitoLogin(email: string, password: string) {
  return bokitoFetch<{ access_token: string; user: AuthMeResponse['user']; tenant: AuthMeResponse['tenant'] }>(
    '/api/auth/login',
    null,
    { method: 'POST', body: JSON.stringify({ email, password }) },
  )
}

export async function bokitoMe(token: string) {
  return bokitoFetch<AuthMeResponse>('/api/auth/me', token)
}

export async function bokitoGetCockpitSummary(token: string) {
  return bokitoFetch<CockpitSummary>('/api/cockpit/summary', token)
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
  return bokitoFetch<CockpitActivityEvent[]>(`/api/cockpit/activity?${params}`, token)
}

/** A conversation row enriched with the agent it targets. */
export type ConversationWithAgent = Conversation & {
  agent_id?: string | null
  agent_name?: string | null
  /** Company agents only going forward; `personal` may still appear on legacy rows. */
  agent_kind?: 'company' | 'personal' | null
}

export async function bokitoListConversations(token: string, channel?: string) {
  const query = channel ? `?channel=${encodeURIComponent(channel)}` : ''
  return bokitoFetch<ConversationWithAgent[]>(`/api/chat/conversations${query}`, token)
}

/** A chat target: a company agent the user is permitted to message. */
export type ChatTarget = {
  id: string
  name: string
  kind: 'company'
  role: string
  runtime_status: string
  is_default: boolean
}

export async function bokitoListChatTargets(token: string) {
  return bokitoFetch<{ items: ChatTarget[]; default_agent_id: string | null }>(
    '/api/chat/targets',
    token,
  )
}

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
  return bokitoFetch<import('./models-api').TenantModelsPayload>('/api/settings/models', token, {
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
  return bokitoFetch<UsageBreakdown>(`/api/cockpit/usage?days=${days}`, token)
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
  return bokitoFetch<SpendBudget>('/api/cockpit/budget', token)
}

export async function bokitoPatchBudget(
  token: string,
  updates: Partial<SpendBudget['config']>,
) {
  return bokitoFetch<SpendBudget>('/api/cockpit/budget', token, {
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
  return bokitoFetch<{ ok: boolean; agent: RuntimeAgent }>('/api/workforce/agents', token, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function bokitoUpdateAgent(
  token: string,
  agentId: string,
  input: { name?: string; system_prompt?: string; email_signature_html?: string },
) {
  return bokitoFetch<{ ok: boolean; agent: RuntimeAgent }>(
    `/api/workforce/agents/${agentId}`,
    token,
    { method: 'PATCH', body: JSON.stringify(input) },
  )
}

export async function bokitoListMessages(token: string, conversationId: string) {
  return bokitoFetch<ChatMessage[]>(`/api/chat/conversations/${conversationId}/messages`, token)
}

export async function bokitoSendMessage(token: string, conversationId: string, content: string) {
  return bokitoFetch<{ message: ChatMessage }>(`/api/chat/conversations/${conversationId}/messages`, token, {
    method: 'POST',
    body: JSON.stringify({ content }),
  })
}

export async function bokitoCreateConversation(
  token: string,
  title = 'New conversation',
  agentId?: string | null,
  options?: {
    /** Ground the conversation in a customer thread (Ask assistant). */
    contextSignalId?: string
  },
) {
  const body: Record<string, unknown> = { title }
  if (agentId) body.agent_id = agentId
  if (options?.contextSignalId) body.context_signal_id = options.contextSignalId
  return bokitoFetch<{
    id: string
    title: string
    channel: string
    agent_id?: string
    agent_name?: string
    agent_kind?: string
  }>('/api/chat/conversations', token, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function bokitoRenameConversation(token: string, conversationId: string, title: string) {
  return bokitoFetch<{ id: string; title: string }>(`/api/chat/conversations/${conversationId}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  })
}

export async function bokitoDeleteConversation(token: string, conversationId: string) {
  return bokitoFetch<{ ok: boolean }>(`/api/chat/conversations/${conversationId}`, token, {
    method: 'DELETE',
  })
}

/**
 * Send a message and stream the assistant reply over SSE.
 * Calls `onDelta` for each text chunk; optional `onThinking` for reasoning deltas.
 */
export async function bokitoStreamMessage(
  token: string,
  conversationId: string,
  content: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  onThinking?: (text: string) => void,
): Promise<string> {
  const res = await fetch(`${resolveBaseUrl()}/api/chat/conversations/${conversationId}/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    credentials: 'include',
    body: JSON.stringify({ content }),
    signal,
  })
  if (!res.ok || !res.body) throw new Error(await res.text())

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalText = ''
  let eventName = ''

  const handleEvent = (name: string, data: string) => {
    try {
      const payload = JSON.parse(data) as { text?: string }
      if (name === 'thinking' && payload.text) {
        onThinking?.(payload.text)
      } else if (name === 'delta' && payload.text) {
        onDelta(payload.text)
      } else if (name === 'done') {
        finalText = payload.text ?? finalText
      }
    } catch {
      // skip malformed frames
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx = buffer.indexOf('\n')
    while (idx !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, '')
      buffer = buffer.slice(idx + 1)
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        handleEvent(eventName, line.slice(5).trim())
      } else if (line === '') {
        eventName = ''
      }
      idx = buffer.indexOf('\n')
    }
  }
  return finalText
}

export async function bokitoSubscribePush(token: string, subscription: PushSubscriptionPayload) {
  return bokitoFetch<{ ok: boolean; user_id: string }>('/api/push/subscribe', token, {
    method: 'POST',
    body: JSON.stringify(subscription),
  })
}

export async function bokitoUnsubscribePush(token: string, endpoint: string) {
  return bokitoFetch<{ ok: boolean; removed: number }>('/api/push/unsubscribe', token, {
    method: 'POST',
    body: JSON.stringify({ endpoint }),
  })
}

export async function bokitoGetVapidPublicKey(token: string) {
  return bokitoFetch<{ public_key: string }>('/api/push/vapid-public-key', token)
}
