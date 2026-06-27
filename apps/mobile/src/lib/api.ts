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

export function resolveAttachmentUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return `${API_URL}${url.startsWith('/') ? url : `/${url}`}`
}

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
// Attachments / uploads
// ---------------------------------------------------------------------------

export type Attachment = {
  schema_version?: number
  id: string
  name: string
  mime: string
  size: number
  url: string
}

export type UploadInput = {
  uri: string
  name: string
  mime: string
}

export async function uploadFile(input: UploadInput): Promise<Attachment> {
  const form = new FormData()
  form.append('file', {
    uri: input.uri,
    name: input.name,
    type: input.mime,
  } as unknown as Blob)
  const headers: Record<string, string> = {}
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  const res = await fetch(`${API_URL}/api/uploads`, {
    method: 'POST',
    headers,
    body: form,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ApiError(res.status, text || `HTTP ${res.status}`)
  }
  return (await res.json()) as Attachment
}

// ---------------------------------------------------------------------------
// Signals (unified inbox)
// ---------------------------------------------------------------------------

export type Thread = {
  id: string
  email_subject: string
  contact_email: string
  contact_name: string
  contact_phone?: string
  status: string
  priority: string
  channel: string
  folder: string
  has_unread: boolean
  is_pinned: boolean
  ai_paused?: boolean
  last_message_at: string | null
  tags: string[]
  assigned_to_user_id?: number | null
  agent_id?: string | null
  agent_name?: string | null
  agent_kind?: string | null
}

export type DecisionOption = {
  id: string
  label: string
}

export type DecisionPayload = {
  id: string
  title: string
  summary: string
  status: string
  options: DecisionOption[]
}

export type ThreadMessage = {
  id: string
  signal_id: string
  kind: string
  direction: string
  from_address: string
  subject: string
  body_text: string
  body_html?: string | null
  decision_id: string | null
  send_status: string | null
  created_at: string | null
  received_at?: string | null
  attachments?: Attachment[]
  payload?: {
    decision?: DecisionPayload
    decision_id?: string
    [key: string]: unknown
  }
}

export type ThreadEvent = {
  id: string
  signal_id: string
  event_type: string
  actor_user_id: number | null
  payload: Record<string, unknown>
  created_at: string
}

export type ThreadDetail = {
  thread: Thread
  messages: ThreadMessage[]
  events: ThreadEvent[]
}

export type ThreadFilters = {
  view?: string
  folder?: string
  channel?: string
  search?: string
  page?: number
  per_page?: number
}

export type PagedThreads = {
  items: Thread[]
  curPage?: number
  itemsTotal?: number | null
  nextPage?: number | null
}

export type BadgeCounts = {
  inbox_unread: number
  inbox_by_queue: { my: number; unassigned: number; all: number }
  agents_attention: number
}

export type PatchThreadInput = {
  status?: string
  assigned_to_user_id?: number | null
  tags?: string[]
  priority?: string
}

export type ReplyAction = 'send' | 'send_and_close' | 'send_and_pending'

function buildThreadQuery(filters: ThreadFilters): string {
  const params = new URLSearchParams()
  if (filters.view) params.set('view', filters.view)
  if (filters.folder) params.set('folder', filters.folder)
  if (filters.channel) params.set('channel', filters.channel)
  if (filters.search) params.set('search', filters.search)
  params.set('page', String(filters.page ?? 1))
  params.set('per_page', String(filters.per_page ?? 30))
  return params.toString()
}

export function listThreads(filters: ThreadFilters = {}) {
  return apiGet<PagedThreads>(`/api/signals?${buildThreadQuery(filters)}`)
}

export const badgeCounts = () => apiGet<BadgeCounts>('/api/signals/badge-counts')

export const getThread = (id: string) => apiGet<ThreadDetail>(`/api/signals/${id}`)

export const patchThread = (id: string, patch: PatchThreadInput) =>
  apiPatch<Thread>(`/api/signals/${id}`, patch)

export const markThreadRead = (id: string) => apiPatch<Thread>(`/api/signals/${id}/mark-read`)

export const markThreadUnread = (id: string) => apiPatch<Thread>(`/api/signals/${id}/mark-unread`)

export const pinThread = (id: string) => apiPost<{ ok: boolean }>(`/api/signals/${id}/pin`)

export const unpinThread = (id: string) => apiDelete<{ ok: boolean }>(`/api/signals/${id}/pin`)

export const deleteThread = (id: string) => apiDelete<{ ok: boolean }>(`/api/signals/${id}`)

export const takeoverThread = (id: string) =>
  apiPost<{ ai_paused?: boolean }>(`/api/signals/${id}/takeover`)

export const releaseThread = (id: string) =>
  apiPost<{ ai_paused?: boolean }>(`/api/signals/${id}/release`)

export const replyToThread = (
  id: string,
  bodyText: string,
  action: ReplyAction = 'send',
  attachments?: Attachment[],
) =>
  apiPost<ThreadMessage>(`/api/signals/${id}/reply`, {
    body_text: bodyText,
    action,
    attachments,
  })

export const addNote = (id: string, bodyText: string, attachments?: Attachment[]) =>
  apiPost<ThreadMessage>(`/api/signals/${id}/notes`, { body_text: bodyText, attachments })

export type ResolveAction = 'approved' | 'rejected' | 'deferred'

export const resolveThreadDecision = (
  threadId: string,
  messageId: string,
  action: ResolveAction,
) => apiPost(`/api/signals/${threadId}/messages/${messageId}/resolve`, { action })

// ---------------------------------------------------------------------------
// Assistant chat
// ---------------------------------------------------------------------------

export type Conversation = {
  id: string
  title: string
  channel: string
  agent_id?: string
  agent_name?: string
  agent_kind?: string
  updated_at?: string
}

export type ChatMessage = {
  id: string
  role: string
  content: string
  created_at?: string
  decision_request_id?: string | null
}

export type ChatTarget = {
  id: string
  name: string
  kind: string
  role?: string
  runtime_status?: string
  is_default?: boolean
}

export type ChatTargetsResponse = {
  items: ChatTarget[]
  default_agent_id: string
}

export const listConversations = () => apiGet<Conversation[]>('/api/chat/conversations?channel=assistant')

export const createConversation = (title = 'New conversation', agentId?: string) =>
  apiPost<Conversation>(
    '/api/chat/conversations',
    agentId ? { title, agent_id: agentId } : { title },
  )

export const renameConversation = (conversationId: string, title: string) =>
  apiPatch<{ id: string; title: string }>(`/api/chat/conversations/${conversationId}`, { title })

export const deleteConversation = (conversationId: string) =>
  apiDelete<{ ok: boolean }>(`/api/chat/conversations/${conversationId}`)

export const listChatMessages = (conversationId: string) =>
  apiGet<ChatMessage[]>(`/api/chat/conversations/${conversationId}/messages`)

export const sendChatMessage = (conversationId: string, content: string) =>
  apiPost<{ message: ChatMessage; usage?: unknown }>(
    `/api/chat/conversations/${conversationId}/messages`,
    { content },
  )

export const listChatTargets = () => apiGet<ChatTargetsResponse>('/api/chat/targets')

/**
 * Send a message and stream the assistant reply over SSE.
 * Calls `onDelta` for each text chunk; resolves with the final text.
 */
export async function streamChatMessage(
  conversationId: string,
  content: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  const res = await fetch(`${API_URL}/api/chat/conversations/${conversationId}/stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ content }),
    signal,
  })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new ApiError(res.status, text || `HTTP ${res.status}`)
  }

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
  signal_id?: string | null
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
