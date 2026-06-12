import type {
  AuthMeResponse,
  ChatMessage,
  CockpitSummary,
  Conversation,
  PushSubscriptionPayload,
  TenantAppearance,
} from '@bokito/messenger-ui'
import type { ApiConfig } from '@bokito/messenger-ui'

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
