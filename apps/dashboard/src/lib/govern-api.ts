import { requireAccessToken } from './xano'

export type PlatformChangeRow = {
  id: string
  resource_type: string
  resource_id: string
  change_kind: string
  status: string
  version: number
  summary: string
  before: Record<string, unknown>
  after: Record<string, unknown>
  proposed_by_type: string
  proposed_by_id: string
  agent_id: string | null
  created_at: string
  resolved_at: string | null
}

export type AuditEventRow = {
  id: string
  action: string
  actor_type: string
  actor_id: string
  outcome: string
  summary: string
  created_at: string
}

export type AutonomyPostureId = 'manual' | 'assisted' | 'autonomous'

export type PosturePreset = {
  id: AutonomyPostureId
  label: string
  summary: string
}

export type PostureResponse = {
  posture: AutonomyPostureId
  policy_mode: string
  platform_apply_modes: Record<string, string>
  presets: PosturePreset[]
}

async function governFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = requireAccessToken()
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers as Record<string, string> | undefined),
    },
    credentials: 'include',
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<T>
}

export async function listGovernChanges(status = 'pending_review') {
  return governFetch<{ items: PlatformChangeRow[] }>(`/api/govern/changes?status=${encodeURIComponent(status)}`)
}

export async function acceptGovernChange(changeId: string) {
  return governFetch<PlatformChangeRow>(`/api/govern/changes/${encodeURIComponent(changeId)}/accept`, {
    method: 'POST',
  })
}

export async function rejectGovernChange(changeId: string) {
  return governFetch<PlatformChangeRow>(`/api/govern/changes/${encodeURIComponent(changeId)}/reject`, {
    method: 'POST',
  })
}

export async function rollbackGovernChange(changeId: string) {
  return governFetch<PlatformChangeRow>(`/api/govern/changes/${encodeURIComponent(changeId)}/rollback`, {
    method: 'POST',
  })
}

export async function listGovernAudit(limit = 50) {
  return governFetch<{ items: AuditEventRow[] }>(`/api/govern/audit?limit=${limit}`)
}

export async function listAgentPassports() {
  return governFetch<{ items: Array<Record<string, unknown>> }>('/api/govern/passports')
}

export async function getApplyModes() {
  return governFetch<{ defaults: Record<string, string>; tenant_modes: Record<string, string> }>(
    '/api/govern/apply-modes',
  )
}

export async function updateApplyModes(platform_apply_modes: Record<string, string>) {
  return governFetch<{ tenant_modes: Record<string, string> }>('/api/govern/apply-modes', {
    method: 'PUT',
    body: JSON.stringify({ platform_apply_modes }),
  })
}

export async function getPosture() {
  return governFetch<PostureResponse>('/api/govern/posture')
}

export async function setPosture(posture: AutonomyPostureId) {
  return governFetch<PostureResponse>('/api/govern/posture', {
    method: 'PUT',
    body: JSON.stringify({ posture }),
  })
}

export async function getGovernChange(changeId: string) {
  return governFetch<PlatformChangeRow>(`/api/govern/changes/${encodeURIComponent(changeId)}`)
}

export async function listAcceptedChanges(limit = 20) {
  return governFetch<{ items: PlatformChangeRow[] }>(
    `/api/govern/changes?status=accepted&limit=${limit}`,
  )
}
