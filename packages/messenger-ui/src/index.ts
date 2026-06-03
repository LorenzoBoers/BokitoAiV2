export type ApiConfig = {
  baseUrl: string
  getToken: () => string | null
}

export type Conversation = {
  id: string
  title: string
  updated_at: string
}

export type ChatMessage = {
  id: string
  role: string
  content: string
  created_at?: string
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
}

export type NotificationItem = {
  id: string
  kind: string
  title: string
  body: string
  status: string
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

export async function listConversations(config: ApiConfig) {
  return apiFetch<Conversation[]>(config, '/api/chat/conversations')
}

export async function createConversation(config: ApiConfig, title = 'New conversation') {
  return apiFetch<{ id: string; title: string }>(config, '/api/chat/conversations', {
    method: 'POST',
    body: JSON.stringify({ title }),
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

export async function listDecisions(config: ApiConfig) {
  return apiFetch<DecisionRequest[]>(config, '/api/notifications/decisions?status=awaiting_human')
}

export async function listNotifications(config: ApiConfig) {
  return apiFetch<NotificationItem[]>(config, '/api/notifications')
}

export async function approveDecision(config: ApiConfig, id: string, optionId: string) {
  return apiFetch(config, `/api/notifications/decisions/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ option_id: optionId }),
  })
}

export async function rejectDecision(config: ApiConfig, id: string, optionId: string) {
  return apiFetch(config, `/api/notifications/decisions/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ option_id: optionId }),
  })
}

export { ChatPanel } from './components/ChatPanel'
export { DecisionPanel } from './components/DecisionPanel'
export { FloatingMessenger } from './components/FloatingMessenger'
