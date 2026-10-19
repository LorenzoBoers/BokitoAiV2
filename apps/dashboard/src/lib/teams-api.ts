/** Teams, the company team overview and availability. */

import { appRoutes } from '../api/routes/app.routes'
import type { AgentPassport } from './workforce-api'
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from './api'

export type TeamKind = 'custom'
export type TeamPickup = 'people' | 'agent_first' | 'round_robin' | 'least_open'
/** People: available|away|offline. Agents/teams may also use standby|working. */
export type PresenceStatus = 'available' | 'away' | 'offline' | 'standby' | 'working'

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
    raw === 'working'
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
  /** Fallback mark only; UI prefers the member facepile. */
  avatar_kind?: TeamAvatarKind | string
  avatar_icon?: string | null
  avatar_color?: string | null
  avatar_image_url?: string | null
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

export function getTeamOverview(token: string): Promise<TeamOverview> {
  return apiGet<TeamOverview>(appRoutes.teams.overview, token)
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
  return apiPost<Team>(appRoutes.teams.list, body, token)
}

export function patchTeam(
  token: string,
  id: string,
  body: {
    name?: string
    description?: string
    pickup?: TeamPickup
  },
): Promise<Team> {
  return apiPatch<Team>(appRoutes.teams.byId(id), body, token)
}

export function setTeamMembers(token: string, id: string, members: TeamMemberRef[]): Promise<Team> {
  return apiPut<Team>(appRoutes.teams.members(id), { members }, token)
}

export function deleteTeam(token: string, id: string): Promise<unknown> {
  return apiDelete(appRoutes.teams.byId(id), token)
}

export function setMyAway(token: string, away: boolean, until?: string | null): Promise<Presence> {
  return apiPut<Presence>(appRoutes.teams.myAway, { away, until: until ?? null }, token)
}

export function openTeamRoom(token: string, teamId: string): Promise<{ id: string; title: string }> {
  return apiPost(appRoutes.teams.room(teamId), {}, token)
}
