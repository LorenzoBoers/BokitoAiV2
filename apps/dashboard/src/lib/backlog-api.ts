import { APP_API_BASE } from './api.config'
import { requireAccessToken } from './xano'

const BACKLOG_API_BASE = APP_API_BASE

export type BacklogType = 'feature' | 'alteration' | 'bug'
export type BacklogPriority = 'critical' | 'high' | 'medium' | 'low'
export type BacklogStatus = 'submitted' | 'triaged' | 'queued' | 'in_progress' | 'done' | 'rejected'
export type BacklogComplexity = 'trivial' | 'small' | 'medium' | 'large' | 'epic'

export interface BacklogItem {
  id: number
  organisation_id: number
  title: string
  description: string
  type: BacklogType
  priority: BacklogPriority
  status: BacklogStatus
  complexity: BacklogComplexity
  category: string
  prd_section: string
  ai_summary: string
  queue_position: number
  sprint_label: string
  submitter_id: number
  assignee_id: number
  tags: string[]
  dependencies: number[]
  updated_at: string
}

export interface BacklogComment {
  id: number
  backlog_item_id: number
  user_id: number
  body: string
  is_ai: boolean
  created_at: string
}

export interface BacklogConfig {
  id: number
  organisation_id: number
  auto_triage: boolean
  prd_context: string
  default_model: string
  sprint_labels: string[]
  updated_at: string
}

function buildHeaders(token?: string): Record<string, string> {
  const resolvedToken = requireAccessToken(token)
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${resolvedToken}`,
  }
}

async function readResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Onbekende fout' }))
    throw new Error(err.message || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function listBacklogItems(
  token?: string,
  filters: Partial<{ status: string; type: string; priority: string; sprint: string }> = {},
): Promise<{ items: BacklogItem[] }> {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value)
  })

  const res = await fetch(`${BACKLOG_API_BASE}/backlog/items?${params.toString()}`, {
    method: 'GET',
    credentials: 'include',
    headers: buildHeaders(token),
  })

  const payload = await readResponse<unknown>(res)
  const objectPayload = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const items = Array.isArray(objectPayload.items)
    ? (objectPayload.items as BacklogItem[])
    : Array.isArray(payload)
      ? (payload as BacklogItem[])
      : []
  return { items }
}

export async function createBacklogItem(
  token: string | undefined,
  body: {
    title: string
    description: string
    type: BacklogType
    priority?: BacklogPriority
    sprint_label?: string
    tags?: string[]
  },
): Promise<BacklogItem> {
  const res = await fetch(`${BACKLOG_API_BASE}/backlog/items`, {
    method: 'POST',
    credentials: 'include',
    headers: buildHeaders(token),
    body: JSON.stringify(body),
  })
  return readResponse<BacklogItem>(res)
}

export async function getBacklogItem(token: string | undefined, id: number): Promise<{ item: BacklogItem; comments: BacklogComment[] }> {
  const res = await fetch(`${BACKLOG_API_BASE}/backlog/items/${id}`, {
    method: 'GET',
    credentials: 'include',
    headers: buildHeaders(token),
  })
  return readResponse<{ item: BacklogItem; comments: BacklogComment[] }>(res)
}

export async function updateBacklogItem(
  token: string | undefined,
  id: number,
  body: Partial<{
    title: string
    description: string
    type: BacklogType
    priority: BacklogPriority
    status: BacklogStatus
    complexity: BacklogComplexity
    category: string
    prd_section: string
    ai_summary: string
    queue_position: number
    sprint_label: string
    assignee_id: number
    tags: string[]
    dependencies: number[]
  }>,
): Promise<BacklogItem> {
  const res = await fetch(`${BACKLOG_API_BASE}/backlog/items/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: buildHeaders(token),
    body: JSON.stringify(body),
  })
  return readResponse<BacklogItem>(res)
}

export async function deleteBacklogItem(token: string | undefined, id: number): Promise<{ ok: boolean; id: number }> {
  const res = await fetch(`${BACKLOG_API_BASE}/backlog/items/${id}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: buildHeaders(token),
  })
  return readResponse<{ ok: boolean; id: number }>(res)
}

export async function listBacklogComments(token: string | undefined, id: number): Promise<BacklogComment[]> {
  const res = await fetch(`${BACKLOG_API_BASE}/backlog/items/${id}/comments`, {
    method: 'GET',
    credentials: 'include',
    headers: buildHeaders(token),
  })
  const payload = await readResponse<unknown>(res)
  return Array.isArray(payload) ? (payload as BacklogComment[]) : []
}

export async function addBacklogComment(token: string | undefined, id: number, body: string): Promise<BacklogComment> {
  const res = await fetch(`${BACKLOG_API_BASE}/backlog/items/${id}/comments`, {
    method: 'POST',
    credentials: 'include',
    headers: buildHeaders(token),
    body: JSON.stringify({ body }),
  })
  return readResponse<BacklogComment>(res)
}

export async function retriageBacklogItem(token: string | undefined, id: number): Promise<unknown> {
  const res = await fetch(`${BACKLOG_API_BASE}/backlog/triage/${id}`, {
    method: 'POST',
    credentials: 'include',
    headers: buildHeaders(token),
  })
  return readResponse<unknown>(res)
}

export async function reorderRoadmap(
  token: string | undefined,
  items: Array<{ id: number; queue_position?: number; sprint_label?: string; status?: BacklogStatus }>,
): Promise<{ ok: boolean }> {
  const res = await fetch(`${BACKLOG_API_BASE}/backlog/roadmap/reorder`, {
    method: 'PATCH',
    credentials: 'include',
    headers: buildHeaders(token),
    body: JSON.stringify({ items }),
  })
  return readResponse<{ ok: boolean }>(res)
}

export async function getBacklogConfig(token: string | undefined): Promise<BacklogConfig> {
  const res = await fetch(`${BACKLOG_API_BASE}/backlog/config`, {
    method: 'GET',
    credentials: 'include',
    headers: buildHeaders(token),
  })
  return readResponse<BacklogConfig>(res)
}

export async function updateBacklogConfig(
  token: string | undefined,
  body: Partial<{ auto_triage: boolean; prd_context: string; default_model: string; sprint_labels: string[] }>,
): Promise<BacklogConfig> {
  const res = await fetch(`${BACKLOG_API_BASE}/backlog/config`, {
    method: 'PATCH',
    credentials: 'include',
    headers: buildHeaders(token),
    body: JSON.stringify(body),
  })
  return readResponse<BacklogConfig>(res)
}
