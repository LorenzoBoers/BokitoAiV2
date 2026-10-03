/** Teams, the company team overview and availability. */

import { appRoutes } from '../api/routes/app.routes'
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from './api'

export type TeamKind = 'people' | 'agents' | 'custom'
export type TeamPickup = 'people' | 'agent_first' | 'round_robin' | 'least_open'
export type PresenceStatus = 'available' | 'away' | 'offline'

export type TeamMemberRef = { kind: 'user' | 'agent'; id: string }

export type Team = {
  id: string
  name: string
  description: string
  kind: TeamKind
  system: boolean
  pickup: TeamPickup
  /** Shown as a folder in the Communication sidebar. */
  pinned: boolean
  members: TeamMemberRef[]
  member_count: number
}

export type Presence = {
  status: PresenceStatus
  last_seen_at: string | null
  away_until: string | null
}

export type OverviewPerson = {
  uuid: string
  name: string
  email: string
  avatar_url: string | null
  role: string
  presence: Presence
  team_ids: string[]
  open_owned: number
  open_turn: number
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

export type OverviewAgent = {
  id: string
  name: string
  role: string
  autonomy_level: string
  team_ids: string[]
  open_owned: number
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

/** Window event fired after a team is created, changed or removed (sidebar refetches). */
export const TEAMS_CHANGED_EVENT = 'bokito:teams-changed'

function announce<T>(result: Promise<T>): Promise<T> {
  return result.then((value) => {
    window.dispatchEvent(new Event(TEAMS_CHANGED_EVENT))
    return value
  })
}

export function listTeams(token: string): Promise<Team[]> {
  return apiGet<Team[]>(appRoutes.teams.list, token)
}

export function getTeamOverview(token: string): Promise<TeamOverview> {
  return apiGet<TeamOverview>(appRoutes.teams.overview, token)
}

export function createTeam(
  token: string,
  body: { name: string; description?: string; pickup?: TeamPickup; pinned?: boolean; members?: TeamMemberRef[] },
): Promise<Team> {
  return announce(apiPost<Team>(appRoutes.teams.list, body, token))
}

export function patchTeam(
  token: string,
  id: string,
  body: { name?: string; description?: string; pickup?: TeamPickup; pinned?: boolean },
): Promise<Team> {
  return announce(apiPatch<Team>(appRoutes.teams.byId(id), body, token))
}

export function setTeamMembers(token: string, id: string, members: TeamMemberRef[]): Promise<Team> {
  return apiPut<Team>(appRoutes.teams.members(id), { members }, token)
}

export function deleteTeam(token: string, id: string): Promise<unknown> {
  return announce(apiDelete(appRoutes.teams.byId(id), token))
}

export function setMyAway(token: string, away: boolean, until?: string | null): Promise<Presence> {
  return apiPut<Presence>(appRoutes.teams.myAway, { away, until: until ?? null }, token)
}
