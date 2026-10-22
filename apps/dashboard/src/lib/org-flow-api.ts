import { appRoutes } from '../api/routes/app.routes'
import { apiGet, apiPost } from './api'
import type { OrgGraphMark } from './teams-api'

/** Grid data from `GET /api/org/flow`; every count, mode and color is decided by the server. */
export type OrgFlowLayer = 'input' | 'executor' | 'work' | 'result'

export type OrgFlowMode = 'autonomous' | 'assisted' | 'manual' | 'human' | 'none'

export type OrgFlowNodeKind =
  | 'channel'
  | 'agent'
  | 'user'
  | 'unassigned'
  | 'flow'
  | 'reply'
  | 'folder'
  | 'knowledge'
  | 'connection'
  | 'sink_open'
  | 'sink_closed_without_result'

export type OrgFlowIssue = 'overloaded' | 'no_department' | 'offline' | 'unassigned'

export type OrgFlowWorksIn = {
  key: string
  kind: string
  origin: 'bokito' | 'connection'
  label: string
  href: string | null
}

export type OrgFlowNode = {
  id: string
  kind: OrgFlowNodeKind
  layer: OrgFlowLayer
  label: string
  href: string | null
  count: number
  open: number
  open_by_label: Record<string, number>
  issues: OrgFlowIssue[]
  channel?: string
  zones?: string[]
  waiting_on_you?: number
  autonomy?: OrgFlowMode | null
  /** Why the agent may act as it does: the layer that set the mode and the cap that clamped it. */
  autonomy_why?: { mode: OrgFlowMode; source: string; clamped_by: string | null } | null
  threads_href?: string | null
  module?: { slug: string; name: string } | null
  /** Avatar of an agent or person, same fields as the Org chart. */
  mark?: OrgGraphMark | null
  /** Agent/person function title (job title). */
  job_title?: string | null
  /** Agent role description. */
  description?: string | null
  /** Flow nodes: the flow label's color and Lucide icon id. */
  color?: string
  icon?: string
  done?: number
  /** Flow nodes: autonomous share from the flow label's latest scorecard. */
  autonomous_pct?: number | null
  channels?: string[]
  works_in?: OrgFlowWorksIn[]
  children?: number
  subtitle?: string
}

export type OrgFlowZone = { id: string; label: string; href: string | null; hint: '' | 'agent_first' | 'people' }

export type OrgFlowPath = {
  source: string
  target: string
  count: number
  mode: OrgFlowMode
  by_label: Record<string, number>
}

export type OrgFlowLabel = { id: string | null; name: string; color: string; icon?: string | null; flow_id: string | null }

export type OrgFlowWorkspaceIssue = {
  severity: 'warning' | 'info'
  node_id: string | null
  message_key: string
  params: Record<string, string | number>
  href?: string
  /** The department the bottleneck belongs to; unassigned work is All's. */
  department_id?: string
  department?: string
  /** Lead agent of that department, who is expected to act on it. */
  lead?: string | null
}

export type OrgFlow = {
  days: number
  since: string
  layers: OrgFlowLayer[]
  zones: OrgFlowZone[]
  nodes: OrgFlowNode[]
  paths: OrgFlowPath[]
  labels: OrgFlowLabel[]
  estimated: boolean
  issues: OrgFlowWorkspaceIssue[]
}

/** Label key on `by_label` / `open_by_label` for work without a label. */
export const NO_LABEL_KEY = 'none'

export function getOrgFlow(token: string, days = 7): Promise<OrgFlow> {
  return apiGet<OrgFlow>(appRoutes.teams.flow(days), token)
}

export type SuggestLabelsResult = { id: string; agent_id: string; title: string; has_opener: boolean }

/** Opens an agent chat that proposes labels for a node's unlabeled work; the server writes the opener. */
export function suggestOrgFlowLabels(
  token: string,
  body: { node_id: string; days: number; lang: 'en' | 'nl' },
): Promise<SuggestLabelsResult> {
  return apiPost<SuggestLabelsResult>(appRoutes.teams.flowSuggestLabels, body, token)
}
