const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || 'https://api.bokito.nl/v1').replace(/\/+$/, '')

let accessToken: string | null = null
let activeProjectId: string | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

export function setActiveProjectId(id: string | null): void {
  activeProjectId = id
}

export function getActiveProjectId(): string | null {
  return activeProjectId
}

export type Membership = {
  tenant_subdomain: string
  tenant_name: string
}

export type ProjectRow = {
  id: string
  name: string
  slug: string
  autonomous_scope: string
}

export type PkbSectionRow = {
  id: string
  project_id: string
  layer: 'current_state' | 'intended_state' | 'change_queue'
  domain?: string | null
  title?: string | null
  content: string
  change_status?: string
  target_page_id?: string | null
}

export type MessageRow = {
  id: string
  thread_id: string
  subject: string | null
  body: string
  message_type: string
  channel: string
  status: string
  payload?: Record<string, unknown>
  created_at: string
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }))
    throw new Error(typeof err.message === 'string' ? err.message : `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function login(email: string, password: string): Promise<string> {
  const data = await apiFetch<{ authToken?: string; token?: string; access_token?: string }>(
    '/auth/login',
    { method: 'POST', body: JSON.stringify({ email, password }) }
  )
  const token = data.authToken || data.token || data.access_token
  if (!token) throw new Error('No access token returned')
  accessToken = token
  return token
}

export async function fetchMemberships(): Promise<Membership[]> {
  const data = await apiFetch<{ memberships?: Membership[]; tenant_memberships?: Membership[] }>(
    '/auth/me'
  )
  const list = data.memberships ?? data.tenant_memberships ?? []
  return Array.isArray(list) ? list : []
}

export async function listProjects(): Promise<ProjectRow[]> {
  const data = await apiFetch<ProjectRow[] | { items: ProjectRow[] }>('/workforce/projects')
  return Array.isArray(data) ? data : data.items ?? []
}

export async function patchProject(
  projectId: string,
  patch: Partial<Pick<ProjectRow, 'autonomous_scope' | 'name'>>
): Promise<ProjectRow> {
  return apiFetch<ProjectRow>(`/workforce/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export async function listPkbSections(
  projectId: string,
  layer?: PkbSectionRow['layer']
): Promise<PkbSectionRow[]> {
  if (layer && layer !== 'change_queue') {
    return []
  }

  const data = await apiFetch<
    Array<{
      id: string
      project_id: string
      title?: string | null
      body: string
      status?: string
      target_page_id?: string | null
    }>
  >(`/workforce/projects/${encodeURIComponent(projectId)}/doc/change-requests`)

  return (Array.isArray(data) ? data : []).map((row) => ({
    id: row.id,
    project_id: row.project_id,
    layer: 'change_queue',
    title: row.title ?? null,
    content: row.body,
    change_status: row.status ?? 'pending',
    target_page_id: row.target_page_id ?? null,
  }))
}

export async function submitChangeRequest(input: {
  project_id: string
  content: string
  priority?: number
}): Promise<PkbSectionRow> {
  const response = await apiFetch<{
    id: string
    project_id: string
    title?: string | null
    body: string
    status?: string
    target_page_id?: string | null
  }>(`/workforce/projects/${encodeURIComponent(input.project_id)}/doc/change-requests`, {
    method: 'POST',
    body: JSON.stringify({
      body: input.content,
      priority: input.priority ?? 5,
    }),
  })

  return {
    id: response.id,
    project_id: response.project_id,
    layer: 'change_queue',
    title: response.title ?? null,
    content: response.body,
    change_status: response.status ?? 'pending',
    target_page_id: response.target_page_id ?? null,
  }
}

export async function listMessages(filters: {
  status?: string
  message_type?: string
}): Promise<MessageRow[]> {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.message_type) params.set('message_type', filters.message_type)
  const q = params.toString()
  const data = await apiFetch<MessageRow[] | { items: MessageRow[] }>(
    `/workforce/messages${q ? `?${q}` : ''}`
  )
  return Array.isArray(data) ? data : data.items ?? []
}

export async function approveAutonomousProposal(messageId: string): Promise<void> {
  await apiFetch(`/workforce/messages/${encodeURIComponent(messageId)}/approve`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function deferAutonomousProposal(messageId: string, days = 7): Promise<void> {
  await apiFetch(`/workforce/messages/${encodeURIComponent(messageId)}/defer`, {
    method: 'POST',
    body: JSON.stringify({ days }),
  })
}

export async function rejectAutonomousProposal(messageId: string): Promise<void> {
  await apiFetch(`/workforce/messages/${encodeURIComponent(messageId)}/reject`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function registerPushToken(token: string): Promise<void> {
  await apiFetch('/user/push-token', {
    method: 'POST',
    body: JSON.stringify({ expo_push_token: token }),
  })
}

export function stripCodeBlocks(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .trim()
}
