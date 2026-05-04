import { XANO_BASE_URL } from './xano'

const WORKFORCE_API_BASE = `${XANO_BASE_URL}/api:BWK_e0qC`
const AGENT_RUNTIME_API_BASE = `${XANO_BASE_URL}/api:_NUMR_yJ`

/** Xano Realtime nested channel prefix — must match workspace setting `workforce/*`. */
export const WORKFORCE_REALTIME_CHANNEL_PREFIX = 'workforce'

export function workforceRealtimeChannel(organisationId: number | string): string {
  return `${WORKFORCE_REALTIME_CHANNEL_PREFIX}/${organisationId}`
}

export interface WorkforceConfig {
  id: number
  organisation_id: number
  enabled: boolean
  autonomy_level: 'safe' | 'medium' | 'full'
  check_interval_sec: number
  max_retry_per_feature: number
  allow_verdict_override: boolean
  sleep_mode: 'scheduled' | 'event_only' | 'hybrid'
  last_wake_at: number
  next_wake_at: number
  updated_at: number
}

export interface WorkforceTask {
  id: number
  organisation_id: number
  pipeline_id: number
  feature_id: number
  task_type: string
  status: string
  attempt: number
  payload: Record<string, unknown> | null
  planned_for: number
  completed_at: number
  result_summary: string
  created_at: number
  updated_at: number
}

export interface WorkforceLog {
  id: number
  organisation_id: number
  pipeline_id: number
  feature_id: number
  task_id: number
  level: string
  action_type: string
  message: string
  metadata: Record<string, unknown> | null
  created_at: number
}

export interface WorkforceStatusPayload {
  config: WorkforceConfig | null
  pipelines: Array<Record<string, unknown>>
  recent_tasks: WorkforceTask[]
  recent_logs: WorkforceLog[]
}

export interface WorkforceGraphEvent {
  version: number
  event_type: 'agent_updated' | 'activity_updated' | 'task_updated' | 'message_created' | 'timeline_resync'
  organisation_id: string
  agent_id?: string
  activity_id?: string
  ts: number
  payload?: Record<string, unknown>
}

export interface RuntimeAgent {
  id: string
  organisation_id: string
  name: string
  slug: string
  role_id: string | null
  role_name?: string | null
  role_slug?: string | null
  parent_agent_id: string | null
  status: 'standby' | 'active' | 'sleeping' | 'error'
  current_session_id: string | null
  current_activity_id: string | null
  current_activity_summary: string | null
  updated_at: number
}

export interface RuntimeActivity {
  id: string
  organisation_id: string
  agent_id: string
  session_id: string | null
  task_id: string | null
  title: string
  description: string | null
  type: 'planned' | 'executing' | 'completed' | 'failed' | 'cancelled'
  status_detail: string | null
  planned_for: number | null
  started_at: number | null
  ended_at: number | null
  result: Record<string, unknown> | null
  planned_start?: number | null
  planned_end?: number | null
  actual_start?: number | null
  actual_end?: number | null
  session_started_at?: number | null
  session_ended_at?: number | null
  created_at: number
  updated_at: number
}

export interface TriggerAgentPayload {
  agent_id: string
  instruction: string
  priority?: 'low' | 'normal' | 'high'
  correlation_id?: string
}

export interface CompleteActivityPayload {
  activity_id: string
  outcome: 'completed' | 'failed' | 'cancelled'
  summary?: string
  result?: Record<string, unknown> | null
  correlation_id?: string
}

function buildHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

async function readResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Onbekende fout' }))
    throw new Error(err.message || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function getWorkforceConfig(token: string): Promise<WorkforceConfig> {
  const res = await fetch(`${WORKFORCE_API_BASE}/workforce/config`, {
    method: 'GET',
    headers: buildHeaders(token),
  })
  return readResponse<WorkforceConfig>(res)
}

export async function updateWorkforceConfig(
  token: string,
  body: Partial<
    Pick<
      WorkforceConfig,
      'enabled' | 'autonomy_level' | 'check_interval_sec' | 'max_retry_per_feature' | 'allow_verdict_override' | 'sleep_mode'
    >
  >,
): Promise<WorkforceConfig> {
  const res = await fetch(`${WORKFORCE_API_BASE}/workforce/config`, {
    method: 'PATCH',
    headers: buildHeaders(token),
    body: JSON.stringify(body),
  })
  return readResponse<WorkforceConfig>(res)
}

export async function getWorkforceStatus(
  token: string,
  pipelineId?: number,
): Promise<WorkforceStatusPayload> {
  const params = new URLSearchParams()
  if (pipelineId) params.set('pipeline_id', String(pipelineId))
  const res = await fetch(`${WORKFORCE_API_BASE}/workforce/status?${params.toString()}`, {
    method: 'GET',
    headers: buildHeaders(token),
  })
  return readResponse<WorkforceStatusPayload>(res)
}

export async function forceWakeWorkforce(
  token: string,
  pipelineId?: number,
  wakeMessage?: string,
  agentId?: string,
): Promise<Record<string, unknown>> {
  if (agentId) {
    return triggerAgent(token, {
      agent_id: agentId,
      instruction: wakeMessage?.trim() || 'Directe trigger vanuit workforce',
      priority: 'normal',
    })
  }
  const body: Record<string, unknown> = {}
  if (pipelineId) body.pipeline_id = pipelineId
  if (wakeMessage && wakeMessage.trim()) body.wake_message = wakeMessage.trim()
  const res = await fetch(`${WORKFORCE_API_BASE}/workforce/force-wake`, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify(body),
  })
  return readResponse<Record<string, unknown>>(res)
}

export async function forceRescanWorkforce(token: string, pipelineId?: number): Promise<{ ok: boolean; trigger_id: number }> {
  const res = await fetch(`${WORKFORCE_API_BASE}/workforce/force-rescan`, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify(pipelineId ? { pipeline_id: pipelineId } : {}),
  })
  return readResponse<{ ok: boolean; trigger_id: number }>(res)
}

export async function pauseWorkforce(token: string): Promise<{ ok: boolean }> {
  const agents = await getAgents(token).catch(() => [])
  const manager = agents.find((agent) => agent.role_slug === 'manager')
  if (manager) {
    const updated = await updateAgentStatus(token, manager.id, 'standby')
    return { ok: updated.ok }
  }
  const res = await fetch(`${WORKFORCE_API_BASE}/workforce/pause`, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify({}),
  })
  return readResponse<{ ok: boolean }>(res)
}

export async function triggerAgent(
  token: string,
  payload: TriggerAgentPayload,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${WORKFORCE_API_BASE}/workforce/trigger-agent`, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify(payload),
  })
  return readResponse<Record<string, unknown>>(res)
}

export async function completeActivity(
  token: string,
  payload: CompleteActivityPayload,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${WORKFORCE_API_BASE}/workforce/complete-activity`, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify(payload),
  })
  return readResponse<Record<string, unknown>>(res)
}

export async function runWorkforceMaintenance(
  token: string,
  maxStaleMinutes = 15,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${WORKFORCE_API_BASE}/workforce/maintenance-run`, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify({ max_stale_minutes: maxStaleMinutes }),
  })
  return readResponse<Record<string, unknown>>(res)
}

export async function getAgents(token: string): Promise<RuntimeAgent[]> {
  const res = await fetch(`${AGENT_RUNTIME_API_BASE}/agents`, {
    method: 'GET',
    headers: buildHeaders(token),
  })
  const data = await readResponse<{ items?: RuntimeAgent[] }>(res)
  return data.items ?? []
}

export async function getTimeline(token: string): Promise<RuntimeActivity[]> {
  const res = await fetch(`${AGENT_RUNTIME_API_BASE}/timeline`, {
    method: 'GET',
    headers: buildHeaders(token),
  })
  const data = await readResponse<{ items?: RuntimeActivity[] }>(res)
  return data.items ?? []
}

export async function updateAgentStatus(
  token: string,
  agentId: string,
  status: RuntimeAgent['status'],
): Promise<{ ok: boolean; agent: RuntimeAgent }> {
  const res = await fetch(`${AGENT_RUNTIME_API_BASE}/agents/${encodeURIComponent(agentId)}/status`, {
    method: 'PATCH',
    headers: buildHeaders(token),
    body: JSON.stringify({ status }),
  })
  return readResponse<{ ok: boolean; agent: RuntimeAgent }>(res)
}
