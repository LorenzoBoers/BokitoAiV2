import { appRoutes } from '../api/routes'
import { apiGet } from './api'
import { formatAppTime, formatAppWeekdayDayMonth } from './app-locale'
import { agentChatPath, inboxPath } from './messages-paths'
import { openEntityPath, pickClosestThreadBySubject } from './open-entity'

/** One shape for everything over time: Agenda, the agent timeline and agent detail. */
export type TimeItemKind = 'session' | 'wake' | 'checkup' | 'calendar' | 'follow_up' | 'activity'

export type OwnerKind = 'user' | 'agent' | 'team'

export type TimeItem = {
  id: string
  kind: TimeItemKind
  /** Trigger kind (cron, interval, heartbeat, once, event, webhook) when a trigger is involved. */
  trigger_kind?: string | null
  /** For sessions: what started the run (chat, email, trigger_cron, workstream, ...). */
  run_type?: string | null
  start: string
  end?: string | null
  title: string
  status: string
  agent_id: string | null
  agent_name: string | null
  agent_role?: string
  actor_kind?: 'agent' | 'person' | 'system'
  actor_id?: string | null
  actor_name?: string | null
  /** Who is responsible: the conversation owner for look-ats, check-ups and activity. */
  owner_kind?: OwnerKind | null
  owner_id?: string | null
  owner_name?: string | null
  project_id?: string | null
  /** The trigger behind a recurring item; equal for every moment of one routine. */
  series_id?: string | null
  /** Activity: the stage, action tag or new owner involved. */
  detail?: string | null
  instructions?: string
  enabled?: boolean
  trigger_id?: string | null
  run_id?: string | null
  signal_id?: string | null
  source?: string | null
  provider?: string | null
  provider_label?: string | null
  calendar_id?: string | null
  calendar_name?: string | null
  /** Every calendar that lists this meeting (merged across connections). */
  calendars?: string[] | null
  location?: string | null
  html_link?: string | null
  all_day?: boolean
  connection_id?: string | null
  external_id?: string | null
}

export type TimeWindow = {
  now: string
  from: string
  to: string
  items: TimeItem[]
}

export async function listTimeItems(params: {
  from?: string
  to?: string
  agentId?: string
  sources?: TimeItemKind[]
  scheduledOnly?: boolean
  projectId?: string
}): Promise<TimeWindow> {
  const query = new URLSearchParams()
  if (params.from) query.set('from', params.from)
  if (params.to) query.set('to', params.to)
  if (params.agentId) query.set('agent_id', params.agentId)
  if (params.projectId) query.set('project_id', params.projectId)
  if (params.sources?.length) query.set('sources', params.sources.join(','))
  if (params.scheduledOnly) query.set('scheduled_only', 'true')
  const res = await apiGet<Partial<TimeWindow>>(appRoutes.agenda.occurrencesQuery(query))
  return {
    now: res.now ?? new Date().toISOString(),
    from: res.from ?? params.from ?? '',
    to: res.to ?? params.to ?? '',
    items: res.items ?? [],
  }
}

export const ACTIVITY_TIMELINE_HOURS = 168
/** Sessions shorter than this show a single clock time, not a from–to range. */
export const ACTIVITY_SHORT_MS = 2 * 60 * 1000
/** Markers within this share of the timeline width share one cluster point. */
export const ACTIVITY_CLUSTER_PCT = 1.8

/** Now-centered window for the agent activity timeline. */
export function activityWindow(nowMs: number = Date.now(), hours: number = ACTIVITY_TIMELINE_HOURS) {
  const span = hours * 3_600_000
  return {
    from: new Date(nowMs - span).toISOString(),
    to: new Date(nowMs + span).toISOString(),
  }
}

/** Visual icon family for a timeline mark (mapped to Lucide in the UI). */
export type ActivityIconKind =
  | 'chat'
  | 'wake'
  | 'schedule'
  | 'heartbeat'
  | 'webhook'
  | 'workstream'
  | 'queue'
  | 'coding'
  | 'session'

export type ActivityCluster = {
  id: string
  pct: number
  items: TimeItem[]
}

export function parseTimelineMs(value: string | null | undefined): number {
  if (typeof value !== 'string' || !value) return NaN
  const raw = value.endsWith('Z') || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`
  return new Date(raw).getTime()
}

export function timelinePct(atMs: number, fromMs: number, toMs: number): number {
  if (!Number.isFinite(atMs) || toMs <= fromMs) return 50
  return Math.min(100, Math.max(0, ((atMs - fromMs) / (toMs - fromMs)) * 100))
}

/** One calendar day, then clock time(s). Ranges under 2 minutes collapse to one stamp. */
export function formatActivityMoment(
  startIso: string,
  endIso: string | null | undefined,
  language: string,
): { day: string; time: string } {
  const start = parseTimelineMs(startIso)
  if (!Number.isFinite(start)) return { day: '', time: startIso }
  const startDate = new Date(start)
  const day = formatAppWeekdayDayMonth(startDate, language)
  const from = formatAppTime(startDate, language)
  const end = parseTimelineMs(endIso ?? null)
  if (!Number.isFinite(end) || Math.abs(end - start) <= ACTIVITY_SHORT_MS) {
    return { day, time: from }
  }
  const to = formatAppTime(new Date(end), language)
  return { day, time: `${from} – ${to}` }
}

export function activityIconKind(item: TimeItem): ActivityIconKind {
  if (item.kind === 'wake') return 'wake'
  const raw = (item.run_type ?? item.trigger_kind ?? '').trim().toLowerCase()
  const type = raw.startsWith('trigger_') ? raw.slice('trigger_'.length) : raw
  if (
    type === 'chat' ||
    type === 'email' ||
    type === 'widget' ||
    type === 'inbound' ||
    type === 'webchat' ||
    type === 'whatsapp' ||
    type === 'customer_widget'
  ) {
    return 'chat'
  }
  if (type === 'heartbeat' || type === 'interval') return 'heartbeat'
  if (type === 'webhook') return 'webhook'
  if (type === 'cron' || type === 'once' || type === 'event') return 'schedule'
  if (type === 'workstream') return 'workstream'
  if (type === 'queue_item') return 'queue'
  if (type === 'coding') return 'coding'
  return 'session'
}

/** Group nearby items so overlapping marks become one numbered point. */
export function clusterTimelineItems(
  items: TimeItem[],
  fromMs: number,
  toMs: number,
  thresholdPct: number = ACTIVITY_CLUSTER_PCT,
): ActivityCluster[] {
  const placed = items
    .map((item) => {
      const start = parseTimelineMs(item.start)
      return {
        item,
        pct: Number.isFinite(start) ? timelinePct(start, fromMs, toMs) : 50,
      }
    })
    .sort((a, b) => a.pct - b.pct || a.item.start.localeCompare(b.item.start))

  const clusters: ActivityCluster[] = []
  for (const row of placed) {
    const last = clusters[clusters.length - 1]
    if (last && Math.abs(row.pct - last.pct) <= thresholdPct) {
      last.items.push(row.item)
      last.pct =
        last.items.reduce((sum, member) => {
          const ms = parseTimelineMs(member.start)
          return sum + (Number.isFinite(ms) ? timelinePct(ms, fromMs, toMs) : last.pct)
        }, 0) / last.items.length
      continue
    }
    clusters.push({
      id: row.item.id,
      pct: row.pct,
      items: [row.item],
    })
  }
  return clusters
}

/** The kind label Agenda shows: the trigger kind when there is one, else the time kind. */
export function agendaKindOf(item: TimeItem): string {
  return item.trigger_kind || item.kind
}

/** Scheduled agent automations (recurring wakes and their sessions). */
export function isAgentAutomation(item: TimeItem): boolean {
  const kind = item.trigger_kind ?? ''
  return kind === 'cron' || kind === 'interval' || kind === 'heartbeat'
}

/**
 * The thread a trigger posts into, straight from `signal_id` instead of a
 * subject guess. Check-ins land in the agent's own channel; other triggers
 * keep their internal run thread.
 */
export function triggerThreadPath(item: {
  trigger_kind?: string | null
  signal_id?: string | null
  agent_id?: string | null
}): string | null {
  if (!item.signal_id) return null
  if (item.trigger_kind === 'heartbeat' && item.agent_id) {
    return agentChatPath(item.agent_id, item.signal_id)
  }
  return inboxPath('all', item.signal_id)
}

type ThreadLike = { id: string | number; emailSubject?: string | null; lastMessageAt?: string | null }

/**
 * Where a time item opens. Sessions and past wakes open their thread (or the
 * run page); future wakes stay on Agenda; follow-ups open the conversation.
 */
export function timeItemHref(
  item: TimeItem,
  threads: ThreadLike[] = [],
  nowMs: number = Date.now(),
): string {
  if ((item.kind === 'follow_up' || item.kind === 'checkup' || item.kind === 'activity') && item.signal_id) {
    return inboxPath('all', item.signal_id)
  }
  if (item.kind === 'calendar') return '/agenda'
  const atMs = parseTimelineMs(item.start)
  const isFuture = item.kind === 'wake' && Number.isFinite(atMs) && atMs > nowMs
  if (!isFuture) {
    const direct = triggerThreadPath(item)
    if (direct) return direct
    const match = pickClosestThreadBySubject(threads, item.title, item.start)
    if (match) return inboxPath('all', String(match.id))
    if (item.run_id && item.agent_id) return openEntityPath({ type: 'run', id: item.run_id, agentId: item.agent_id })
  }
  return openEntityPath({ type: 'trigger', id: item.trigger_id, agentId: item.agent_id })
}
