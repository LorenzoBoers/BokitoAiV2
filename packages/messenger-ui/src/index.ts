export type ApiConfig = {
  baseUrl: string
  getToken: () => string | null
}

export type TenantAppearance = {
  main_color?: string
  welcome_title?: string
  welcome_subtitle?: string
  chatbot_name?: string
  powered_by?: boolean
  logo?: string | null
}

export type Conversation = {
  id: string
  title: string
  channel?: string
  audience?: string
  ai_paused?: boolean
  updated_at: string
}

export type ChatMessage = {
  id: string
  role: string
  content: string
  created_at?: string
  decision_request_id?: string | null
  certainty?: number | null
  auto_sent?: boolean
  attachments?: unknown[]
}

export type DecisionOption = {
  id: string
  label: string
  action_type?: string
}

export type DecisionRequest = {
  id: string
  title: string
  summary: string
  status: string
  options: DecisionOption[]
  source_type?: string
  created_at?: string
}

export type NotificationItem = {
  id: string
  kind: string
  title: string
  body: string
  status: string
  created_at?: string
}

export type InboxItem = {
  kind: 'conversation' | 'decision' | 'email_thread'
  id: string
  channel: string
  title: string
  updated_at: string
  ai_paused?: boolean
  conversation_id?: string | null
}

export type CockpitSummary = {
  volume_week: number
  open_decisions: number
  autonomy_rate_pct: number
  avg_feedback_score: number
  tokens_month: number
  cost_cents_month: number
  time_saved_minutes_week: number
}

export type PushSubscriptionPayload = {
  endpoint: string
  keys: Record<string, string>
}

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

async function apiFetch<T>(config: ApiConfig, path: string, init?: RequestInit): Promise<T> {
  const token = config.getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${config.baseUrl}${path}`, { ...init, headers, credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<T>
}

export async function login(config: ApiConfig, email: string, password: string) {
  return apiFetch<{ access_token: string; user: Record<string, unknown>; tenant: Record<string, unknown> }>(
    config,
    '/api/auth/login',
    { method: 'POST', body: JSON.stringify({ email, password }) },
  )
}

export async function getMe(config: ApiConfig) {
  return apiFetch<AuthMeResponse>(config, '/api/auth/me')
}

export async function listConversations(config: ApiConfig, channel?: string) {
  const query = channel ? `?channel=${encodeURIComponent(channel)}` : ''
  return apiFetch<Conversation[]>(config, `/api/chat/conversations${query}`)
}

export async function createConversation(
  config: ApiConfig,
  title = 'New conversation',
  options?: { audience?: string; channel?: string },
) {
  return apiFetch<{ id: string; title: string; channel?: string }>(config, '/api/chat/conversations', {
    method: 'POST',
    body: JSON.stringify({
      title,
      audience: options?.audience ?? 'internal',
      channel: options?.channel ?? 'assistant',
    }),
  })
}

export async function renameConversation(config: ApiConfig, conversationId: string, title: string) {
  return apiFetch<{ id: string; title: string }>(config, `/api/chat/conversations/${conversationId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  })
}

export async function deleteConversation(config: ApiConfig, conversationId: string) {
  return apiFetch<{ ok: boolean }>(config, `/api/chat/conversations/${conversationId}`, {
    method: 'DELETE',
  })
}

export async function takeoverConversation(config: ApiConfig, conversationId: string) {
  return apiFetch<{ ai_paused: boolean }>(config, `/api/chat/conversations/${conversationId}/takeover`, {
    method: 'POST',
  })
}

export async function releaseConversation(config: ApiConfig, conversationId: string) {
  return apiFetch<{ ai_paused: boolean }>(config, `/api/chat/conversations/${conversationId}/release`, {
    method: 'POST',
  })
}

export async function listMessages(config: ApiConfig, conversationId: string) {
  return apiFetch<ChatMessage[]>(config, `/api/chat/conversations/${conversationId}/messages`)
}

export async function sendMessage(config: ApiConfig, conversationId: string, content: string) {
  return apiFetch<{ message: ChatMessage }>(config, `/api/chat/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  })
}

export async function listDecisions(config: ApiConfig, status = 'awaiting_human') {
  return apiFetch<DecisionRequest[]>(config, `/api/notifications/decisions?status=${encodeURIComponent(status)}`)
}

export async function getDecision(config: ApiConfig, decisionId: string) {
  const items = await listDecisions(config)
  return items.find((d) => d.id === decisionId) ?? null
}

export async function listNotifications(config: ApiConfig) {
  return apiFetch<NotificationItem[]>(config, '/api/notifications')
}

export async function approveDecision(
  config: ApiConfig,
  id: string,
  optionId: string,
  options?: { alwaysAuto?: boolean },
) {
  return apiFetch(config, `/api/notifications/decisions/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ option_id: optionId, always_auto: options?.alwaysAuto ?? false }),
  })
}

export async function rejectDecision(config: ApiConfig, id: string, optionId: string) {
  return apiFetch(config, `/api/notifications/decisions/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ option_id: optionId }),
  })
}

export async function listInbox(config: ApiConfig, options?: { channel?: string; limit?: number }) {
  const params = new URLSearchParams()
  params.set('view', 'all_open')
  if (options?.limit) params.set('per_page', String(options.limit))
  const payload = await apiFetch<{ items?: Array<Record<string, unknown>> }>(
    config,
    `/api/signals?${params.toString()}`,
  )
  const items = Array.isArray(payload.items) ? payload.items : []
  return items
    .filter((row) => !options?.channel || row.channel === options.channel)
    .map<InboxItem>((row) => ({
      kind: 'conversation',
      id: String(row.id ?? ''),
      channel: String(row.channel ?? ''),
      title: String(row.email_subject ?? '(No subject)'),
      updated_at: String(row.last_message_at ?? row.created_at ?? ''),
      conversation_id: String(row.id ?? ''),
    }))
}

export async function submitFeedback(
  config: ApiConfig,
  messageId: string,
  score: number,
  comment = '',
) {
  return apiFetch<{ id: string }>(config, `/api/messages/${messageId}/feedback`, {
    method: 'POST',
    body: JSON.stringify({ score, comment }),
  })
}

export async function subscribePush(config: ApiConfig, subscription: PushSubscriptionPayload) {
  return apiFetch<{ ok: boolean; user_id: string }>(config, '/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify(subscription),
  })
}

export async function getCockpitSummary(config: ApiConfig) {
  return apiFetch<CockpitSummary>(config, '/api/cockpit/summary')
}

export { ChatPanel } from './components/ChatPanel'
export { DecisionCard } from './components/DecisionCard'
export { DecisionPanel } from './components/DecisionPanel'
export { FloatingMessenger } from './components/FloatingMessenger'
export { InboxList } from './components/InboxList'
export { ThreadList } from './components/ThreadList'
