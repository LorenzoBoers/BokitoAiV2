import { appRoutes } from '../api/routes/app.routes'
import { apiDelete, apiGet, apiPatch, apiPost } from './api'

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

export type OrchestrationSettings = {
  orchestra_enabled: boolean
  monthly_budget_cents: number
}

export type Workstream = {
  id: string
  name: string
  description?: string
  enabled: boolean
}

export async function getOrchestrationSettings(): Promise<OrchestrationSettings> {
  return apiGet<OrchestrationSettings>(appRoutes.orchestration.settings)
}

export async function listWorkstreams(): Promise<Workstream[]> {
  return apiGet<Workstream[]>(appRoutes.orchestration.workstreams)
}

export async function createWorkstream(body: { name: string; description?: string }): Promise<{ id: string }> {
  return apiPost<{ id: string }>(appRoutes.orchestration.workstreams, body)
}

export async function listRuntimeProfiles(): Promise<RuntimeProfile[]> {
  return apiGet<RuntimeProfile[]>(appRoutes.orchestration.runtimeProfiles)
}

export async function createRuntimeProfile(body: Partial<RuntimeProfile> & { name: string }): Promise<{ id: string }> {
  return apiPost<{ id: string }>(appRoutes.orchestration.runtimeProfiles, body)
}

export async function listAgentTasks(opts?: { signalId?: string }): Promise<AgentTask[]> {
  const path = opts?.signalId
    ? `${appRoutes.orchestration.tasks}?signal_id=${encodeURIComponent(opts.signalId)}`
    : appRoutes.orchestration.tasks
  return apiGet<AgentTask[]>(path)
}

export async function createAgentTask(body: {
  title: string
  description?: string
  project_id?: string
  workstream_id?: string
  agent_id?: string
  signal_id?: string
  default_runtime_profile_id?: string
  success_criteria_json?: string
}): Promise<AgentTask> {
  return apiPost<AgentTask>(appRoutes.orchestration.tasks, body)
}

export async function getAgentTask(taskId: string): Promise<AgentTask> {
  return apiGet<AgentTask>(appRoutes.orchestration.task(taskId))
}

export async function cancelAgentTask(taskId: string): Promise<AgentTask> {
  return apiPost<AgentTask>(appRoutes.orchestration.taskCancel(taskId), {})
}

export async function resumeAgentTask(taskId: string): Promise<AgentTask> {
  return apiPost<AgentTask>(appRoutes.orchestration.taskResume(taskId), {})
}

export async function listTaskArtifacts(taskId: string): Promise<TaskArtifact[]> {
  return apiGet<TaskArtifact[]>(appRoutes.orchestration.taskArtifacts(taskId))
}

export async function runWorkstreamOrchestrated(workstreamId: string): Promise<AgentTask> {
  return apiPost<AgentTask>(appRoutes.orchestration.workstreamRun(workstreamId), {})
}

export async function listWorkstreamSteps(workstreamId: string): Promise<WorkstreamStep[]> {
  return apiGet<WorkstreamStep[]>(appRoutes.orchestration.workstreamSteps(workstreamId))
}

export async function createWorkstreamStep(
  workstreamId: string,
  body: Partial<WorkstreamStep> & { name: string; order?: number },
): Promise<{ id: string }> {
  return apiPost<{ id: string }>(appRoutes.orchestration.workstreamSteps(workstreamId), body)
}

export async function deleteWorkstreamStep(workstreamId: string, stepId: string): Promise<void> {
  await apiDelete(appRoutes.orchestration.workstreamStep(workstreamId, stepId))
}

export async function fetchRunEvents(runId: string): Promise<{
  run_id: string
  status: string
  runtime_snapshot: Record<string, unknown>
  events: Array<{ type: string; message: string; payload: Record<string, unknown>; sequence: number }>
}> {
  return apiGet(appRoutes.orchestration.runEvents(runId))
}

export type TriggerKind = 'cron' | 'interval' | 'heartbeat' | 'webhook' | 'once' | 'event'

export type Trigger = {
  id: string
  name: string
  kind: TriggerKind
  cron_expr: string
  interval_minutes: number
  agent_id: string | null
  agent_role: string
  workstream_id: string | null
  instructions: string
  has_webhook_secret: boolean
  enabled: boolean
  last_run_at: string | null
  next_run_at: string | null
  last_status: string
  created_at: string | null
  webhook_secret?: string
}

export async function listTriggers(): Promise<Trigger[]> {
  const res = await apiGet<{ triggers: Trigger[] }>(appRoutes.triggers.list)
  return res.triggers ?? []
}

export async function createTrigger(body: {
  name: string
  kind: TriggerKind
  cron_expr?: string
  interval_minutes?: number
  agent_id?: string
  agent_role?: string
  workstream_id?: string
  instructions?: string
  enabled?: boolean
  run_at?: string
}): Promise<Trigger> {
  return apiPost<Trigger>(appRoutes.triggers.list, body)
}

export async function updateTrigger(
  triggerId: string,
  body: Partial<Trigger> & { run_at?: string },
): Promise<Trigger> {
  return apiPatch<Trigger>(appRoutes.triggers.byId(triggerId), body)
}

export async function deleteTrigger(triggerId: string): Promise<void> {
  await apiDelete(appRoutes.triggers.byId(triggerId))
}

export async function runTrigger(triggerId: string): Promise<{ status: string }> {
  return apiPost(appRoutes.triggers.run(triggerId), {})
}

export async function rotateWebhookSecret(triggerId: string): Promise<Trigger> {
  return apiPost<Trigger>(appRoutes.triggers.rotateWebhookSecret(triggerId), {})
}

export type WebhookTestResult = {
  ok: boolean
  status?: string
  run_id?: string
  task_id?: string
}

export async function testWebhookTrigger(triggerId: string): Promise<WebhookTestResult> {
  return apiPost<WebhookTestResult>(appRoutes.triggers.testWebhook(triggerId), {})
}

export function webhookHookUrl(triggerId: string): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/api/hooks/${triggerId}`
  }
  return `/api/hooks/${triggerId}`
}

export type AgendaItem = {
  id: string
  trigger_id: string | null
  name: string
  kind: TriggerKind | string
  agent_id: string | null
  agent_role: string
  agent_name: string | null
  instructions: string
  enabled: boolean
  at: string
  status: string
  run_id: string | null
}

export async function listAgendaOccurrences(params: {
  from?: string
  to?: string
  agentId?: string
}): Promise<AgendaItem[]> {
  const query = new URLSearchParams()
  if (params.from) query.set('from', params.from)
  if (params.to) query.set('to', params.to)
  if (params.agentId) query.set('agent_id', params.agentId)
  const res = await apiGet<{ items: AgendaItem[] }>(appRoutes.agenda.occurrencesQuery(query))
  return res.items ?? []
}
