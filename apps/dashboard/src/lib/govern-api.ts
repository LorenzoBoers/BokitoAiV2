import { requireAccessToken } from './api'
import { APP_API_BASE } from './api.config'
import { governRoutes } from '../api/routes'

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
  decision_id: string | null
  signal_id: string | null
  created_at: string
  resolved_at: string | null
}

export type AuditEventRow = {
  id: string
  action: string
  actor_type: string
  actor_id: string
  agent_id: string | null
  run_id: string | null
  resource_type: string
  resource_id: string
  outcome: string
  summary: string
  created_at: string
}

export type AutonomyPostureId = 'manual' | 'assisted' | 'autonomous'

export type AllowanceMode = 'deny' | 'ask' | 'allow'

export type PosturePreset = {
  id: AutonomyPostureId
  label: string
  summary: string
  allowances: Record<string, AllowanceMode>
}

export type AllowanceState = {
  posture: AutonomyPostureId
  allowances: Record<string, AllowanceMode>
  tool_overrides: Record<string, AllowanceMode>
  categories: string[]
  presets: PosturePreset[]
  learning_history?: LearningAllowanceNote[]
}

export type LearningAllowanceNote = {
  category?: string
  from?: string
  to?: string
  reason?: string
  at?: string
  escalations?: number
  rejects?: number
}

export type GovernToolRow = {
  name: string
  description: string
  category: string
  mutating: boolean
  gated: boolean
  override: AllowanceMode | null
}

export type AllowancesResponse = AllowanceState & { tools: GovernToolRow[] }

export type ApiTokenRow = {
  id: string
  name: string
  token_prefix: string
  scopes: string[]
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
  token?: string
}

async function governFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = requireAccessToken()
  const url = path.startsWith('/api') ? path : `${APP_API_BASE}${path}`
  const res = await fetch(url, {
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
  return governFetch<{ items: PlatformChangeRow[] }>(governRoutes.changes({ status }))
}

export async function acceptGovernChange(changeId: string) {
  return governFetch<PlatformChangeRow>(governRoutes.changeAccept(changeId), {
    method: 'POST',
  })
}

export async function rejectGovernChange(changeId: string) {
  return governFetch<PlatformChangeRow>(governRoutes.changeReject(changeId), {
    method: 'POST',
  })
}

export async function rollbackGovernChange(changeId: string) {
  return governFetch<PlatformChangeRow>(governRoutes.changeRollback(changeId), {
    method: 'POST',
  })
}

export async function listGovernAudit(limit = 50) {
  return governFetch<{ items: AuditEventRow[] }>(governRoutes.audit(limit))
}

export async function listAgentPassports() {
  return governFetch<{ items: Array<Record<string, unknown>> }>(governRoutes.passports)
}

export async function updateAgentPassport(
  agentId: string,
  patch: { autonomy_level?: string; allowed_tools?: string[]; permission_scopes?: string[] },
) {
  return governFetch<{ ok: boolean; passport: Record<string, unknown> }>(
    governRoutes.passport(agentId),
    { method: 'PATCH', body: JSON.stringify(patch) },
  )
}

export async function getAllowances() {
  return governFetch<AllowancesResponse>(governRoutes.allowances)
}

export async function updateAllowances(allowances: Record<string, AllowanceMode>) {
  return governFetch<AllowanceState>(governRoutes.allowances, {
    method: 'PUT',
    body: JSON.stringify({ allowances }),
  })
}

export async function setToolOverride(toolName: string, mode: AllowanceMode | null) {
  return governFetch<AllowanceState>(governRoutes.toolOverrides, {
    method: 'PUT',
    body: JSON.stringify({ tool_name: toolName, mode }),
  })
}

export async function getPosture() {
  return governFetch<AllowanceState>(governRoutes.posture)
}

export async function setPosture(posture: AutonomyPostureId) {
  return governFetch<AllowanceState>(governRoutes.posture, {
    method: 'PUT',
    body: JSON.stringify({ posture }),
  })
}

export async function listApiTokens() {
  return governFetch<{ items: ApiTokenRow[] }>(governRoutes.tokens)
}

export async function createApiToken(name: string, scopes: string[] = []) {
  return governFetch<ApiTokenRow>(governRoutes.tokens, {
    method: 'POST',
    body: JSON.stringify({ name, scopes }),
  })
}

export async function revokeApiToken(tokenId: string) {
  return governFetch<ApiTokenRow>(governRoutes.token(tokenId), {
    method: 'DELETE',
  })
}

export async function getGovernChange(changeId: string) {
  return governFetch<PlatformChangeRow>(governRoutes.change(changeId))
}

export async function listAcceptedChanges(limit = 20) {
  return governFetch<{ items: PlatformChangeRow[] }>(
    governRoutes.changes({ status: 'accepted', limit }),
  )
}
