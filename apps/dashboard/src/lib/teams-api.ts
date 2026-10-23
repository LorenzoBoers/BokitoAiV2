/** Teams, the company team overview and availability. */

import { appRoutes } from '../api/routes/app.routes'
import type { AgentPassport } from './workforce-api'
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from './api'

export type TeamKind = 'custom'
export type TeamPickup = 'people' | 'agent_first' | 'round_robin' | 'least_open'
/** People: available|away|offline. Agents/teams may also use standby|working. */
export type PresenceStatus = 'available' | 'away' | 'offline' | 'standby' | 'working' | 'unavailable'

export type AgentPresenceStatus = 'standby' | 'working' | 'error'

export function parsePresenceStatus(value: unknown): PresenceStatus | undefined {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
  if (
    raw === 'available' ||
    raw === 'away' ||
    raw === 'offline' ||
    raw === 'standby' ||
    raw === 'working' ||
    raw === 'unavailable'
  ) {
    return raw
  }
  return undefined
}

export type TeamMemberRef = {
  kind: 'user' | 'agent'
  id: string
  duty?: 'primary' | 'backup' | 'member'
  position?: number
}

export type OrgGraphMark = {
  avatar_kind?: string
  avatar_icon?: string
  avatar_color?: string
  avatar_shape?: string
  avatar_image_url?: string | null
  name?: string
  icon?: string
  color?: string
  channel?: string
  provider?: string
}

export type OrgGraphNode = {
  id: string
  kind: string
  label: string
  href?: string
  x: number
  y: number
  region?: string
  mark?: OrgGraphMark
}
export type OrgGraphEdge = {
  id: string
  kind: string
  source: string
  target: string
  points: number[][]
}
export type OrgGraphRegion = {
  id: string
  label: string
  href?: string
  points: number[][]
  labelAt?: number[]
  shape?: string
}
export type OrgGraph = {
  revision: number
  projection?: string
  regions?: OrgGraphRegion[]
  nodes: OrgGraphNode[]
  edges: OrgGraphEdge[]
}

export function getOrgGraph(token: string): Promise<OrgGraph> {
  return apiGet<OrgGraph>(appRoutes.teams.graph, token)
}

export type TeamAvatarKind = 'initials' | 'icon' | 'image'

export type Team = {
  id: string
  name: string
  description: string
  kind: TeamKind
  /** True for the All root (undeletable; Everyone in the access picker). */
  system: boolean
  root?: boolean
  parent_id?: string | null
  pickup: TeamPickup
  /** Communication folder; All is pinned too. */
  pinned: boolean
  members: TeamMemberRef[]
  member_count: number
  presence?: { status: PresenceStatus }
  /** Fallback mark for pickers when no member faces are known. */
  avatar_kind?: TeamAvatarKind | string
  avatar_icon?: string | null
  avatar_color?: string | null
  avatar_image_url?: string | null
  /** Lucide icon id for the left menu and the Departments list. */
  icon?: string
}

export type Presence = {
  status: PresenceStatus
  last_seen_at: string | null
  away_until: string | null
}

export type WorkforceMemberType = 'person' | 'ai_agent'

export type OverviewPerson = {
  uuid: string
  member_type?: WorkforceMemberType
  name: string
  email: string
  avatar_url: string | null
  role: string
  presence: Presence
  team_ids: string[]
  open_owned: number
  open_turn: number
  deactivated?: boolean
}

/** Last 30 days. */
export type OverviewMetrics = {
  questions: number
  /** Median minutes from question to answer. */
  answer_minutes: number | null
  /** Share of answered questions approved as proposed. */
  unchanged_rate: number | null
  picked_up: number
}

export type OverviewAgent = AgentPassport & {
  member_type?: WorkforceMemberType
  team_ids: string[]
  open_owned: number
  deactivated?: boolean
  metrics: OverviewMetrics
}

export type OverviewTeam = Team & { metrics: OverviewMetrics }

export type TeamOverview = {
  people: OverviewPerson[]
  agents: OverviewAgent[]
  teams: OverviewTeam[]
}

export function formatAnswerMinutes(minutes: number | null): string {
  if (minutes == null) return '-'
  if (minutes < 60) return `${Math.round(minutes)}m`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 60 / 24)}d`
}

export const PICKUP_MODES: TeamPickup[] = ['people', 'agent_first', 'round_robin', 'least_open']


export function listTeams(token: string): Promise<Team[]> {
  return apiGet<Team[]>(appRoutes.teams.list, token)
}

export type DepartmentNavRow = {
  id: string
  name: string
  icon: string
  open: number
  href: string
}

export function listNavDepartments(token: string): Promise<DepartmentNavRow[]> {
  return apiGet<DepartmentNavRow[]>(appRoutes.teams.nav, token)
}

export function getTeamOverview(token: string): Promise<TeamOverview> {
  return apiGet<TeamOverview>(appRoutes.teams.overview, token)
}

export type DepartmentScorecard = {
  volume?: number
  autonomous_pct?: number
  corrected_pct?: number
  rejected_pct?: number
  median_duration_s?: number
}

export type DepartmentAwareness = {
  agent_id: string
  agent_name: string
  role: string
  follows: string[]
  followable: string[]
  mode: 'off' | 'on_conversation' | 'daily' | 'custom'
  cron: string
  daily_cost_cents: number
  spent_today_cents: number
  max_proposals: number
  cadence: string | null
  next_wake_at: string | null
  last_orientation_at: string | null
  brief: { summary?: string; at?: string; quiet?: boolean } | null
  scope: { flows: string[]; folders: string[]; organizations: string[] }
}

export type DepartmentQuestion = {
  key: string
  question: string
  answer: string | null
  status: 'open' | 'answered'
  asked_at: string | null
  answered_at: string | null
  signal_id: string | null
  message_id: string | null
}

type NamedRef = { id: string; name: string }

export type DepartmentStage = {
  key: string
  name: string
  kind: 'open' | 'waiting' | 'done' | 'closed'
  count: number
  overdue: number
  soon: number
}

export type DepartmentFlow = {
  id: string
  name: string
  label: string
  label_id: string | null
  autonomy: string
  open: number
  waiting: number
  overdue: number
  scorecard: DepartmentScorecard | null
  stages: DepartmentStage[]
  board_href: string
}

export type DepartmentBottleneck = { key: string; count: number }

/** One folder tab: the department's work scoped to tickets in that folder. */
export type DepartmentFolderScope = NamedRef & {
  open: number
  home: boolean
  href: string
  totals: { open: number; waiting: number; overdue: number }
  bottlenecks: DepartmentBottleneck[]
  flows: DepartmentFlow[]
}

export type DepartmentOverview = {
  id: string
  name: string
  description: string
  /** Lucide icon id shown in the left menu. */
  icon: string
  /** The department above this one. Null on the root. */
  parent: {
    id: string
    name: string
    is_root: boolean
    members: Array<{
      kind: 'user' | 'agent'
      id: string
      name: string
      avatar_kind?: string | null
      avatar_icon?: string | null
      avatar_color?: string | null
      avatar_shape?: string | null
      avatar_image_url?: string | null
    }>
  } | null
  lead: {
    id: string
    name: string
    status?: string | null
    avatar_kind?: string | null
    avatar_icon?: string | null
    avatar_color?: string | null
    avatar_shape?: string | null
    avatar_image_url?: string | null
  } | null
  accountable: { id: string; name: string; presence?: string | null } | null
  autonomy: string | null
  origin_module: { slug: string; name: string } | null
  room_signal_id: string | null
  pickup: string
  members: Array<{
    kind: 'user' | 'agent'
    id: string
    name: string
    duty: string
    hours_per_week?: number | null
    open_assigned?: number | null
    presence?: string | null
    status?: string | null
    doing?: string
    cost_cents?: number | null
  }>
  flows: DepartmentFlow[]
  totals: { open: number; waiting: number; overdue: number }
  today: {
    bottlenecks: DepartmentBottleneck[]
    decisions_waiting: number
    orientation: { at: string | null; summary: string; quiet: boolean; signal_id: string } | null
  }
  /** Learning proposals of the department lead that still wait for an answer. */
  proposals: Array<{
    change_id: string
    decision_id: string
    kind: string
    summary: string
    signal_id: string
    created_at: string
  }>
  proposal_history: Array<{
    change_id: string
    kind: string
    summary: string
    status: 'accepted' | 'rejected'
    resolved_at: string | null
  }>
  awareness: DepartmentAwareness | null
  reach: {
    flows: Array<NamedRef & { label: string }>
    channels: Array<NamedRef & { channel: string }>
    connections: Array<NamedRef & { provider: string }>
    modules: string[]
    organizations: NamedRef[]
  }
  lands: Array<NamedRef & { open: number; home: boolean; href: string }>
  folders: DepartmentFolderScope[]
  reach_attempts: {
    attempts: Array<{
      at: string
      signal_id: string
      subject: string
      channel: string
      status: string
      recipient: string
    }>
    per_person: Array<{ user_id: string; name: string; count: number }>
  } | null
  domain_questions: DepartmentQuestion[]
  outcomes: {
    accepted: number
    rejected: number
    per_flow: Array<NamedRef & { feedback: number }>
  } | null
  grid_href: string
}

export function getDepartmentOverview(token: string, id: string): Promise<DepartmentOverview> {
  return apiGet<DepartmentOverview>(appRoutes.teams.departmentOverview(id), token)
}

export function askDomainQuestion(token: string, id: string, question: string): Promise<DepartmentQuestion> {
  return apiPost<DepartmentQuestion>(appRoutes.teams.domainQuestions(id), { question }, token)
}

export function answerDomainQuestion(
  token: string,
  id: string,
  key: string,
  answer: string,
): Promise<DepartmentQuestion> {
  return apiPatch<DepartmentQuestion>(appRoutes.teams.domainQuestion(id, key), { answer }, token)
}

export function patchDepartmentAwareness(
  token: string,
  id: string,
  patch: Partial<Pick<DepartmentAwareness, 'follows' | 'mode' | 'cron' | 'daily_cost_cents' | 'max_proposals' | 'scope'>>,
): Promise<DepartmentAwareness> {
  return apiPatch<DepartmentAwareness>(appRoutes.teams.awareness(id), patch, token)
}

/** Fired after a department changes so the left menu reloads its list. */
export const DEPARTMENTS_CHANGED_EVENT = 'bokito:departments-changed'

function announceDepartments<T>(value: T): T {
  window.dispatchEvent(new Event(DEPARTMENTS_CHANGED_EVENT))
  return value
}

export function createTeam(
  token: string,
  body: {
    name: string
    description?: string
    pickup?: TeamPickup
    members?: TeamMemberRef[]
  },
): Promise<Team> {
  return apiPost<Team>(appRoutes.teams.list, body, token).then(announceDepartments)
}

export function patchTeam(
  token: string,
  id: string,
  body: {
    name?: string
    description?: string
    pickup?: TeamPickup
    /** Lucide icon id for the left menu; empty string resets it. */
    icon?: string
  },
): Promise<Team> {
  return apiPatch<Team>(appRoutes.teams.byId(id), body, token).then(announceDepartments)
}

export function setTeamMembers(token: string, id: string, members: TeamMemberRef[]): Promise<Team> {
  return apiPut<Team>(appRoutes.teams.members(id), { members }, token).then(announceDepartments)
}

export function deleteTeam(token: string, id: string): Promise<unknown> {
  return apiDelete(appRoutes.teams.byId(id), token).then(announceDepartments)
}

export function setMyAvailability(
  token: string,
  mode: 'online' | 'away' | 'unavailable',
  until?: string | null,
): Promise<Presence> {
  return apiPut<Presence>(appRoutes.teams.myAvailability, { mode, until: until ?? null }, token)
}

export function setMyAway(token: string, away: boolean, until?: string | null): Promise<Presence> {
  return apiPut<Presence>(appRoutes.teams.myAway, { away, until: until ?? null }, token)
}

export function openTeamRoom(token: string, teamId: string): Promise<{ id: string; title: string }> {
  return apiPost(appRoutes.teams.room(teamId), {}, token)
}
