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
import type { BotOrbMotion } from './bot-orb-motion'

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
  /** Think items in list payloads: the text exists but loads on expand. */
  hasText?: boolean
  /** The call raises an approval that lands under the agent's message. */
  proposes?: boolean
}

export type ActivityGroup = {
  key: string
  kind: ActivityKind
  items: ActivityItem[]
  running: boolean
  durationMs: number
}

const KNOWLEDGE_TOOLS = new Set([
  'search_index',
  'list_docs',
  'read_doc',
  'write_doc',
  'search_product_help',
  'record_thread_read',
])
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
  if (typeof r.has_text === 'boolean') item.hasText = r.has_text
  if (r.proposes === true) item.proposes = true
  return item
}

/** A running turn already called a tool that ends in an inline approval. */
export function turnPreparesProposal(turn: LiveTurn): boolean {
  return turn.active && turn.entries.some((e) => e.type === 'activity' && e.item.proposes === true)
}

function decisionIdFromUnknown(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  for (const key of ['decision_request_id', 'decision_id', 'decisionRequestId', 'decisionId']) {
    const raw = row[key]
    if (typeof raw === 'string' && raw.trim()) return raw.trim()
  }
  return null
}

/** Decision ids raised by gated tools in this live turn. */
export function liveProposalDecisionIds(turn: LiveTurn): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const entry of turn.entries) {
    if (entry.type !== 'activity') continue
    const id = decisionIdFromUnknown(entry.item.result)
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/**
 * Formerly held decision cards until live speech finished. Server turns now
 * reveal cards only after speech is persisted, so the client no longer hides
 * them. Kept as a no-op for call-site compatibility.
 */
export function liveProposalHold(_turn: LiveTurn | null | undefined): {
  decisionIds: Set<string>
  holdNewSince: string | null
} {
  return { decisionIds: new Set(), holdNewSince: null }
}

/**
 * Idle gap while the model decides: show Thinking, but never on top of
 * "Preparing proposal…" (that flash looked like a stray brain/cloud).
 */
export function shouldShowWaitingTurn(
  turn: LiveTurn,
  opts: { lastRunning: boolean; lastIsSpeech: boolean; hasSpeech?: boolean },
): boolean {
  if (!turn.active || opts.lastRunning || opts.lastIsSpeech) return false
  if (opts.hasSpeech) return false
  if (turnPreparesProposal(turn)) return false
  // A quiet gap before the first word is not thinking. Show Working only
  // once a tool has already run and the model is still on the job.
  return turnHasWork(turn)
}

/** Face motion for the bot orb — re-exported from bot-orb-motion. */
export type { BotOrbMotion, BotOrbDrive } from './bot-orb-motion'
export {
  BOT_ORB_MS,
  decisionOrbPulse,
  errorOrbPulse,
  isBotOrbBusyLoop,
  isBotOrbOneShot,
  presenceOrbMotion,
  resolveBotOrbDrive,
  wakeOrbPulse,
} from './bot-orb-motion'

/** A tool has started, so the rest of the turn is work rather than a fresh think. */
export function turnHasWork(turn: LiveTurn | null | undefined): boolean {
  if (!turn) return false
  return turn.entries.some((entry) => entry.type === 'activity' && entry.item.kind === 'work')
}

/** Derive orb face motion from the live turn (thinking / typing / working). */
export function liveTurnOrbMotion(turn: LiveTurn | null | undefined): BotOrbMotion {
  if (!turn?.active) return 'idle'
  // Preparing-proposal uses its own meta line — keep idle there.
  if (turnPreparesProposal(turn)) return 'idle'
  const blocks = liveBlocks(turn)
  const last = blocks[blocks.length - 1]
  if (last?.type === 'speech') return 'typing'
  if (last?.type === 'activity') {
    const running = last.items.filter((item) => item.status === 'running')
    if (running.some((item) => item.label === 'typing')) return 'typing'
    if (running.some((item) => item.kind === 'work')) return 'working'
  }
  // Tools already ran: the next model call is still the job, not a new think.
  if (turnHasWork(turn)) return 'working'
  if (last?.type === 'activity' && last.items.some((item) => item.kind === 'think' && item.status === 'running')) {
    return 'thinking'
  }
  if (Object.values(turn.thinking).some((text) => text.trim().length > 0)) return 'thinking'
  return 'idle'
}

/**
 * A think item is only worth a row when there is reasoning to read (or it is
 * still streaming in). Models that think without exposing text leave none.
 */
export function isVisibleActivity(item: ActivityItem): boolean {
  // Showcase cards render under the bubble — the tool row is noise.
  if (
    item.tool === 'attach_items' ||
    item.tool === 'update_progress' ||
    item.tool === 'post_internal_note'
  ) {
    return false
  }
  if (item.kind !== 'think' || item.status === 'running') return true
  if (item.text !== undefined) return Boolean(item.text.trim())
  return item.hasText !== false
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
  inProgress?: boolean
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
    hasActivity:
    raw.has_activity === true ||
    activity.some(isVisibleActivity) ||
    activityAfter.some(isVisibleActivity),
    turnId,
    inProgress: payload.in_progress === true || raw.in_progress === true,
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

/** Query string from a web_search activity item (input or Search: label). */
export function webSearchQuery(item: ActivityItem): string {
  const input = item.input
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const q = (input as Record<string, unknown>).query
    if (typeof q === 'string' && q.trim()) return q.trim()
  }
  const label = item.label || ''
  const match = /^Search:\s*(.+)$/i.exec(label)
  return match?.[1]?.trim() || ''
}

const HOST_RE =
  /(?:^|\s)(?:site:)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/|\s|$)/i

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

/** Hostname for a web_search / fetch_url item. */
export function webSearchHost(item: ActivityItem): string {
  const result = item.result
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const rec = result as Record<string, unknown>
    if (item.tool === 'fetch_url') {
      const host = String(rec.host || '')
        .trim()
        .replace(/^www\./i, '')
      if (host) return host
      const url = String(rec.url || '').trim()
      if (url) {
        const fromUrl = hostFromUrl(url)
        if (fromUrl) return fromUrl
      }
    }
    const rows = rec.results
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue
        const host = String((row as Record<string, unknown>).host || '')
          .trim()
          .replace(/^www\./i, '')
        if (host) return host
        const url = String((row as Record<string, unknown>).url || '').trim()
        if (url) {
          const fromUrl = hostFromUrl(url)
          if (fromUrl) return fromUrl
        }
      }
    }
  }
  if (item.tool === 'fetch_url') {
    const input = item.input
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      const url = String((input as Record<string, unknown>).url || '').trim()
      if (url) return hostFromUrl(url)
    }
  }
  const query = webSearchQuery(item)
  const match = HOST_RE.exec(query)
  return match?.[1]?.toLowerCase().replace(/^www\./i, '') || ''
}

/** Favicon URL from the first hit or a Google s2 icon for the known host. */
export function webSearchFavicon(item: ActivityItem): string {
  const result = item.result
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const rows = (result as Record<string, unknown>).results
    if (Array.isArray(rows) && rows.length) {
      const first = rows[0]
      if (first && typeof first === 'object') {
        const url = (first as Record<string, unknown>).favicon_url
        if (typeof url === 'string' && url) return url
      }
    }
  }
  const host = webSearchHost(item)
  return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32` : ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** Who an invite / floor handoff is aimed at, when the payload says. */
export function inviteTarget(item: ActivityItem): { id: string; name: string; kind: string } | null {
  if (item.tool !== 'invite_to_thread' && item.tool !== 'request_participant_turn') return null
  const input = asRecord(item.input)
  const result = asRecord(item.result)
  const turn = asRecord(result?.turn)
  const id = String(
    result?.ref_id || input?.id || input?.agent_id || turn?.agent_id || '',
  ).trim()
  const name = String(result?.name || turn?.agent_name || input?.name || '').trim()
  const kind = String(result?.kind || input?.kind || (item.tool === 'request_participant_turn' ? 'agent' : '')).trim()
  if (!id && !name) return null
  return { id, name, kind }
}

/** Line for one action: its label, or a kind fallback. */
export function itemLabel(item: ActivityItem, t: TFunction): string {
  if (item.kind === 'think') return t('activity.thinking', { ns: 'communication' })
  const invited = inviteTarget(item)
  if (invited) {
    if (invited.name) {
      return t('activity.inviting', {
        ns: 'communication',
        name: invited.name,
        defaultValue: `Inviting ${invited.name} to the conversation`,
      })
    }
    return t('activity.invitingSomeone', {
      ns: 'communication',
      defaultValue: 'Inviting to the conversation',
    })
  }
  if (item.label === 'note') return item.text?.trim() || t('activity.note', { ns: 'communication' })
  if (item.tool === 'web_search') {
    const host = webSearchHost(item)
    if (host) return host
    const query = webSearchQuery(item)
    return t('activity.webSearch', {
      ns: 'communication',
      query: query || '…',
      defaultValue: query ? `Searching for ${query}` : 'Searching the web',
    })
  }
  if (item.tool === 'fetch_url') {
    const host = webSearchHost(item)
    if (host) return host
    return t('activity.fetchUrl', {
      ns: 'communication',
      defaultValue: 'Fetching page',
    })
  }
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
    // One quick tool: show what it did ("Added #noreply"), not "1 action".
    if (count === 1) return itemLabel(group.items[0], t)
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

/** True when a gateway payload is for this thread (or has no signal id yet). */
export function eventTargetsSignal(
  data: Record<string, unknown>,
  signalId: string | null,
): boolean {
  if (!signalId) return false
  const raw = data.signal_id
  if (raw == null || raw === '') return true
  return String(raw) === String(signalId)
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
      let speechAt = -1
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const row = entries[i]
        if (row.type === 'speech' && row.segmentId === segmentId) {
          speechAt = i
          break
        }
      }
      if (speechAt >= 0) {
        const last = entries[speechAt] as { type: 'speech'; segmentId: string; text: string }
        entries[speechAt] = { ...last, text: last.text + delta }
      } else {
        entries.push({ type: 'speech', segmentId, text: delta })
      }
      return { ...current, active: true, entries }
    }
    case 'thread.presence':
      return applyThreadPresence(current, data)
    default:
      return current
  }
}

function applyThreadPresence(turn: LiveTurn, data: Record<string, unknown>): LiveTurn {
  const phase = str(data.phase)
  if (phase === 'idle') return { ...turn, active: false, ended: true }
  if (phase === 'writing') {
    // Presence is the "someone is writing" lamp. Speech text arrives as
    // `message.delta` from the same publish. Re-applying the echo opened a
    // new bubble per token (presence has no segment_id, so it never merged).
    return turn.active ? turn : { ...turn, active: true }
  }
  if (phase === 'thinking' && data.delta && data.item && typeof data.item === 'object') {
    const itemId = str((data.item as { id?: unknown }).id)
    if (itemId) {
      return applyTurnEvent(turn, 'agent.thinking', { ...data, item_id: itemId, delta: data.delta })
    }
  }
  const actor =
    data.actor && typeof data.actor === 'object' ? (data.actor as Record<string, unknown>) : {}
  if (phase === 'typing') {
    const actorId = str(actor.id) || 'peer'
    const item = {
      id: `typing-${actorId}`,
      kind: 'other' as const,
      label: 'typing',
      tool: '',
      provider: '',
      startedAt: new Date().toISOString(),
      endedAt: null,
      durationMs: null,
      status: 'running' as const,
    }
    return { ...turn, active: true, entries: upsertItem(turn.entries, item) }
  }
  const item = normalizeActivityItem(data.item)
  if (!item) return { ...turn, active: true }
  return { ...turn, active: true, entries: upsertItem(turn.entries, item) }
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

/** Showcase `items` from live tool results (attach_items, list_folders, …). */
export function liveAttachResults(turn: LiveTurn): unknown[] {
  const out: unknown[] = []
  for (const entry of turn.entries) {
    if (entry.type !== 'activity') continue
    const result = entry.item.result
    if (result === undefined || result === null) continue
    // Prefer rows that already carry an items array (list_* auto-showcase).
    if (typeof result === 'object' && result !== null && Array.isArray((result as { items?: unknown }).items)) {
      out.push(result)
      continue
    }
    if (entry.item.tool === 'attach_items') out.push(result)
  }
  return out
}

/** True when a turn has anything to show. */
export function turnHasContent(turn: LiveTurn): boolean {
  return turn.active || turn.entries.length > 0
}

const CHECKPOINT_PLACEHOLDERS = new Set(['Working on this.', 'Done.'])

/** Drop a live overlay that has not moved for this long (crashed worker, reload). */
export const LIVE_TURN_STALE_MS = 120_000

/** Resume a live overlay from an in-progress thread row after a reload. */
export function liveTurnFromMessage(message: {
  turnId?: string | null
  inProgress?: boolean
  activity?: ActivityItem[]
  activityAfter?: ActivityItem[]
  bodyText?: string
  createdAt?: string | null
}): LiveTurn | null {
  if (!message.inProgress || !message.turnId) return null
  if (message.createdAt) {
    const at = Date.parse(message.createdAt)
    if (!Number.isNaN(at) && Date.now() - at > LIVE_TURN_STALE_MS) return null
  }
  const items = [...(message.activity ?? []), ...(message.activityAfter ?? [])].filter(
    isVisibleActivity,
  )
  const entries: LiveEntry[] = items.map((item) => ({ type: 'activity', item }))
  const speech = (message.bodyText || '').trim()
  if (speech && !CHECKPOINT_PLACEHOLDERS.has(speech)) {
    entries.push({ type: 'speech', segmentId: 'checkpoint', text: speech })
  }
  return {
    streamId: message.turnId,
    entries,
    active: true,
    ended: false,
    thinking: Object.fromEntries(
      items.filter((item) => item.kind === 'think' && item.text).map((item) => [item.id, item.text!]),
    ),
  }
}

export function liveTurnFromLatestInProgress(
  messages: Array<{
    turnId?: string | null
    inProgress?: boolean
    activity?: ActivityItem[]
    activityAfter?: ActivityItem[]
    bodyText?: string
    createdAt?: string | null
  }> | null | undefined,
): LiveTurn | null {
  if (!messages?.length) return null
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const turn = liveTurnFromMessage(messages[i])
    if (turn) return turn
  }
  return null
}

function speechOverlaps(a: string, b: string): boolean {
  if (!a || !b) return false
  return a === b || a.startsWith(b) || b.startsWith(a)
}

/** Keep checkpoint history when a later live event lands on the same turn. */
export function mergeTurns(base: LiveTurn, overlay: LiveTurn): LiveTurn {
  if (!overlay.streamId) return base
  if (base.streamId && overlay.streamId !== base.streamId) return overlay
  let entries = base.entries.slice()
  for (const entry of overlay.entries) {
    if (entry.type === 'activity') entries = upsertItem(entries, entry.item)
    else {
      // Drop checkpoint / stale speech that duplicates this live segment so the
      // timeline does not show a finished bubble beside the still-streaming one.
      entries = entries.filter((row) => {
        if (row.type !== 'speech') return true
        if (row.segmentId === entry.segmentId) return true
        if (row.segmentId === 'checkpoint' || entry.segmentId === 'checkpoint') {
          return !speechOverlaps(row.text, entry.text)
        }
        return true
      })
      const matchAt = entries.findIndex(
        (row) => row.type === 'speech' && row.segmentId === entry.segmentId,
      )
      if (matchAt >= 0) {
        const last = entries[matchAt] as { type: 'speech'; segmentId: string; text: string }
        entries[matchAt] = entry.text.length >= last.text.length ? entry : last
      } else {
        entries.push(entry)
      }
    }
  }
  return {
    streamId: overlay.streamId || base.streamId,
    active: overlay.active || base.active,
    ended: overlay.ended,
    thinking: { ...base.thinking, ...overlay.thinking },
    entries,
  }
}

/** Active turn from a plain text stream (SSE reply without gateway events). */
export function textOnlyTurn(text: string): LiveTurn {
  return {
    ...EMPTY_TURN,
    active: true,
    entries: text ? [{ type: 'speech', segmentId: 'speech', text }] : [],
  }
}

/** True once the finished messages of this turn are in the list. */
export function turnSaved(
  turn: LiveTurn,
  messages: Array<{ turnId?: string | null; inProgress?: boolean }>,
): boolean {
  return (
    Boolean(turn.streamId) &&
    messages.some((m) => m.turnId === turn.streamId && !m.inProgress)
  )
}
