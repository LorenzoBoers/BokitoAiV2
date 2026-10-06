import type { TFunction } from 'i18next'
import { appRoutes, categoriesRoutes } from '../api/routes'
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from './api'

/**
 * `proposed` sits before the pipeline: an unsure read (or a filing without a
 * project choice) the operator still has to accept on the thread. Accepted
 * tickets move through the playbook's stages; the status is the kind of the
 * current stage.
 *
 * Kind groups (ClickUp-style): open≈not started, waiting≈active, done≈klaar,
 * closed≈closed.
 */
export type TicketStatus = 'proposed' | 'open' | 'waiting' | 'done' | 'closed'

export type TicketStageKind = 'open' | 'waiting' | 'done' | 'closed'

export type TicketStageFieldType = 'text' | 'textarea' | 'number' | 'enum'

/** Optional intake field defined on a flow stage. */
export type TicketStageField = {
  key: string
  name: string
  type: TicketStageFieldType
  required?: boolean
  /** Allowed values when type is ``enum`` (at least two). */
  options?: string[]
}

/** One stage of the pipeline a flow defines for its tickets. */
export type TicketStage = {
  key: string
  name: string
  kind: TicketStageKind
  /** When kind is `done`: close the conversation automatically on enter. */
  auto_close_conversation?: boolean
  /** Optional fields shown when filing (first open stage) or on later stages. */
  fields?: TicketStageField[]
  /** Who takes the ticket on entering this stage; null keeps the current owner. */
  owner?: TicketStageOwner | null
  /** Recurring check-up for the owner while the ticket sits here; 0 is off. */
  checkup_minutes?: number
}

export type TicketStageOwner = { kind: 'user' | 'agent' | 'team'; id: string }

export type TicketCheckup = {
  trigger_id: string
  every_minutes: number
  next_at: string | null
  last_at: string | null
  last_status: string
}

/** @deprecated Prefer StageProgressIcon — kept for compact list chips. */
export const STAGE_KIND_DOT: Record<TicketStageKind, string> = {
  open: 'bg-muted-foreground/70',
  waiting: 'bg-status-warning',
  done: 'bg-status-success',
  closed: 'bg-emerald-400',
}

const DEFAULT_STAGE_NAMES: Record<TicketStageKind, string> = {
  open: 'Open',
  waiting: 'Waiting',
  done: 'Done',
  closed: 'Closed',
}

/** Default stages are stored with English names; renamed stages show as typed. */
export function stageLabel(stage: TicketStage, t: TFunction): string {
  return stage.key === stage.kind && stage.name === DEFAULT_STAGE_NAMES[stage.kind]
    ? t(`tickets.status.${stage.kind}`, { ns: 'nav' })
    : stage.name
}

/** "Every day", "Every 2 weeks", "Off" — check-up rhythm in plain words. */
export function checkupLabel(minutes: number, t: TFunction): string {
  const opts = { ns: 'nav' }
  if (!minutes) return t('workstreamsPage.stages.checkupOff', opts)
  if (minutes % 10080 === 0) return t('workstreamsPage.stages.checkupWeeks', { ...opts, count: minutes / 10080 })
  if (minutes % 1440 === 0) return t('workstreamsPage.stages.checkupDays', { ...opts, count: minutes / 1440 })
  return t('workstreamsPage.stages.checkupHours', { ...opts, count: Math.round(minutes / 60) })
}

export type CategoryCreateMode = 'ask_customer' | 'ask_operator' | 'auto' | 'manual_only'

export type CategorySendMode = 'draft' | 'ask' | 'send'

/** A hashtag with a playbook. */
export type CategoryRow = {
  id: string
  name: string
  description: string
  count: number
  is_category: true
  workstream_id: string
  workstream_name?: string
  pinned: boolean
  show_in_nav: boolean
  create_mode: CategoryCreateMode
  ask_threshold: number
  auto_threshold: number
  /** draft/ask: replies on conversations with this category are never sent autonomously. */
  send_mode: CategorySendMode
  autonomy_level: 'manual' | 'assisted' | 'autonomous'
  requires_verification: boolean
  module_slug: string
  template_slug: string
  sort_order: number
  /** Projects the flow is on. Non-empty: filing needs a project or No project. */
  project_choices: ProjectChoice[]
  /** Intake fields from the first open stage. */
  intake_fields?: TicketStageField[]
  /** Live tickets per status. */
  open: number
  waiting: number
  proposed: number
  /** Filings in the last seven days and the seven before. */
  filed_7d: number
  filed_prev_7d: number
}

export type ProjectChoice = { id: string; name: string }

/** The conversation's ticket, as thread detail and the ticket endpoints return it. */
export type Ticket = {
  signal_id: string
  tag_id: string
  name: string
  status: TicketStatus
  stage_key: string | null
  stage: TicketStage | null
  stages: TicketStage[]
  certainty: number | null
  /** The project chosen when filing; null is No project. */
  project_id: string | null
  /** Projects the playbook is attached to. Empty: the ticket has no project. */
  project_choices: ProjectChoice[]
  workstream_id: string | null
  workstream_name: string | null
  workstream_run_id: string | null
  current_step_name: string | null
  filed_at: string | null
  field_defs?: TicketStageField[]
  fields?: Record<string, string>
  checkup?: TicketCheckup | null
}

/** Compact ticket chip on conversation list rows. */
export type TicketSummary = {
  tag_id: string
  name: string
  status: TicketStatus
  stage: TicketStage | null
  project_id: string | null
}

export function isTicketPending(ticket: Pick<Ticket, 'status' | 'stage_key'> | null | undefined): boolean {
  if (!ticket) return false
  return ticket.status === 'proposed' || (ticket.status === 'waiting' && !ticket.stage_key)
}

export async function listCategories(): Promise<CategoryRow[]> {
  const res = await apiGet<{ items: CategoryRow[] }>(categoriesRoutes.list)
  return res.items ?? []
}

/** Register the hashtag and attach `workstream_id`, or a new playbook named `playbook_name`. */
export async function createCategory(body: {
  name: string
  description?: string
  workstream_id?: string | null
  playbook_name?: string
}): Promise<CategoryRow> {
  return apiPost<CategoryRow>(categoriesRoutes.list, body)
}

export async function patchCategory(
  tagId: string,
  body: Partial<
    Pick<
      CategoryRow,
      | 'description'
      | 'create_mode'
      | 'ask_threshold'
      | 'auto_threshold'
      | 'requires_verification'
      | 'send_mode'
      | 'autonomy_level'
      | 'show_in_nav'
      | 'sort_order'
    >
  > & { workstream_id?: string | null },
): Promise<CategoryRow> {
  return apiPatch<CategoryRow>(categoriesRoutes.byId(tagId), body)
}

/** Make a free tag a category: attach an existing playbook or create one. */
export async function promoteTag(
  tagId: string,
  body: { workstream_id?: string | null; playbook_name?: string } = {},
): Promise<{ id: string; name: string; workstream_id: string | null }> {
  return apiPost(appRoutes.signals.tagPromote(tagId), body)
}

export async function getTicket(signalId: string): Promise<Ticket | null> {
  const res = await apiGet<{ ticket: Ticket | null }>(categoriesRoutes.ticket(signalId))
  return res.ticket ?? null
}

/**
 * File a category on the conversation. When the playbook has projects,
 * `projectId` must be passed: a project id, or `null` for No project.
 */
export async function fileTicket(
  signalId: string,
  tagId: string,
  projectId?: string | null,
  fields?: Record<string, string>,
): Promise<Ticket | null> {
  const body: Record<string, unknown> = { tag_id: tagId }
  if (projectId !== undefined) body.project_id = projectId
  if (fields !== undefined) body.fields = fields
  const res = await apiPut<{ ticket: Ticket | null }>(categoriesRoutes.ticket(signalId), body)
  return res.ticket ?? null
}

/** Accept (`status: open`), dismiss, move or re-project. Null when the ticket was removed. */
export async function patchTicket(
  signalId: string,
  body: {
    status?: TicketStatus | 'dismissed'
    stage_key?: string
    project_id?: string | null
    fields?: Record<string, string>
  },
): Promise<Ticket | null> {
  const res = await apiPatch<{ ticket: Ticket | null }>(categoriesRoutes.ticket(signalId), body)
  return res.ticket ?? null
}

export async function clearTicket(signalId: string): Promise<void> {
  await apiDelete(categoriesRoutes.ticket(signalId))
}

export type BoardTicket = {
  signal_id: string
  subject: string
  contact_name: string
  channel: string
  tag_id: string
  tag: string
  stage_key: string
  status: TicketStatus
  /** Null: filed without a project. */
  project_id?: string | null
  last_message_at: string | null
  assigned_user_id: string | null
  assignee_kind?: 'user' | 'agent' | 'team' | null
  agent_id?: string | null
  fields?: Record<string, string>
  /** Next stage check-up for the owner; null when the stage has none. */
  checkup_at?: string | null
}

/** A lane on a flow board: one project, or `id: null` for No project. */
export type FlowBoardLane = { id: string | null; name: string }

/** One flow's live tickets: columns are stages, lanes are projects. */
export type FlowBoard = ProjectFlowBoard & { lanes: FlowBoardLane[] }

export type ProjectFlowBoard = {
  workstream_id: string
  name: string
  enabled: boolean
  stages: TicketStage[]
  tags: Array<{ id: string; name: string }>
  tickets: BoardTicket[]
}

export async function getProjectBoard(projectId: string): Promise<ProjectFlowBoard[]> {
  const res = await apiGet<{ playbooks: ProjectFlowBoard[] }>(categoriesRoutes.projectBoard(projectId))
  return res.playbooks ?? []
}

/** Who may accept a proposed ticket on a thread. */
export type SignalAcceptRoles = 'admins' | 'members'

export type SignalPolicy = {
  accept_roles: SignalAcceptRoles
  backlog_threshold: number
  may_accept: boolean
}

/** A pattern interpretation keeps seeing that no hashtag covers yet. */
export type SignalBacklogEntry = {
  key: string
  name: string
  sentence: string
  examples: string[]
  count: number
  first_seen: string | null
  last_seen: string | null
  /** Seen at least `backlog_threshold` times: ready to become a category. */
  ready: boolean
}

export async function getSignalPolicy(): Promise<SignalPolicy> {
  return apiGet<SignalPolicy>(categoriesRoutes.policy)
}

export async function saveSignalPolicy(body: {
  accept_roles?: SignalAcceptRoles
  backlog_threshold?: number
}): Promise<SignalPolicy> {
  return apiPut<SignalPolicy>(categoriesRoutes.policy, body)
}

export async function listSignalBacklog(): Promise<{
  items: SignalBacklogEntry[]
  threshold: number
}> {
  const res = await apiGet<{ items: SignalBacklogEntry[]; threshold: number }>(categoriesRoutes.backlog)
  return { items: res.items ?? [], threshold: res.threshold ?? 3 }
}

export async function promoteSignalBacklog(
  key: string,
  body?: { name?: string; description?: string },
): Promise<CategoryRow> {
  return apiPost<CategoryRow>(categoriesRoutes.backlogPromote(key), body ?? {})
}

export async function dismissSignalBacklog(key: string): Promise<void> {
  await apiDelete(categoriesRoutes.backlogEntry(key))
}
