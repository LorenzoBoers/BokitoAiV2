import { casesRoutes } from '../api/routes'
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from './api'

/**
 * `proposed` sits before the lifecycle: an unsure read the operator still has to
 * accept on the thread. Accepted work moves through open -> waiting -> done; a
 * ticket's status is always the kind of its current stage.
 */
export type CaseStatus = 'proposed' | 'open' | 'waiting' | 'done'

export type TicketStageKind = 'open' | 'waiting' | 'done'

/** One stage of the pipeline a workstream defines for its tickets. */
export type TicketStage = { key: string; name: string; kind: TicketStageKind }

export const STAGE_KIND_DOT: Record<TicketStageKind, string> = {
  open: 'bg-accent',
  waiting: 'bg-status-warning',
  done: 'bg-status-success',
}

export type CaseCreateMode = 'ask_customer' | 'ask_operator' | 'auto' | 'manual_only'

export type CaseSendMode = 'draft' | 'ask' | 'send'

export type CaseTypeRow = {
  id: string
  slug: string
  name: string
  description: string
  create_mode: CaseCreateMode
  ask_threshold: number
  auto_threshold: number
  requires_verification: boolean
  /** Project every case of this type lands in when the thread has none. */
  default_project_id: string | null
  allow_project_link: 'never' | 'optional' | 'required'
  audience: 'customer' | 'internal' | 'both'
  /** draft/ask: replies on conversations with this type are never sent autonomously. */
  send_mode: CaseSendMode
  enabled: boolean
  module_slug: string
  template_slug: string
  sort_order: number
}

export type CaseBindingRow = {
  id: string
  case_type_id: string
  target_kind: 'workstream' | 'project'
  target_id: string
  priority: number
  auto_link: boolean
  auto_start_run: boolean
  enabled: boolean
}

export type CaseRow = {
  id: string
  case_type_id: string
  case_type: CaseTypeRow | null
  signal_id: string
  contact_id: string | null
  project_id: string | null
  workstream_id: string | null
  workstream_run_id: string | null
  current_step_name: string | null
  /** Bound to a workstream: moves through stages instead of only labelling. */
  is_ticket: boolean
  stage_key: string | null
  /** Present on single-case and per-thread responses. */
  stage?: TicketStage | null
  stages?: TicketStage[]
  title: string
  summary: string
  status: CaseStatus
  certainty: number | null
  created_at: string | null
  updated_at?: string | null
  /** Thread subject, only present on hub list responses. */
  signal_subject?: string
}

export type DeleteCaseTypeResult = {
  ok: boolean
  archived: boolean
  cases: number
  closed?: number
}

export async function listCases(opts?: {
  status?: CaseStatus
  caseTypeId?: string
  projectId?: string
  q?: string
  /** Only tickets (categories bound to a workstream), not plain labels. */
  ticketsOnly?: boolean
  limit?: number
  offset?: number
}): Promise<CaseRow[]> {
  const params = new URLSearchParams()
  if (opts?.status) params.set('status', opts.status)
  if (opts?.caseTypeId) params.set('case_type_id', opts.caseTypeId)
  if (opts?.projectId) params.set('project_id', opts.projectId)
  if (opts?.q) params.set('q', opts.q)
  if (opts?.ticketsOnly) params.set('tickets_only', 'true')
  if (opts?.limit) params.set('limit', String(opts.limit))
  if (opts?.offset) params.set('offset', String(opts.offset))
  const path = params.size > 0 ? casesRoutes.listQuery(params) : casesRoutes.list
  const res = await apiGet<{ items: CaseRow[] }>(path)
  return res.items ?? []
}

export async function getCase(caseId: string): Promise<CaseRow> {
  return apiGet<CaseRow>(casesRoutes.byId(caseId))
}

/** Dismissing a proposal removes it: the response is then `{ id, removed: true }`. */
export async function patchCase(
  caseId: string,
  body: {
    title?: string
    summary?: string
    status?: CaseStatus
    stage_key?: string
    project_id?: string | null
  },
): Promise<CaseRow | { id: string; removed: true }> {
  return apiPatch<CaseRow | { id: string; removed: true }>(casesRoutes.byId(caseId), body)
}

export async function linkCase(
  caseId: string,
  body: { target_kind: 'workstream' | 'project'; target_id: string; auto_start_run?: boolean },
): Promise<CaseRow> {
  return apiPost<CaseRow>(casesRoutes.link(caseId), body)
}

export async function listCaseTypes(): Promise<CaseTypeRow[]> {
  const res = await apiGet<{ items: CaseTypeRow[] }>(casesRoutes.types)
  return res.items ?? []
}

export async function createCaseType(body: {
  name: string
  slug?: string
  description?: string
  create_mode?: CaseCreateMode
  ask_threshold?: number
  auto_threshold?: number
  requires_verification?: boolean
  default_project_id?: string | null
  audience?: CaseTypeRow['audience']
}): Promise<CaseTypeRow> {
  return apiPost<CaseTypeRow>(casesRoutes.types, body)
}

export async function patchCaseType(
  typeId: string,
  body: Partial<
    Pick<
      CaseTypeRow,
      | 'name'
      | 'description'
      | 'create_mode'
      | 'enabled'
      | 'ask_threshold'
      | 'auto_threshold'
      | 'requires_verification'
      | 'default_project_id'
      | 'audience'
      | 'send_mode'
    >
  >,
): Promise<CaseTypeRow> {
  return apiPatch<CaseTypeRow>(casesRoutes.typeById(typeId), body)
}

export async function deleteCaseType(typeId: string): Promise<DeleteCaseTypeResult> {
  const res = await apiDelete<DeleteCaseTypeResult>(casesRoutes.typeById(typeId))
  return res || { ok: true, archived: false, cases: 0 }
}

export async function listCaseBindings(opts?: {
  caseTypeId?: string
  targetKind?: 'workstream' | 'project'
  targetId?: string
}): Promise<CaseBindingRow[]> {
  const params = new URLSearchParams()
  if (opts?.caseTypeId) params.set('case_type_id', opts.caseTypeId)
  if (opts?.targetKind) params.set('target_kind', opts.targetKind)
  if (opts?.targetId) params.set('target_id', opts.targetId)
  const path = params.size > 0 ? casesRoutes.bindingsQuery(params) : casesRoutes.bindings
  const res = await apiGet<{ items: CaseBindingRow[] }>(path)
  return res.items ?? []
}

export async function createCaseBinding(body: {
  case_type_id: string
  target_kind: 'workstream' | 'project'
  target_id: string
  auto_link?: boolean
  auto_start_run?: boolean
  priority?: number
}): Promise<CaseBindingRow> {
  return apiPost<CaseBindingRow>(casesRoutes.bindings, body)
}

export async function deleteCaseBinding(bindingId: string): Promise<void> {
  await apiDelete(casesRoutes.bindingById(bindingId))
}

/** Who may accept a proposed signal on a thread. */
export type SignalAcceptRoles = 'admins' | 'members'

export type SignalPolicy = {
  accept_roles: SignalAcceptRoles
  backlog_threshold: number
  may_accept: boolean
}

/** A pattern interpretation keeps seeing that no type covers yet. */
export type SignalBacklogEntry = {
  key: string
  name: string
  sentence: string
  examples: string[]
  count: number
  first_seen: string | null
  last_seen: string | null
  /** Seen at least `backlog_threshold` times — ready to become a type. */
  ready: boolean
}

export async function getSignalPolicy(): Promise<SignalPolicy> {
  return apiGet<SignalPolicy>(casesRoutes.policy)
}

export async function saveSignalPolicy(body: {
  accept_roles?: SignalAcceptRoles
  backlog_threshold?: number
}): Promise<SignalPolicy> {
  return apiPut<SignalPolicy>(casesRoutes.policy, body)
}

export async function listSignalBacklog(): Promise<{
  items: SignalBacklogEntry[]
  threshold: number
}> {
  const res = await apiGet<{ items: SignalBacklogEntry[]; threshold: number }>(casesRoutes.backlog)
  return { items: res.items ?? [], threshold: res.threshold ?? 3 }
}

export async function promoteSignalBacklog(
  key: string,
  body?: { name?: string; description?: string },
): Promise<CaseTypeRow> {
  return apiPost<CaseTypeRow>(casesRoutes.backlogPromote(key), body ?? {})
}

export async function dismissSignalBacklog(key: string): Promise<void> {
  await apiDelete(casesRoutes.backlogEntry(key))
}

export async function listCasesForSignal(signalId: string): Promise<CaseRow[]> {
  const res = await apiGet<{ items: CaseRow[] }>(casesRoutes.forSignal(signalId))
  return res.items ?? []
}

export async function createCase(body: {
  case_type_id: string
  signal_id: string
  title?: string
  summary?: string
}): Promise<{ case: CaseRow }> {
  return apiPost<{ case: CaseRow }>(casesRoutes.list, body)
}
