import { casesRoutes } from '../api/routes'
import { apiDelete, apiGet, apiPatch, apiPost } from './api'

export type CaseStatus =
  | 'proposed'
  | 'open'
  | 'waiting_customer'
  | 'waiting_operator'
  | 'linked'
  | 'closed'
  | 'cancelled'

export type CaseCreateMode = 'ask_customer' | 'ask_operator' | 'auto' | 'manual_only'

/** How a type behaves after classification. */
export type CaseFollowUpMode = 'label' | 'track' | 'route'

export type CaseTypeRow = {
  id: string
  slug: string
  name: string
  description: string
  create_mode: CaseCreateMode
  follow_up_mode: CaseFollowUpMode
  ask_threshold: number
  auto_threshold: number
  requires_verification: boolean
  allow_project_link: 'never' | 'optional' | 'required'
  audience: 'customer' | 'internal' | 'both'
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
  title: string
  summary: string
  status: CaseStatus
  certainty: number | null
  created_at: string | null
  updated_at?: string | null
  /** Thread subject, only present on hub list responses. */
  signal_subject?: string
}

export type CaseStats = Record<CaseStatus, number>

export type DeleteCaseTypeResult = {
  ok: boolean
  archived: boolean
  cases: number
  closed?: number
}

export async function listCases(opts?: {
  status?: CaseStatus
  caseTypeId?: string
  q?: string
  /** Hub queue should pass false so label-only stamps stay out of Open/Waiting. */
  includeLabels?: boolean
  limit?: number
  offset?: number
}): Promise<CaseRow[]> {
  const params = new URLSearchParams()
  if (opts?.status) params.set('status', opts.status)
  if (opts?.caseTypeId) params.set('case_type_id', opts.caseTypeId)
  if (opts?.q) params.set('q', opts.q)
  if (opts?.includeLabels === false) params.set('include_labels', 'false')
  if (opts?.includeLabels === true) params.set('include_labels', 'true')
  if (opts?.limit) params.set('limit', String(opts.limit))
  if (opts?.offset) params.set('offset', String(opts.offset))
  const path = params.size > 0 ? casesRoutes.listQuery(params) : casesRoutes.list
  const res = await apiGet<{ items: CaseRow[] }>(path)
  return res.items ?? []
}

export async function getCaseStats(): Promise<CaseStats> {
  const res = await apiGet<{ counts: CaseStats }>(casesRoutes.stats)
  return res.counts
}

export async function getCase(caseId: string): Promise<CaseRow> {
  return apiGet<CaseRow>(casesRoutes.byId(caseId))
}

export async function patchCase(
  caseId: string,
  body: { title?: string; summary?: string; status?: CaseStatus; project_id?: string | null },
): Promise<CaseRow> {
  return apiPatch<CaseRow>(casesRoutes.byId(caseId), body)
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
  follow_up_mode?: CaseFollowUpMode
  ask_threshold?: number
  auto_threshold?: number
  requires_verification?: boolean
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
      | 'follow_up_mode'
      | 'enabled'
      | 'ask_threshold'
      | 'auto_threshold'
      | 'requires_verification'
      | 'audience'
    >
  >,
): Promise<CaseTypeRow> {
  return apiPatch<CaseTypeRow>(casesRoutes.typeById(typeId), body)
}

export async function deleteCaseType(typeId: string): Promise<DeleteCaseTypeResult> {
  return apiDelete<DeleteCaseTypeResult>(casesRoutes.typeById(typeId))
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
