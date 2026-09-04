import { appRoutes } from '../api/routes/app.routes'
import { apiDelete, apiGet, apiPatch, apiPost } from './api'

export type AgentTask = {
  id: string
  kind?: string
  title: string
  description: string
  status: string
  priority?: string
  origin?: string
  pause_reason?: string | null
  signal_id?: string | null
  workstream_id?: string | null
  current_step_id?: string | null
  assignee_kind?: string
  assignee_agent_id?: string | null
  assignee_user_id?: string | null
  scheduled_for?: string | null
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
  end_at?: string | null
  status: string
  run_id: string | null
  /** Thread the trigger posts its results into, when it has one. */
  signal_id?: string | null
  source?: string | null
  provider?: string | null
  provider_label?: string | null
  calendar_id?: string | null
  calendar_name?: string | null
  location?: string | null
  html_link?: string | null
  all_day?: boolean
  connection_id?: string | null
  external_id?: string | null
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
