import { APP_API_BASE } from '../lib/api.config'
import { apiFetch } from '../lib/xano'

export type RuntimeProfile = {
  id: string
  name: string
  slug: string
  role_tag: string
  model: string
  provider: string
  max_loops: number
  max_cost_cents: number
}

export type AgentTask = {
  id: string
  title: string
  description: string
  status: string
  pause_reason?: string | null
  signal_id?: string | null
  workstream_id?: string | null
  current_step_id?: string | null
  context?: Record<string, unknown>
  created_at?: string
  completed_at?: string | null
}

export type TaskArtifact = {
  id: string
  name: string
  artifact_type: string
  content: Record<string, unknown>
  created_at: string
}

export type WorkstreamStep = {
  id: string
  name: string
  order: number
  agent_id?: string | null
  runtime_profile_id?: string | null
  step_kind: string
  prompt_template?: string
  handoff_template?: string
  eval_kind?: string
}

const BASE = `${APP_API_BASE}/orchestration`

export async function listRuntimeProfiles(): Promise<RuntimeProfile[]> {
  return apiFetch(`${BASE}/runtime-profiles`)
}

export async function createRuntimeProfile(body: Partial<RuntimeProfile> & { name: string }): Promise<{ id: string }> {
  return apiFetch(`${BASE}/runtime-profiles`, { method: 'POST', body: JSON.stringify(body) })
}

export async function listAgentTasks(): Promise<AgentTask[]> {
  return apiFetch(`${BASE}/tasks`)
}

export async function createAgentTask(body: {
  title: string
  description?: string
  project_id?: string
  workstream_id?: string
  agent_id?: string
  default_runtime_profile_id?: string
  success_criteria_json?: string
}): Promise<AgentTask> {
  return apiFetch(`${BASE}/tasks`, { method: 'POST', body: JSON.stringify(body) })
}

export async function getAgentTask(taskId: string): Promise<AgentTask> {
  return apiFetch(`${BASE}/tasks/${taskId}`)
}

export async function cancelAgentTask(taskId: string): Promise<AgentTask> {
  return apiFetch(`${BASE}/tasks/${taskId}/cancel`, { method: 'POST' })
}

export async function listTaskArtifacts(taskId: string): Promise<TaskArtifact[]> {
  return apiFetch(`${BASE}/tasks/${taskId}/artifacts`)
}

export async function runWorkstreamOrchestrated(workstreamId: string): Promise<AgentTask> {
  return apiFetch(`${BASE}/workstreams/${workstreamId}/run`, { method: 'POST' })
}

export async function listWorkstreamSteps(workstreamId: string): Promise<WorkstreamStep[]> {
  return apiFetch(`${BASE}/workstreams/${workstreamId}/steps`)
}

export async function createWorkstreamStep(
  workstreamId: string,
  body: Partial<WorkstreamStep> & { name: string; order?: number },
): Promise<{ id: string }> {
  return apiFetch(`${BASE}/workstreams/${workstreamId}/steps`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function runEventsStreamUrl(runId: string): string {
  return `${BASE}/runs/${runId}/events/stream`
}

export async function fetchRunEvents(runId: string): Promise<{
  run_id: string
  status: string
  runtime_snapshot: Record<string, unknown>
  events: Array<{ type: string; message: string; payload: Record<string, unknown>; sequence: number }>
}> {
  return apiFetch(`${BASE}/runs/${runId}/events`)
}

export async function listAutomationTemplates(): Promise<
  Array<{ id: string; slug: string; name: string; description: string; category: string; template: Record<string, unknown> }>
> {
  return apiFetch(`${BASE}/automation-templates`)
}
