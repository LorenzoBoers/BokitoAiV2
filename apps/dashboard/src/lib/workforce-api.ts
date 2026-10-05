import { workforceRoutes } from '../api/routes/workforce.routes'
import { WORKFORCE_API_BASE } from './api.config'
import { requireAccessToken } from './api'
import type { AgentPresenceStatus } from './teams-api'

const AGENT_RUNTIME_API_BASE = WORKFORCE_API_BASE

/** Realtime nested channel prefix — must match workspace setting `workforce/*`. */
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

export type AskTarget = { kind: 'auto' | 'user' | 'team'; id: string | null }

export type AgentStatus = AgentPresenceStatus

/** `serialize_agent(view="summary")`: rows, chips, pickers and the project orchestrator. */
export interface AgentSummary {
  id: string
  name: string
  slug: string
  role: string
  kind?: 'company' | 'personal' | 'archived' | string
  /** False only when the agent is archived (or a retired personal row). */
  is_active?: boolean
  status: AgentStatus
  current_activity_summary: string | null
  /** Conversation the agent is working right now (live WS + REST). */
  current_thread_id?: string | null
  /** Last run, reply or tool step (ms); null before the first run. */
  last_active_at?: number | null
  /** Visual identity: initials | icon | image (from settings_json). */
  avatar_kind?: 'initials' | 'icon' | 'image' | string | null
  avatar_icon?: string | null
  avatar_color?: string | null
  avatar_image_url?: string | null
}

/** `serialize_agent(view="passport")`: Govern, Team and the agent tools tab. */
export interface AgentPassport extends AgentSummary {
  model?: string
  provider?: string
  /** Exactly one company agent per workspace carries the lead label. */
  is_lead?: boolean
  acts_for_user?: boolean
  autonomy_level?: string
  /** Tool allowlist; empty means the role defaults. */
  tools?: string[]
  permission_scopes?: string[]
}

/** `serialize_agent(view="runtime")`: the Agents page and agent detail. */
export interface RuntimeAgent extends AgentPassport {
  organisation_id: string
  role_id: string | null
  role_name?: string | null
  role_slug?: string | null
  parent_agent_id: string | null
  purpose?: string
  owner_user_id?: string | null
  default_channels?: string[]
  default_signal_types?: string[]
  system_prompt?: string
  /** Signature (HTML, derived) appended to outbound replies sent as this agent. */
  email_signature_html?: string
  /** Plain-text signature body for this agent. */
  email_signature_text?: string
  /** Default Send as on approvals: user (impersonate) | agent. */
  reply_send_as?: 'user' | 'agent'
  /** Who the agent asks when it needs a person ("Ask questions to"). */
  ask_target?: AskTarget
  chat_access?: 'everyone' | 'selected' | 'nobody'
  /** Stack/module-owned agent; archive is respected until a restore Decision is accepted. */
  managed?: boolean
  managed_origin?: string | null
  managed_ref?: string | null
  template_slug?: string | null
  origin_label?: string | null
  current_session_id: string | null
  current_activity_id: string | null
  /** Open non-assistant threads assigned to this agent. */
  open_conversations?: number
  /** Real awaiting-decision threads for this agent (excludes no-reply tips). */
  awaiting_decision?: number
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

function buildHeaders(token?: string): Record<string, string> {
  const resolvedToken = requireAccessToken(token)
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${resolvedToken}`,
  }
}

async function readResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const message =
      (typeof err?.error?.message === 'string' && err.error.message) ||
      (typeof err?.detail === 'string' && err.detail) ||
      (typeof err?.message === 'string' && err.message) ||
      `HTTP ${res.status}`
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

export async function getWorkforceConfig(token?: string): Promise<WorkforceConfig> {
  const res = await fetch(`${WORKFORCE_API_BASE}${workforceRoutes.workforce.config}`, {
    method: 'GET',
    credentials: 'include',
    headers: buildHeaders(token),
  })
  return readResponse<WorkforceConfig>(res)
}

export async function updateWorkforceConfig(
  token: string | undefined,
  body: Partial<
    Pick<
      WorkforceConfig,
      'enabled' | 'autonomy_level' | 'check_interval_sec' | 'max_retry_per_feature' | 'allow_verdict_override' | 'sleep_mode'
    >
  >,
): Promise<WorkforceConfig> {
  const res = await fetch(`${WORKFORCE_API_BASE}${workforceRoutes.workforce.config}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: buildHeaders(token),
    body: JSON.stringify(body),
  })
  return readResponse<WorkforceConfig>(res)
}

export async function forceWakeWorkforce(
  token: string | undefined,
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
  const res = await fetch(`${WORKFORCE_API_BASE}${workforceRoutes.workforce.forceWake}`, {
    method: 'POST',
    credentials: 'include',
    headers: buildHeaders(token),
    body: JSON.stringify(body),
  })
  return readResponse<Record<string, unknown>>(res)
}

export async function forceRescanWorkforce(token: string | undefined, pipelineId?: number): Promise<{ ok: boolean; fired: number }> {
  const res = await fetch(`${WORKFORCE_API_BASE}${workforceRoutes.workforce.forceRescan}`, {
    method: 'POST',
    credentials: 'include',
    headers: buildHeaders(token),
    body: JSON.stringify(pipelineId ? { pipeline_id: pipelineId } : {}),
  })
  return readResponse<{ ok: boolean; fired: number }>(res)
}

export async function triggerAgent(
  token: string | undefined,
  payload: TriggerAgentPayload,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${WORKFORCE_API_BASE}${workforceRoutes.workforce.triggerAgent}`, {
    method: 'POST',
    credentials: 'include',
    headers: buildHeaders(token),
    body: JSON.stringify(payload),
  })
  return readResponse<Record<string, unknown>>(res)
}

export async function completeActivity(
  token: string | undefined,
  payload: CompleteActivityPayload,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${WORKFORCE_API_BASE}${workforceRoutes.workforce.completeActivity}`, {
    method: 'POST',
    credentials: 'include',
    headers: buildHeaders(token),
    body: JSON.stringify(payload),
  })
  return readResponse<Record<string, unknown>>(res)
}

export async function runWorkforceMaintenance(
  token: string | undefined,
  maxStaleMinutes = 15,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${WORKFORCE_API_BASE}${workforceRoutes.workforce.maintenanceRun}`, {
    method: 'POST',
    credentials: 'include',
    headers: buildHeaders(token),
    body: JSON.stringify({ max_stale_minutes: maxStaleMinutes }),
  })
  return readResponse<Record<string, unknown>>(res)
}

export async function updateAgentStatus(
  token: string | undefined,
  agentId: string,
  status: RuntimeAgent['status'],
): Promise<{ ok: boolean; agent: RuntimeAgent }> {
  const res = await fetch(`${AGENT_RUNTIME_API_BASE}${workforceRoutes.agents.status(agentId)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: buildHeaders(token),
    body: JSON.stringify({ status }),
  })
  return readResponse<{ ok: boolean; agent: RuntimeAgent }>(res)
}

export async function setLeadAgent(
  token: string | undefined,
  agentId: string,
): Promise<{ ok: boolean; agent: RuntimeAgent }> {
  const res = await fetch(`${AGENT_RUNTIME_API_BASE}${workforceRoutes.agents.lead(agentId)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: buildHeaders(token),
  })
  return readResponse<{ ok: boolean; agent: RuntimeAgent }>(res)
}

export async function archiveAgent(
  token: string | undefined,
  agentId: string,
): Promise<{ ok: boolean; id: string }> {
  const res = await fetch(`${AGENT_RUNTIME_API_BASE}${workforceRoutes.agents.detail(agentId)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: buildHeaders(token),
  })
  return readResponse<{ ok: boolean; id: string }>(res)
}

export async function restoreAgent(
  token: string | undefined,
  agentId: string,
): Promise<{ ok: boolean; id: string }> {
  const res = await fetch(`${AGENT_RUNTIME_API_BASE}${workforceRoutes.agents.restore(agentId)}`, {
    method: 'POST',
    credentials: 'include',
    headers: buildHeaders(token),
  })
  return readResponse<{ ok: boolean; id: string }>(res)
}

// --- Chat access (who may DM a company agent) ---

export type ChatAccessMode = 'everyone' | 'selected' | 'nobody'

export type ChatAccessMember = {
  id: string
  name: string
  email: string
  role: string
  selected: boolean
}

export type AgentChatAccess = {
  agent_id: string
  mode: ChatAccessMode
  members: ChatAccessMember[]
}

export async function getAgentChatAccess(
  token: string | undefined,
  agentId: string,
): Promise<AgentChatAccess> {
  const res = await fetch(`${AGENT_RUNTIME_API_BASE}${workforceRoutes.agents.chatAccess(agentId)}`, {
    method: 'GET',
    credentials: 'include',
    headers: buildHeaders(token),
  })
  return readResponse<AgentChatAccess>(res)
}

export async function updateAgentChatAccess(
  token: string | undefined,
  agentId: string,
  mode: ChatAccessMode,
  userIds: string[] = [],
): Promise<AgentChatAccess> {
  const res = await fetch(`${AGENT_RUNTIME_API_BASE}${workforceRoutes.agents.chatAccess(agentId)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: buildHeaders(token),
    body: JSON.stringify({ mode, user_ids: userIds }),
  })
  return readResponse<AgentChatAccess>(res)
}
