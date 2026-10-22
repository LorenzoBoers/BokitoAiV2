import { workstreamsRoutes } from '../api/routes'
import { apiDelete, apiGet, apiPatch, apiPost } from './api'
import type { FlowBoard, TicketStage } from './tickets-api'

export type WorkstreamRunStatus =
  | 'running'
  | 'waiting'
  | 'awaiting_gate'
  | 'completed'
  | 'failed'
  | 'cancelled'
export type WorkstreamInputKind = 'manual' | 'queue_item' | 'signal' | 'trigger' | 'ticket'

/** A flow: the recipe for one kind of signal plus its stage pipeline, titled by its flow label. */
export type FlowAutonomy = '' | 'manual' | 'assisted' | 'autonomous'

export type WorkstreamRow = {
  id: string
  signal_id?: string | null
  /** Operator title (independent of the action-tag hashtag). */
  name: string
  description: string
  /** Folders whose filterset includes this flow's action tag (derived, not an attach list). */
  project_ids: string[]
  /** Action tags linked to this flow (hashtags with workstream_id). */
  tags?: Array<{ id: string; name: string; color?: string; icon?: string }>
  stages: TicketStage[]
  stages_count?: number
  /** This flow's mode under the Govern ceiling; empty follows channel and workspace. */
  autonomy?: FlowAutonomy
  /** The department that runs this flow; null when none. */
  department_id?: string | null
  /** Set when a looser mode waits for approval in Govern. */
  pending_change_id?: string | null
  /** Agent stage moves: empty follows the workspace default. */
  stage_entry_policy?: string
  /** Certainty (0-10) for `auto_above`; null follows the workspace. */
  stage_entry_threshold?: number | null
  deliver_folder_id?: string | null
  deliver_works_in_key?: string
  /** The recipe: the working method, tools / `connection:{id}`, what done produces (free text). */
  instructions?: string
  capabilities?: string[]
  expected_outcome?: string
  /** No waiting stage: handled in the conversation, no board. */
  direct?: boolean
  /** Detail only: the resolved "Delivers to" with labels. */
  deliver_to?: FlowDestination | null
  /** List only: live tickets per stage key. */
  ticket_counts?: Record<string, number>
  /** List only: latest message on any of the flow's tickets. */
  last_activity_at?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export type FlowDestination = {
  folder_id: string
  folder_name: string
  works_in_key: string
  item_kind: string
  item_label: string
  href: string
}

export type WorkstreamDetail = WorkstreamRow

export type WorkstreamRunRow = {
  id: string
  workstream_id: string
  workstream_name?: string
  project_id: string | null
  status: WorkstreamRunStatus
  input_kind: WorkstreamInputKind | string
  input_ref: string
  input_text: string
  current_step_id: string | null
  wait_until: string | null
  summary: string
  error: string
  triggered_by_type: string
  triggered_by_id: string
  started_at: string | null
  completed_at: string | null
  updated_at: string | null
}

export type WorkstreamRunEvent = {
  event_type: string
  message: string
  payload: Record<string, unknown>
  created_at: string | null
}

export type WorkstreamRunAgentRun = {
  id: string
  step_id: string | null
  agent_id: string
  agent_name: string
  status: string
  subject: string
  tokens_input: number
  tokens_output: number
  started_at: string | null
  completed_at: string | null
  events: WorkstreamRunEvent[]
}

export type WorkstreamStepOutput = {
  step_id?: string
  name?: string
  kind?: string
  text?: string
  [key: string]: unknown
}

export type WorkstreamRunDetail = {
  run: WorkstreamRunRow
  workstream: WorkstreamRow
  steps: unknown[]
  step_outputs: WorkstreamStepOutput[]
  agent_runs: WorkstreamRunAgentRun[]
}

export async function listWorkstreams(opts?: { projectId?: string }): Promise<WorkstreamRow[]> {
  const params = new URLSearchParams()
  if (opts?.projectId) params.set('project_id', opts.projectId)
  const path = params.size > 0 ? workstreamsRoutes.listQuery(params) : workstreamsRoutes.list
  const res = await apiGet<{ items: WorkstreamRow[] }>(path)
  return res.items ?? []
}

export async function createWorkstream(body: {
  name: string
  description?: string
  stages?: TicketStage[]
  /** Flow-label hue. Omitted uses the server default (blue). */
  color?: string
  /** Lucide kebab id. Omitted uses the server default (route). */
  icon?: string
}): Promise<WorkstreamRow> {
  return apiPost<WorkstreamRow>(workstreamsRoutes.list, body)
}

export async function getWorkstream(workstreamId: string): Promise<WorkstreamDetail> {
  return apiGet<WorkstreamDetail>(workstreamsRoutes.byId(workstreamId))
}

export async function insertFlowStage(
  workstreamId: string,
  body: { kind: string; index: number },
): Promise<WorkstreamDetail> {
  return apiPost<WorkstreamDetail>(workstreamsRoutes.insertStage(workstreamId), body)
}

export async function patchWorkstream(
  workstreamId: string,
  patch: Partial<
    Pick<
      WorkstreamRow,
      | 'name'
      | 'description'
      | 'stages'
      | 'autonomy'
      | 'department_id'
      | 'deliver_folder_id'
      | 'deliver_works_in_key'
      | 'instructions'
      | 'capabilities'
      | 'expected_outcome'
      | 'direct'
    >
  > & {
    /** The flow's one action tag (at most one id); empty detaches it. */
    tag_ids?: string[]
    /** Empty string follows the workspace default. */
    stage_entry_policy?: string
    /** -1 follows the workspace threshold. */
    stage_entry_threshold?: number
  },
): Promise<WorkstreamRow> {
  return apiPatch<WorkstreamRow>(workstreamsRoutes.byId(workstreamId), patch)
}

export async function getWorkstreamBoard(workstreamId: string): Promise<FlowBoard> {
  return apiGet<FlowBoard>(workstreamsRoutes.board(workstreamId))
}

export async function deleteWorkstream(workstreamId: string): Promise<void> {
  await apiDelete(workstreamsRoutes.byId(workstreamId))
}

export async function startWorkstreamRun(
  workstreamId: string,
  body?: { input_kind?: string; input_text?: string; input_ref?: string; project_id?: string | null },
): Promise<WorkstreamRunRow> {
  return apiPost<WorkstreamRunRow>(workstreamsRoutes.runs(workstreamId), body ?? {})
}

export async function listWorkstreamRuns(opts?: {
  workstreamId?: string
  projectId?: string
  limit?: number
}): Promise<WorkstreamRunRow[]> {
  const params = new URLSearchParams()
  if (opts?.workstreamId) params.set('workstream_id', opts.workstreamId)
  if (opts?.projectId) params.set('project_id', opts.projectId)
  if (opts?.limit) params.set('limit', String(opts.limit))
  const path = params.size > 0 ? workstreamsRoutes.allRunsQuery(params) : workstreamsRoutes.allRuns
  const res = await apiGet<{ items: WorkstreamRunRow[] }>(path)
  return res.items ?? []
}

export async function getWorkstreamRun(runId: string): Promise<WorkstreamRunDetail> {
  return apiGet<WorkstreamRunDetail>(workstreamsRoutes.run(runId))
}

export async function resumeWorkstreamRun(
  runId: string,
  inputText?: string,
): Promise<WorkstreamRunRow> {
  return apiPost<WorkstreamRunRow>(workstreamsRoutes.runResume(runId), {
    input_text: inputText ?? '',
  })
}

export async function cancelWorkstreamRun(runId: string): Promise<WorkstreamRunRow> {
  return apiPost<WorkstreamRunRow>(workstreamsRoutes.runCancel(runId), {})
}

export async function promoteWorkstreamRun(
  runId: string,
): Promise<{ task_id?: string; status?: string }> {
  return apiPost(workstreamsRoutes.runPromote(runId), {})
}
