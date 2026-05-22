const API_BASE = process.env.EXPO_PUBLIC_API_BASE || 'https://api.bokito.nl/v1'

export type Membership = {
  tenant_subdomain: string
  tenant_name: string
}

export async function fetchMemberships(): Promise<Membership[]> {
  const res = await fetch(`${API_BASE}/auth/me`)
  if (!res.ok) return []
  const data = await res.json()
  const list = data.memberships ?? data.tenant_memberships ?? []
  return Array.isArray(list) ? list : []
}

export async function registerPushToken(token: string): Promise<void> {
  await fetch(`${API_BASE}/user/push-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expo_push_token: token }),
  })
}
