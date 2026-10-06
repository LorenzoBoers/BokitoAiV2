import { isAgentAutomation, parseTimelineMs, type TimeItem } from './time-items'

/** What the Agenda can show; each layer has its own colour and switch. */
export type AgendaLayer = 'calendar' | 'reminders' | 'checkups' | 'agents' | 'routines' | 'activity'

export const AGENDA_LAYERS: AgendaLayer[] = ['calendar', 'reminders', 'checkups', 'agents', 'routines', 'activity']

export type AgendaView = 'day' | 'week' | 'month' | 'list'

export const AGENDA_VIEWS: AgendaView[] = ['day', 'week', 'month', 'list']

/** Who to show: everyone, the signed-in person, or one person or agent. */
export type AgendaWho = 'all' | 'me' | `user:${string}` | `agent:${string}`

const CONVERSATION_RUNS = new Set(['chat', 'email', 'widget', 'inbound', 'webchat', 'whatsapp', 'customer_widget'])

/** Person, team or agent responsible for (or running) an item. Calendar blocks have none. */
export type AgendaOwnerKind = 'user' | 'agent' | 'team'

export type AgendaOwner = { kind: AgendaOwnerKind; id: string | null; name: string }

/** Leftover Trigger.agent_role values — not people, so never show as Wie. */
const ROLE_SLUGS = new Set([
  'orchestrator',
  'orchestra',
  'po',
  'manager',
  'assistant',
  'worker',
  'lead',
  'agent',
  'coding',
])

function displayName(raw: string | null | undefined): string {
  const name = (raw || '').trim()
  if (!name || ROLE_SLUGS.has(name.toLowerCase())) return ''
  return name
}

export function itemOwner(item: TimeItem): AgendaOwner | null {
  if (item.kind === 'calendar') return null
  const ownerKind = item.owner_kind
  const ownerName = displayName(item.owner_name)
  if ((ownerKind === 'user' || ownerKind === 'agent' || ownerKind === 'team') && (ownerName || item.owner_id)) {
    return { kind: ownerKind, id: item.owner_id ?? null, name: ownerName }
  }
  const agentName = displayName(item.agent_name)
  if (item.agent_id || agentName) {
    return { kind: 'agent', id: item.agent_id, name: agentName }
  }
  if (item.actor_kind === 'person' && (displayName(item.actor_name) || item.actor_id)) {
    return { kind: 'user', id: item.actor_id ?? null, name: displayName(item.actor_name) }
  }
  if (item.actor_kind === 'agent' && (displayName(item.actor_name) || item.actor_id)) {
    return { kind: 'agent', id: item.actor_id ?? null, name: displayName(item.actor_name) }
  }
  return null
}

export function layerOf(item: TimeItem): AgendaLayer {
  if (item.kind === 'calendar') return 'calendar'
  if (item.kind === 'follow_up') return 'reminders'
  if (item.kind === 'checkup') return 'checkups'
  if (item.kind === 'activity') return 'activity'
  if (item.kind === 'wake' && item.trigger_kind === 'event') return 'reminders'
  if (item.kind === 'session' && !item.trigger_id && CONVERSATION_RUNS.has((item.run_type ?? '').toLowerCase())) {
    // An agent answering a conversation is something that happened, not a plan.
    return 'activity'
  }
  if (isAgentAutomation(item)) return 'routines'
  return 'agents'
}

export function parseView(raw: string | null): AgendaView {
  return AGENDA_VIEWS.includes(raw as AgendaView) ? (raw as AgendaView) : 'week'
}

export function parseLayers(raw: string | null): Set<AgendaLayer> {
  if (!raw) return new Set(AGENDA_LAYERS)
  const out = new Set<AgendaLayer>()
  for (const part of raw.split(',')) {
    if (AGENDA_LAYERS.includes(part as AgendaLayer)) out.add(part as AgendaLayer)
  }
  return out
}

export function layersParam(layers: Set<AgendaLayer>): string | null {
  if (AGENDA_LAYERS.every((layer) => layers.has(layer))) return null
  return AGENDA_LAYERS.filter((layer) => layers.has(layer)).join(',')
}

export function parseWho(raw: string | null): AgendaWho {
  if (raw === 'me') return 'me'
  if (raw && /^(user|agent):[\w-]+$/.test(raw)) return raw as AgendaWho
  return 'all'
}

/** Responsible for it, or did it. Connected calendars belong to everyone who sees them. */
export function matchesWho(item: TimeItem, who: AgendaWho, meId: string | null): boolean {
  if (who === 'all') return true
  if (item.kind === 'calendar') return who === 'me'
  const [kind, id] = who === 'me' ? ['user', meId] : who.split(':')
  if (!id) return false
  if (kind === 'agent') {
    return item.owner_id === id || item.agent_id === id || (item.actor_kind === 'agent' && item.actor_id === id)
  }
  if (item.owner_kind === 'user' && item.owner_id === id) return true
  return item.actor_kind === 'person' && item.actor_id === id
}

export function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

/** Monday-based start of week. */
export function startOfWeek(d: Date): Date {
  const out = startOfDay(d)
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7))
  return out
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + days)
  return out
}

export function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseDayKey(raw: string | null): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const [y, m, d] = raw.split('-').map(Number)
  const out = new Date(y, m - 1, d)
  return Number.isNaN(out.getTime()) ? null : out
}

/** The days a view shows around ``anchor``. List keeps three weeks of past above the land day. */
export function viewRange(view: AgendaView, anchor: Date): { from: Date; to: Date; days: Date[] } {
  let from: Date
  let count: number
  if (view === 'day') {
    from = startOfDay(anchor)
    count = 1
  } else if (view === 'week') {
    from = startOfWeek(anchor)
    count = 7
  } else if (view === 'month') {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    from = startOfWeek(first)
    count = 42
  } else {
    from = addDays(startOfDay(anchor), -21)
    count = 70
  }
  const days = Array.from({ length: count }, (_, i) => addDays(from, i))
  return { from, to: addDays(from, count), days }
}

export function shiftAnchor(view: AgendaView, anchor: Date, step: number): Date {
  if (view === 'day') return addDays(anchor, step)
  if (view === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + step, 1)
  return addDays(anchor, step * 7)
}

function calendarDateFromIso(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

export function itemStart(item: TimeItem): Date {
  if (item.all_day) {
    const date = calendarDateFromIso(item.start)
    if (date) return date
  }
  return new Date(parseTimelineMs(item.start))
}

/** Point moments (wakes, look-ats, check-ups, activity) get a short visual block. */
export const POINT_MINUTES = 30

export function itemEnd(item: TimeItem): Date {
  const start = itemStart(item)
  if (item.all_day) {
    if (item.end) {
      const date = calendarDateFromIso(item.end)
      if (date && date.getTime() > start.getTime()) return date
    }
    return new Date(start.getTime() + 24 * 3_600_000)
  }
  const end = parseTimelineMs(item.end ?? null)
  if (Number.isFinite(end) && end > start.getTime()) return new Date(end)
  return new Date(start.getTime() + POINT_MINUTES * 60_000)
}

export function isAllDay(item: TimeItem): boolean {
  if (item.all_day) return true
  if (item.kind !== 'calendar') return false
  return itemEnd(item).getTime() - itemStart(item).getTime() >= 24 * 3_600_000
}

/** Sessions that ran on a schedule collapse into their routine lane. */
export function isRoutine(item: TimeItem): boolean {
  return layerOf(item) === 'routines'
}

export type PlacedItem = {
  item: TimeItem
  /** Minutes from the start of the day. */
  top: number
  /** Minutes of height (at least ``minMinutes``). */
  height: number
  col: number
  cols: number
}

/**
 * Timed items of one day laid out side by side where they overlap.
 * Items that touch the day partially are clipped to it.
 */
export function layoutDay(items: TimeItem[], day: Date, minMinutes = 22): PlacedItem[] {
  const dayStart = startOfDay(day).getTime()
  const dayEnd = dayStart + 24 * 3_600_000
  const rows = items
    .map((item) => {
      const start = Math.max(itemStart(item).getTime(), dayStart)
      const end = Math.min(Math.max(itemEnd(item).getTime(), start + minMinutes * 60_000), dayEnd)
      return { item, start, end }
    })
    .filter((row) => row.start < dayEnd && row.end > dayStart)
    .sort((a, b) => a.start - b.start || b.end - a.end)

  const placed: PlacedItem[] = []
  let cluster: { row: (typeof rows)[number]; col: number }[] = []
  let clusterEnd = -Infinity
  const flush = () => {
    const cols = cluster.reduce((max, entry) => Math.max(max, entry.col + 1), 1)
    for (const entry of cluster) {
      placed.push({
        item: entry.row.item,
        top: (entry.row.start - dayStart) / 60_000,
        height: Math.max(minMinutes, (entry.row.end - entry.row.start) / 60_000),
        col: entry.col,
        cols,
      })
    }
    cluster = []
    clusterEnd = -Infinity
  }
  for (const row of rows) {
    if (row.start >= clusterEnd) flush()
    const taken = new Set(cluster.filter((entry) => entry.row.end > row.start).map((entry) => entry.col))
    let col = 0
    while (taken.has(col)) col += 1
    cluster.push({ row, col })
    clusterEnd = Math.max(clusterEnd, row.end)
  }
  flush()
  return placed
}

export function groupByDay(items: TimeItem[]): Map<string, TimeItem[]> {
  const map = new Map<string, TimeItem[]>()
  for (const item of items) {
    const key = dayKey(itemStart(item))
    const list = map.get(key)
    if (list) list.push(item)
    else map.set(key, [item])
  }
  return map
}

export type Attention = {
  checkups: TimeItem[]
  lookats: TimeItem[]
  failed: TimeItem[]
}

/** What needs someone now: overdue check-ups and look-ats, and failed runs of today. */
export function attentionOf(items: TimeItem[], nowMs: number): Attention {
  const today = startOfDay(new Date(nowMs)).getTime()
  const due = (item: TimeItem) => item.status === 'due' || parseTimelineMs(item.start) <= nowMs
  const seen = new Set<string>()
  const checkups = items.filter((item) => {
    if (item.kind !== 'checkup' || item.status !== 'due') return false
    const key = item.series_id ?? item.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return {
    checkups,
    lookats: items.filter((item) => item.kind === 'follow_up' && due(item)),
    failed: items.filter(
      (item) =>
        item.kind === 'session' &&
        (item.status === 'failed' || item.status === 'error') &&
        parseTimelineMs(item.start) >= today,
    ),
  }
}
