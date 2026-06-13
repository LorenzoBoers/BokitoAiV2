import type {
  AuthMeResponse,
  ChatMessage,
  CockpitSummary,
  Conversation,
  PushSubscriptionPayload,
  TenantAppearance,
} from '@bokito/messenger-ui'
import type { ApiConfig } from '@bokito/messenger-ui'
import type { RuntimeAgent } from './workforce-api'

export type {
  AuthMeResponse,
  ChatMessage,
  CockpitSummary,
  Conversation,
  PushSubscriptionPayload,
  TenantAppearance,
}

function resolveBaseUrl(): string {
  if (import.meta.env.DEV) {
    return ''
  }
  const configured = (import.meta.env.VITE_BOKITO_API_URL || '').replace(/\/$/, '')
  return configured
}

export function createBokitoApiConfig(getToken: () => string | null): ApiConfig {
  return {
    baseUrl: resolveBaseUrl(),
    getToken,
  }
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
  kind: string
  event_type: string
  message: string
  created_at: string
}

export async function bokitoGetCockpitActivity(token: string, limit = 50) {
  return bokitoFetch<CockpitActivityEvent[]>(`/api/cockpit/activity?limit=${limit}`, token)
}

/** A conversation row enriched with the agent it targets. */
export type ConversationWithAgent = Conversation & {
  agent_id?: string | null
  agent_name?: string | null
  agent_kind?: 'personal' | 'company' | null
}

export async function bokitoListConversations(token: string, channel?: string) {
  const query = channel ? `?channel=${encodeURIComponent(channel)}` : ''
  return bokitoFetch<ConversationWithAgent[]>(`/api/chat/conversations${query}`, token)
}

/** A chat target: the user's personal assistant or a permitted company agent. */
export type ChatTarget = {
  id: string
  name: string
  kind: 'personal' | 'company'
  role: string
  runtime_status: string
  is_default: boolean
}

export async function bokitoListChatTargets(token: string) {
  return bokitoFetch<{ items: ChatTarget[]; default_agent_id: string }>('/api/chat/targets', token)
}

export type MyAssistant = {
  agent: { id: string; name: string; instructions: string; model: string; kind: string }
  default_chat_agent_id: string
}

export async function bokitoGetMyAssistant(token: string) {
  return bokitoFetch<MyAssistant>('/api/me/assistant', token)
}

export async function bokitoPatchMyAssistant(
  token: string,
  patch: { name?: string; instructions?: string; default_chat_agent_id?: string },
) {
  return bokitoFetch<MyAssistant>('/api/me/assistant', token, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export type LlmProvider = 'anthropic' | 'openai'

export type LlmKeyStatus = {
  provider: LlmProvider
  is_set: boolean
  last4: string
  updated_at: string | null
}

export type LlmKeysStatus = {
  providers: LlmKeyStatus[]
  chat_mode: 'live' | 'mock'
  embeddings_mode: 'live' | 'mock'
}

export async function bokitoGetLlmKeys(token: string) {
  return bokitoFetch<LlmKeysStatus>('/api/settings/llm-keys', token)
}

export async function bokitoSetLlmKey(token: string, provider: LlmProvider, apiKey: string) {
  return bokitoFetch<LlmKeysStatus>(`/api/settings/llm-keys/${provider}`, token, {
    method: 'PUT',
    body: JSON.stringify({ api_key: apiKey }),
  })
}

export async function bokitoDeleteLlmKey(token: string, provider: LlmProvider) {
  return bokitoFetch<LlmKeysStatus>(`/api/settings/llm-keys/${provider}`, token, {
    method: 'DELETE',
  })
}

export type CatalogModel = {
  slug: string
  provider: string
  kind: 'chat' | 'embedding'
  model_id: string
  display_name: string
  context_window: number
  input_cost_per_mtok_cents: number
  output_cost_per_mtok_cents: number
  supports_tools: boolean
  supports_vision: boolean
  enabled: boolean
  is_default_chat: boolean
  is_default_embedding: boolean
  id?: string
  sort_order?: number
}

export type TenantModelPrefs = {
  default_chat: string
  default_embedding: string
  allowed_chat: string[]
}

export type TenantModelsPayload = {
  models: CatalogModel[]
  prefs: TenantModelPrefs
  byok: LlmKeyStatus[]
  billable_providers: string[]
}

export async function bokitoGetTenantModels(token: string) {
  return bokitoFetch<TenantModelsPayload>('/api/settings/models', token)
}

export async function bokitoUpdateTenantModels(
  token: string,
  patch: Partial<TenantModelPrefs>,
) {
  return bokitoFetch<TenantModelsPayload>('/api/settings/models', token, {
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

export type UsageBreakdown = {
  days: number
  total_tokens: number
  total_provider_cost_micros: number
  total_customer_cost_micros: number
  by_model: UsageModelRow[]
  by_agent: UsageAgentRow[]
}

export async function bokitoGetUsageBreakdown(token: string, days = 30) {
  return bokitoFetch<UsageBreakdown>(`/api/cockpit/usage?days=${days}`, token)
}

export async function bokitoSetAgentModel(token: string, agentId: string, model: string) {
  return bokitoFetch<{ ok: boolean; agent: Record<string, unknown> }>(
    `/api/workforce/agents/${agentId}/model`,
    token,
    { method: 'PATCH', body: JSON.stringify({ model }) },
  )
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
  input: { name?: string; system_prompt?: string },
) {
  return bokitoFetch<{ ok: boolean; agent: RuntimeAgent }>(
    `/api/workforce/agents/${agentId}`,
    token,
    { method: 'PATCH', body: JSON.stringify(input) },
  )
}

// --- Staff catalog admin ---

export type PlatformKeysPayload = {
  providers: LlmKeyStatus[]
  markup?: number
}

export async function bokitoStaffListModels(token: string) {
  return bokitoFetch<{ items: CatalogModel[] }>('/api/staff/models', token)
}

export async function bokitoStaffUpsertModel(
  token: string,
  body: Partial<CatalogModel>,
  modelId?: string,
) {
  const path = modelId ? `/api/staff/models/${modelId}` : '/api/staff/models'
  return bokitoFetch<CatalogModel>(path, token, {
    method: modelId ? 'PATCH' : 'POST',
    body: JSON.stringify(body),
  })
}

export async function bokitoStaffDeleteModel(token: string, modelId: string) {
  return bokitoFetch<{ ok: boolean }>(`/api/staff/models/${modelId}`, token, {
    method: 'DELETE',
  })
}

export async function bokitoStaffGetPlatformKeys(token: string) {
  return bokitoFetch<PlatformKeysPayload>('/api/staff/platform-keys', token)
}

export async function bokitoStaffSetPlatformKey(token: string, provider: LlmProvider, apiKey: string) {
  return bokitoFetch<PlatformKeysPayload>(`/api/staff/platform-keys/${provider}`, token, {
    method: 'PUT',
    body: JSON.stringify({ api_key: apiKey }),
  })
}

export async function bokitoStaffDeletePlatformKey(token: string, provider: LlmProvider) {
  return bokitoFetch<PlatformKeysPayload>(`/api/staff/platform-keys/${provider}`, token, {
    method: 'DELETE',
  })
}

export async function bokitoStaffSetMarkup(token: string, multiplier: number) {
  return bokitoFetch<{ markup: number }>('/api/staff/markup', token, {
    method: 'PUT',
    body: JSON.stringify({ multiplier }),
  })
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
) {
  return bokitoFetch<{
    id: string
    title: string
    channel: string
    agent_id?: string
    agent_name?: string
    agent_kind?: string
  }>('/api/chat/conversations', token, {
    method: 'POST',
    body: JSON.stringify(agentId ? { title, agent_id: agentId } : { title }),
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
 * Calls `onDelta` for each text chunk; resolves with the final text.
 */
export async function bokitoStreamMessage(
  token: string,
  conversationId: string,
  content: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
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
      if (name === 'delta' && payload.text) {
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

export async function bokitoTenantAppearance(token: string): Promise<TenantAppearance> {
  const me = await bokitoMe(token)
  return {
    chatbot_name: me.tenant.name,
    logo: me.tenant.logo ?? undefined,
    main_color: '#111827',
    powered_by: true,
  }
}
