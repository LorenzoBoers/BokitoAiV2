import { appRoutes } from '../api/routes/app.routes'
import { APP_API_BASE } from '../lib/api.config'
import { xanoGet, xanoPost } from './xano'

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

export async function listRuntimeProfiles(): Promise<RuntimeProfile[]> {
  return xanoGet<RuntimeProfile[]>(appRoutes.orchestration.runtimeProfiles)
}

export async function createRuntimeProfile(body: Partial<RuntimeProfile> & { name: string }): Promise<{ id: string }> {
  return xanoPost<{ id: string }>(appRoutes.orchestration.runtimeProfiles, body)
}

export async function listAgentTasks(): Promise<AgentTask[]> {
  return xanoGet<AgentTask[]>(appRoutes.orchestration.tasks)
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
  return xanoPost<AgentTask>(appRoutes.orchestration.tasks, body)
}

export async function getAgentTask(taskId: string): Promise<AgentTask> {
  return xanoGet<AgentTask>(appRoutes.orchestration.task(taskId))
}

export async function cancelAgentTask(taskId: string): Promise<AgentTask> {
  return xanoPost<AgentTask>(appRoutes.orchestration.taskCancel(taskId), {})
}

export async function listTaskArtifacts(taskId: string): Promise<TaskArtifact[]> {
  return xanoGet<TaskArtifact[]>(appRoutes.orchestration.taskArtifacts(taskId))
}

export async function runWorkstreamOrchestrated(workstreamId: string): Promise<AgentTask> {
  return xanoPost<AgentTask>(appRoutes.orchestration.workstreamRun(workstreamId), {})
}

export async function listWorkstreamSteps(workstreamId: string): Promise<WorkstreamStep[]> {
  return xanoGet<WorkstreamStep[]>(appRoutes.orchestration.workstreamSteps(workstreamId))
}

export async function createWorkstreamStep(
  workstreamId: string,
  body: Partial<WorkstreamStep> & { name: string; order?: number },
): Promise<{ id: string }> {
  return xanoPost<{ id: string }>(appRoutes.orchestration.workstreamSteps(workstreamId), body)
}

export function runEventsStreamUrl(runId: string): string {
  return `${APP_API_BASE}${appRoutes.orchestration.runEventsStream(runId)}`
}

export async function fetchRunEvents(runId: string): Promise<{
  run_id: string
  status: string
  runtime_snapshot: Record<string, unknown>
  events: Array<{ type: string; message: string; payload: Record<string, unknown>; sequence: number }>
}> {
  return xanoGet(appRoutes.orchestration.runEvents(runId))
}

export async function listAutomationTemplates(): Promise<
  Array<{ id: string; slug: string; name: string; description: string; category: string; template: Record<string, unknown> }>
> {
  return xanoGet(appRoutes.orchestration.automationTemplates)
}
