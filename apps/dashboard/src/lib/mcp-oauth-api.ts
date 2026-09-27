import { APP_API_BASE } from './api.config'
import { oauthRoutes } from '../api/routes'

export type McpOAuthMembership = {
  tenant_id: string
  tenant_slug: string
  tenant_name: string
  role: string
  status: string
}

export type McpOAuthConsentContext = {
  request_id: string
  client_id: string
  client_name: string
  redirect_uri: string
  scopes: string[]
  scopes_supported: string[]
  memberships: McpOAuthMembership[]
  user: { id: string; email: string; name: string }
}

function resolveBaseUrl(): string {
  if (import.meta.env.DEV) return ''
  return (import.meta.env.VITE_BOKITO_API_URL || '').replace(/\/$/, '')
}

async function oauthFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  }
  const res = await fetch(`${resolveBaseUrl()}${APP_API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })
  if (!res.ok) {
    const text = await res.text()
    let message = text.trim() || `HTTP ${res.status}`
    try {
      const body = JSON.parse(text) as { error?: { message?: string }; detail?: string }
      message = body.error?.message || body.detail || message
    } catch {
      /* keep text */
    }
    const err = new Error(message) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return res.json() as Promise<T>
}

export async function fetchMcpOAuthConsentContext(
  requestId: string,
): Promise<McpOAuthConsentContext> {
  return oauthFetch(oauthRoutes.consentContext(requestId))
}

export async function submitMcpOAuthConsent(body: {
  authorize_request_id: string
  tenant_id: string
  scopes?: string[]
}): Promise<{ redirect_to: string }> {
  return oauthFetch(oauthRoutes.consent, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function denyMcpOAuthConsent(body: {
  authorize_request_id: string
  tenant_id?: string
}): Promise<{ redirect_to: string }> {
  return oauthFetch(oauthRoutes.deny, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export type McpOAuthGrant = {
  id: string
  client_id: string
  client_name: string
  tenant_id: string
  tenant_name: string
  tenant_slug: string
  scopes: string[]
  created_at: string
  family_id: string
}

export async function listMcpOAuthGrants(token: string): Promise<McpOAuthGrant[]> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
  const res = await fetch(`${resolveBaseUrl()}${APP_API_BASE}${oauthRoutes.grants}`, {
    headers,
    credentials: 'include',
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  const body = (await res.json()) as { items: McpOAuthGrant[] }
  return body.items ?? []
}

export async function revokeMcpOAuthGrant(
  token: string,
  clientId: string,
  tenantId: string,
): Promise<void> {
  const res = await fetch(
    `${resolveBaseUrl()}${APP_API_BASE}${oauthRoutes.revokeGrant(clientId, tenantId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    },
  )
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
}
