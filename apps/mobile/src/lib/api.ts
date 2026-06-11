import { API_URL } from './config'

let accessToken: string | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ApiError(res.status, text || `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const apiGet = <T>(path: string) => request<T>('GET', path)
export const apiPost = <T>(path: string, body?: unknown) => request<T>('POST', path, body)
export const apiPatch = <T>(path: string, body?: unknown) => request<T>('PATCH', path, body)
export const apiDelete = <T>(path: string) => request<T>('DELETE', path)

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export type AuthUser = {
  id: string
  email: string
  display_name: string | null
  role: string
  is_staff: boolean
  tenant: { id: string; slug: string; name: string }
}

export type LoginResponse = {
  access_token: string
  user: AuthUser
  tenant: { id: string; slug: string; name: string; logo?: string | null }
}

export const login = (email: string, password: string) =>
  apiPost<LoginResponse>('/api/auth/login', { email, password })

export const fetchMe = () => apiGet<{ user: AuthUser }>('/api/auth/me')

// ---------------------------------------------------------------------------
// Signals (unified inbox)
// ---------------------------------------------------------------------------

export type Thread = {
  id: string
  email_subject: string
  contact_email: string
  contact_name: string
  status: string
  priority: string
  channel: string
  folder: string
  has_unread: boolean
  is_pinned: boolean
  last_message_at: string | null
  tags: string[]
}

export type ThreadMessage = {
  id: string
  signal_id: string
  kind: string
  direction: string
  from_address: string
  subject: string
  body_text: string
  decision_id: string | null
  send_status: string | null
  created_at: string | null
}

export type ThreadDetail = {
  thread: Thread
  messages: ThreadMessage[]
  events: unknown[]
}

export type PagedThreads = {
  items: Thread[]
  curPage?: number
  itemsTotal?: number | null
  nextPage?: number | null
}

export function listThreads(view = 'all_open', page = 1, perPage = 30) {
  const params = new URLSearchParams({ view, page: String(page), per_page: String(perPage) })
  return apiGet<PagedThreads>(`/api/signals?${params.toString()}`)
}

export const getThread = (id: string) => apiGet<ThreadDetail>(`/api/signals/${id}`)
export const markThreadRead = (id: string) => apiPatch<Thread>(`/api/signals/${id}/mark-read`)
export const replyToThread = (id: string, bodyText: string) =>
  apiPost<ThreadMessage>(`/api/signals/${id}/reply`, { body_text: bodyText, action: 'send' })
export const resolveThreadDecision = (threadId: string, messageId: string, action: 'approved' | 'rejected' | 'deferred') =>
  apiPost(`/api/signals/${threadId}/messages/${messageId}/resolve`, { action })

// ---------------------------------------------------------------------------
// Assistant chat
// ---------------------------------------------------------------------------

export type Conversation = {
  id: string
  title: string
  channel: string
  updated_at?: string
}

export type ChatMessage = {
  id: string
  role: string
  content: string
  created_at?: string
}

export const listConversations = () => apiGet<Conversation[]>('/api/chat/conversations?channel=assistant')
export const createConversation = (title = 'New conversation') =>
  apiPost<Conversation>('/api/chat/conversations', { title })
export const listChatMessages = (conversationId: string) =>
  apiGet<ChatMessage[]>(`/api/chat/conversations/${conversationId}/messages`)
export const sendChatMessage = (conversationId: string, content: string) =>
  apiPost<{ message: ChatMessage; usage?: unknown }>(`/api/chat/conversations/${conversationId}/messages`, { content })

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export type Decision = {
  id: string
  title: string
  summary: string
  status: string
  options: Array<{ id: string; label: string }>
  source_type: string | null
  created_at: string
}

export const listDecisions = (status = 'awaiting_human') =>
  apiGet<Decision[]>(`/api/notifications/decisions?status=${encodeURIComponent(status)}`)
export const approveDecision = (id: string, optionId = 'approve') =>
  apiPost(`/api/notifications/decisions/${id}/approve`, { option_id: optionId })
export const rejectDecision = (id: string, optionId = 'reject') =>
  apiPost(`/api/notifications/decisions/${id}/reject`, { option_id: optionId })

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

export const subscribePush = (expoPushToken: string) =>
  apiPost<{ ok: boolean }>('/api/push/subscribe', {
    endpoint: `expo:${expoPushToken}`,
    keys: { provider: 'expo' },
  })
