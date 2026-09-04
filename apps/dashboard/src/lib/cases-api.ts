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

export type CaseTypeRow = {
  id: string
  slug: string
  name: string
  description: string
  create_mode: CaseCreateMode
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
  audience?: CaseTypeRow['audience']
}): Promise<CaseTypeRow> {
  return apiPost<CaseTypeRow>(casesRoutes.types, body)
}

export async function patchCaseType(
  typeId: string,
  body: Partial<Pick<CaseTypeRow, 'name' | 'description' | 'create_mode' | 'enabled' | 'ask_threshold' | 'auto_threshold' | 'requires_verification'>>,
): Promise<CaseTypeRow> {
  return apiPatch<CaseTypeRow>(casesRoutes.typeById(typeId), body)
}

export async function deleteCaseType(typeId: string): Promise<void> {
  await apiDelete(casesRoutes.typeById(typeId))
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
