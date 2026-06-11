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

export async function bokitoListConversations(token: string, channel?: string) {
  const query = channel ? `?channel=${encodeURIComponent(channel)}` : ''
  return bokitoFetch<Conversation[]>(`/api/chat/conversations${query}`, token)
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
