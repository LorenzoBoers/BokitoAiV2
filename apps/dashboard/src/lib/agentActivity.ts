/**
 * Agent turn activity: what the agent did between its chat bubbles.
 *
 * Items come from two places with one shape:
 * - saved messages (`payload.activity` / `activity_after`, see
 *   `apps/api/app/services/agent/turn_persist.py`)
 * - the live gateway turn (`agent.turn`, `agent.activity`, `agent.thinking`,
 *   `message.delta`, see `apps/api/app/services/agent/turn.py`)
 *
 * Consecutive items of the same kind form one group. A running group shows
 * only its newest action; a finished group collapses to "Worked for 12s ·
 * 4 actions" / "Thought for 3s".
 */
import type { TFunction } from 'i18next'

export type ActivityKind = 'think' | 'work' | 'other'
export type ActivityStatus = 'running' | 'ok' | 'error'

export type ActivityItem = {
  id: string
  kind: ActivityKind
  label: string
  tool: string
  provider: string
  startedAt: string | null
  endedAt: string | null
  /** Saved duration for items without timestamps (older messages). */
  durationMs: number | null
  status: ActivityStatus
  input?: unknown
  result?: unknown
  text?: string
}

export type ActivityGroup = {
  key: string
  kind: ActivityKind
  items: ActivityItem[]
  running: boolean
  durationMs: number
}

const KNOWLEDGE_TOOLS = new Set(['search_index', 'list_docs', 'read_doc', 'write_doc', 'search_product_help'])
const HANDOFF_TOOLS = new Set(['handoff_to_human', 'request_callback'])

export function isKnowledgeTool(tool?: string | null): boolean {
  return Boolean(tool && KNOWLEDGE_TOOLS.has(tool))
}

export function isHandoffTool(tool?: string | null): boolean {
  return Boolean(tool && HANDOFF_TOOLS.has(tool))
}

function asKind(value: unknown): ActivityKind {
  return value === 'think' || value === 'other' ? value : 'work'
}

function asStatus(value: unknown): ActivityStatus {
  return value === 'running' || value === 'error' ? value : 'ok'
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function normalizeActivityItem(raw: unknown): ActivityItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = str(r.id)
  if (!id) return null
  const duration = r.duration_ms ?? r.durationMs
  const item: ActivityItem = {
    id,
    kind: asKind(r.kind),
    label: str(r.label),
    tool: str(r.tool),
    provider: str(r.provider),
    startedAt: str(r.started_at ?? r.startedAt) || null,
    endedAt: str(r.ended_at ?? r.endedAt) || null,
    durationMs: typeof duration === 'number' && duration > 0 ? duration : null,
    status: asStatus(r.status),
  }
  if (r.input !== undefined) item.input = r.input
  if (r.result !== undefined) item.result = r.result
  if (typeof r.text === 'string') item.text = r.text
  return item
}

export function normalizeActivity(raw: unknown): ActivityItem[] {
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeActivityItem).filter((i): i is ActivityItem => i !== null)
}

export type MessageActivity = {
  activity: ActivityItem[]
  activityAfter: ActivityItem[]
  /** False in list payloads: tool input/result and thinking text load on expand. */
  activityDetail: boolean
  hasActivity: boolean
  turnId: string | null
}

/** Activity fields of a serialized thread message (`payload.activity`, ...). */
export function normalizeMessageActivity(raw: Record<string, unknown>): MessageActivity {
  const payload =
    raw.payload && typeof raw.payload === 'object' ? (raw.payload as Record<string, unknown>) : {}
  const activity = normalizeActivity(payload.activity ?? raw.activity)
  const activityAfter = normalizeActivity(payload.activity_after ?? raw.activity_after)
  const turnId = str(payload.turn_id ?? raw.turn_id) || null
  return {
    activity,
    activityAfter,
    activityDetail: payload.activity_detail === true || raw.activity_detail === true,
    hasActivity: raw.has_activity === true || activity.length > 0 || activityAfter.length > 0,
    turnId,
  }
}

function ms(iso: string | null): number | null {
  if (!iso) return null
  const value = Date.parse(iso)
  return Number.isNaN(value) ? null : value
}

export function itemDurationMs(item: ActivityItem, nowMs = Date.now()): number {
  const start = ms(item.startedAt)
  if (start != null) {
    const end = ms(item.endedAt) ?? (item.status === 'running' ? nowMs : start)
    return Math.max(0, end - start)
  }
  return item.durationMs ?? 0
}

function groupDurationMs(items: ActivityItem[], nowMs: number): number {
  const starts = items.map((i) => ms(i.startedAt)).filter((v): v is number => v != null)
  if (starts.length === items.length && starts.length > 0) {
    const ends = items.map((i) => ms(i.endedAt) ?? (i.status === 'running' ? nowMs : ms(i.startedAt) ?? 0))
    return Math.max(0, Math.max(...ends) - Math.min(...starts))
  }
  return items.reduce((sum, i) => sum + itemDurationMs(i, nowMs), 0)
}

/** Consecutive same-kind items become one group. */
export function groupActivity(items: ActivityItem[], nowMs = Date.now()): ActivityGroup[] {
  const groups: ActivityGroup[] = []
  for (const item of items) {
    const last = groups[groups.length - 1]
    if (last && last.kind === item.kind) {
      last.items.push(item)
    } else {
      groups.push({ key: item.id, kind: item.kind, items: [item], running: false, durationMs: 0 })
    }
  }
  for (const group of groups) {
    group.running = group.items.some((i) => i.status === 'running')
    group.durationMs = groupDurationMs(group.items, nowMs)
  }
  return groups
}

/** "<1s", "3s", "12s", "1m 05s". */
export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return '<1s'
  const seconds = Math.round(durationMs / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
}

/** Line for one action: its label, or a kind fallback. */
export function itemLabel(item: ActivityItem, t: TFunction): string {
  if (item.kind === 'think') return t('activity.thinking', { ns: 'communication' })
  if (item.label === 'note') return item.text?.trim() || t('activity.note', { ns: 'communication' })
  return item.label || item.tool || t('activity.action', { ns: 'communication' })
}

/** Collapsed label of a finished group. */
export function groupSummary(group: ActivityGroup, t: TFunction): string {
  const duration = formatDuration(group.durationMs)
  const brief = group.durationMs < 1000
  if (group.kind === 'think') {
    if (brief) return t('activity.thoughtBriefly', { ns: 'communication' })
    return t('activity.thoughtFor', { ns: 'communication', duration })
  }
  if (group.kind === 'work') {
    const count = group.items.length
    if (brief) return t('activity.actionCount', { ns: 'communication', count })
    return t('activity.workedFor', { ns: 'communication', duration, count })
  }
  if (group.items.length === 1) return itemLabel(group.items[0], t)
  return t('activity.otherCount', { ns: 'communication', count: group.items.length })
}

/** Live line of a running group: the newest action replaces the previous one. */
export function groupLiveLabel(group: ActivityGroup, t: TFunction): string {
  const current = group.items[group.items.length - 1]
  if (group.kind === 'think') return t('activity.thinking', { ns: 'communication' })
  return current ? itemLabel(current, t) : t('activity.working', { ns: 'communication' })
}

/** One provider for the whole group when every action used the same one. */
export function groupProvider(group: ActivityGroup): string {
  const providers = new Set(group.items.map((i) => i.provider).filter(Boolean))
  return providers.size === 1 ? [...providers][0] : ''
}

// ── live turn ────────────────────────────────────────────────────────────

export type LiveEntry =
  | { type: 'activity'; item: ActivityItem }
  | { type: 'speech'; segmentId: string; text: string }

export type LiveTurn = {
  streamId: string | null
  entries: LiveEntry[]
  /** Between `agent.turn start` and `end`. */
  active: boolean
  /** `agent.turn end` arrived; the view waits for the saved messages. */
  ended: boolean
  /** Thinking text per think item id. */
  thinking: Record<string, string>
}

export const EMPTY_TURN: LiveTurn = {
  streamId: null,
  entries: [],
  active: false,
  ended: false,
  thinking: {},
}

function startTurn(streamId: string | null): LiveTurn {
  return { ...EMPTY_TURN, streamId, active: true, thinking: {} }
}

function upsertItem(entries: LiveEntry[], item: ActivityItem): LiveEntry[] {
  const index = entries.findIndex((e) => e.type === 'activity' && e.item.id === item.id)
  if (index < 0) return [...entries, { type: 'activity', item }]
  const next = entries.slice()
  const prev = next[index] as { type: 'activity'; item: ActivityItem }
  // An update may carry only what changed (status, ended_at, result).
  const merged: ActivityItem = { ...prev.item }
  for (const [key, value] of Object.entries(item) as [keyof ActivityItem, unknown][]) {
    if (value !== '' && value !== null && value !== undefined) {
      ;(merged as Record<string, unknown>)[key] = value
    }
  }
  next[index] = { type: 'activity', item: merged }
  return next
}

/** Pure reducer for gateway turn events on one thread. */
export function applyTurnEvent(
  turn: LiveTurn,
  event: string,
  data: Record<string, unknown>,
): LiveTurn {
  const streamId = data.stream_id != null && String(data.stream_id) ? String(data.stream_id) : null
  let current = turn
  if (streamId && streamId !== turn.streamId) {
    // A late event from a finished turn must not reopen it.
    if (event === 'agent.turn' && data.phase === 'end') return turn
    current = startTurn(streamId)
  }
  switch (event) {
    case 'agent.turn':
      if (data.phase === 'end') return { ...current, active: false, ended: true }
      return current.active ? current : { ...current, active: true, ended: false }
    case 'agent.activity': {
      const item = normalizeActivityItem(data.item)
      if (!item) return current
      return { ...current, active: true, entries: upsertItem(current.entries, item) }
    }
    case 'agent.thinking': {
      const itemId = str(data.item_id)
      const delta = str(data.delta)
      if (!itemId || !delta) return current
      return {
        ...current,
        active: true,
        thinking: { ...current.thinking, [itemId]: (current.thinking[itemId] ?? '') + delta },
      }
    }
    case 'message.delta': {
      const delta = str(data.delta)
      if (!delta) return current
      const segmentId = str(data.segment_id) || 'speech'
      const entries = current.entries.slice()
      const last = entries[entries.length - 1]
      if (last && last.type === 'speech' && last.segmentId === segmentId) {
        entries[entries.length - 1] = { ...last, text: last.text + delta }
      } else {
        entries.push({ type: 'speech', segmentId, text: delta })
      }
      return { ...current, active: true, entries }
    }
    default:
      return current
  }
}

export type LiveBlock =
  | { type: 'activity'; key: string; items: ActivityItem[] }
  | { type: 'speech'; key: string; text: string }

/** Live entries as render blocks: activity runs between speech segments. */
export function liveBlocks(turn: LiveTurn): LiveBlock[] {
  const blocks: LiveBlock[] = []
  for (const entry of turn.entries) {
    const last = blocks[blocks.length - 1]
    if (entry.type === 'activity') {
      const item = turn.thinking[entry.item.id]
        ? { ...entry.item, text: turn.thinking[entry.item.id] }
        : entry.item
      if (last && last.type === 'activity') last.items.push(item)
      else blocks.push({ type: 'activity', key: entry.item.id, items: [item] })
    } else {
      blocks.push({ type: 'speech', key: entry.segmentId, text: entry.text })
    }
  }
  return blocks
}

/** True when a turn has anything to show. */
export function turnHasContent(turn: LiveTurn): boolean {
  return turn.active || turn.entries.length > 0
}

/** Active turn from a plain text stream (SSE reply without gateway events). */
export function textOnlyTurn(text: string): LiveTurn {
  return {
    ...EMPTY_TURN,
    active: true,
    entries: text ? [{ type: 'speech', segmentId: 'speech', text }] : [],
  }
}

/** True once the saved messages of this turn are in the list. */
export function turnSaved(turn: LiveTurn, messages: Array<{ turnId?: string | null }>): boolean {
  return Boolean(turn.streamId) && messages.some((m) => m.turnId === turn.streamId)
}
