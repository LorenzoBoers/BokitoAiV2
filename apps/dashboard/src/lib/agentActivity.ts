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
import { isBotOrbMotion, type BotOrbMotion } from './bot-orb-motion'

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
  /** File URLs kept on the slim stream for generate_image. */
  imageUrls?: string[]
  /** i18n key chosen by the API (`activity.generatingImage`). */
  labelKey?: string
  /** Values for that key (`name`, `query`). */
  labelParams?: Record<string, string>
  /** Host the API already resolved for a web search or fetch. */
  host?: string
  faviconUrl?: string
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
  const urls = r.image_urls ?? r.imageUrls
  if (Array.isArray(urls)) {
    const clean = urls.filter((row): row is string => typeof row === 'string' && row.trim().length > 0)
    if (clean.length) item.imageUrls = clean
  }
  const labelKey = str(r.label_key ?? r.labelKey)
  if (labelKey) item.labelKey = labelKey
  const params = r.label_params ?? r.labelParams
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    const clean: Record<string, string> = {}
    for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
      if (typeof value === 'string' && value) clean[key] = value
    }
    if (Object.keys(clean).length) item.labelParams = clean
  }
  const host = str(r.host)
  if (host) item.host = host
  const favicon = str(r.favicon_url ?? r.faviconUrl)
  if (favicon) item.faviconUrl = favicon
  return item
}

export type ImageFrameState = {
  id: string
  status: 'running' | 'ready' | 'error'
  src: string | null
  alt: string
}

function urlsFromResult(result: unknown): string[] {
  if (!result || typeof result !== 'object') return []
  const row = result as { images?: unknown; items?: unknown }
  if (Array.isArray(row.images)) {
    const found = row.images.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    if (found.length) return found
  }
  if (!Array.isArray(row.items)) return []
  const fromItems: string[] = []
  for (const entry of row.items) {
    if (!entry || typeof entry !== 'object') continue
    const rec = entry as { image_url?: unknown; url?: unknown }
    const url = typeof rec.image_url === 'string' ? rec.image_url : rec.url
    if (typeof url === 'string' && url.trim()) fromItems.push(url)
  }
  return fromItems
}

/** Drop a picture the model pasted again after generate_image already showed it.
 * The API removes the same markdown from the saved body. This covers a live
 * delta that still contains an image while the frame is already on screen.
 */
export function stripEchoedImages(text: string, srcs: string[]): string {
  if (!text || srcs.length === 0) return text
  let out = text
  for (const src of srcs) {
    const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`!\\[[^\\]]*\\]\\(${escaped}\\)`, 'g'), '')
    out = out.replace(new RegExp(`\\[[^\\]]*\\]\\(${escaped}\\)`, 'g'), '')
    out = out.replaceAll(src, '')
  }
  out = out.replace(/!\[[^\]]*\]\([^)]+\)/g, '')
  out = out.replace(/!\[[^\]]*$/g, '')
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** One frame per generate_image call. A running call has no src yet. */
export function imageGenerationFrames(items: ActivityItem[]): ImageFrameState[] {
  const frames: ImageFrameState[] = []
  for (const item of items) {
    if (item.tool !== 'generate_image') continue
    const urls = item.imageUrls?.length ? item.imageUrls : urlsFromResult(item.result)
    const alt =
      item.input && typeof item.input === 'object' && typeof (item.input as { prompt?: unknown }).prompt === 'string'
        ? (item.input as { prompt: string }).prompt
        : item.label
    if (urls.length) {
      urls.forEach((src, index) => {
        frames.push({ id: `${item.id}:${index}`, status: 'ready', src, alt })
      })
      continue
    }
    frames.push({
      id: item.id,
      status: item.status === 'error' ? 'error' : 'running',
      src: null,
      alt,
    })
  }
  return frames
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

const SURFACE_MOTIONS = new Set<BotOrbMotion>([
  'idle',
  'thinking',
  'working',
  'searching',
  'writing',
  'sending',
])

/** Orb face. The socket names it; otherwise a local guess for older events. */
export function liveTurnOrbMotion(turn: LiveTurn | null | undefined): BotOrbMotion {
  if (!turn?.active) return 'idle'
  if (turn.motion && SURFACE_MOTIONS.has(turn.motion)) return turn.motion
  if (turnPreparesProposal(turn)) return 'writing'
  const blocks = liveBlocks(turn)
  const last = blocks[blocks.length - 1]
  if (last?.type === 'speech') return 'writing'
  if (last?.type === 'activity') {
    const running = last.items.filter((item) => item.status === 'running')
    if (running.some((item) => item.label === 'typing')) return 'writing'
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

export type HistoryRow = {
  kind: ActivityKind
  count: number
  durationMs: number
  labelKey: string
  label: string
  labelParams?: Record<string, string>
  /** Tool names behind this row, in order, for the icon stack. */
  tools?: string[]
  image?: boolean
}

export type HistoryView = {
  rows: HistoryRow[]
  frames: ImageFrameState[]
}

function phraseParams(
  params: Record<string, string> | undefined,
  t: TFunction,
): Record<string, string> {
  if (!params) return {}
  const next = { ...params }
  if (next.object) {
    const readable = next.object.replace(/_/g, ' ')
    next.object = t(`activity.object.${next.object}`, {
      ns: 'communication',
      defaultValue: readable,
    })
  }
  return next
}

export function historyLabel(row: HistoryRow, t: TFunction): string {
  if (row.labelKey === 'activity.workedFor' || row.labelKey === 'activity.thoughtFor') {
    return t(row.labelKey, {
      ns: 'communication',
      count: row.count,
      duration: formatDuration(row.durationMs),
      defaultValue: row.label,
    })
  }
  if (row.labelKey === 'activity.actionCount') {
    return t(row.labelKey, { ns: 'communication', count: row.count, defaultValue: row.label })
  }
  if (row.labelKey) {
    return t(row.labelKey, {
      ns: 'communication',
      ...(phraseParams(row.labelParams, t)),
      defaultValue: row.label || row.labelKey,
    })
  }
  return row.label
}

function readHistory(raw: unknown): HistoryView | null {
  if (!raw || typeof raw !== 'object') return null
  const body = raw as Record<string, unknown>
  const rows = Array.isArray(body.rows)
    ? body.rows.flatMap((row) => {
        if (!row || typeof row !== 'object') return []
        const rec = row as Record<string, unknown>
        const params = rec.label_params
        const clean: Record<string, string> = {}
        if (params && typeof params === 'object' && !Array.isArray(params)) {
          for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
            if (typeof value === 'string' && value) clean[key] = value
          }
        }
        const parsed: HistoryRow = {
          kind: asKind(rec.kind),
          count: typeof rec.count === 'number' ? rec.count : 0,
          durationMs: typeof rec.duration_ms === 'number' ? rec.duration_ms : 0,
          labelKey: str(rec.label_key),
          label: str(rec.label),
          image: rec.image === true,
        }
        if (Object.keys(clean).length) parsed.labelParams = clean
        const tools = Array.isArray(rec.tools)
          ? rec.tools.filter((tool): tool is string => typeof tool === 'string' && Boolean(tool))
          : []
        if (tools.length) parsed.tools = tools
        return [parsed]
      })
    : []
  const frames = Array.isArray(body.frames)
    ? body.frames.flatMap((frame) => {
        if (!frame || typeof frame !== 'object') return []
        const rec = frame as Record<string, unknown>
        const status = rec.status === 'ready' || rec.status === 'error' ? rec.status : 'running'
        return [{ id: str(rec.id), status, src: str(rec.src) || null, alt: '' } satisfies ImageFrameState]
      })
    : []
  if (!rows.length && !frames.length) return null
  return { rows, frames }
}

export type MessageActivity = {
  activity: ActivityItem[]
  activityAfter: ActivityItem[]
  /** False in list payloads: tool input/result and thinking text load on expand. */
  activityDetail: boolean
  hasActivity: boolean
  turnId: string | null
  history: HistoryView | null
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
    history: readHistory(payload.history ?? raw.history),
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

/** Hostname for a web_search / fetch_url item. The API stamps `host` on the public item. */
export function webSearchHost(item: ActivityItem): string {
  if (item.host) return item.host
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

/** Favicon URL from the API, else the first hit, else a Google s2 icon. */
export function webSearchFavicon(item: ActivityItem): string {
  if (item.faviconUrl) return item.faviconUrl
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

const PEER_TOOLS = new Set(['invite_to_thread', 'ask_agent', 'handoff_to'])

/** Who an invite, question or handoff is aimed at, when the payload says. */
export function inviteTarget(item: ActivityItem): { id: string; name: string; kind: string } | null {
  if (!item.tool || !PEER_TOOLS.has(item.tool)) return null
  const input = asRecord(item.input)
  const result = asRecord(item.result)
  const id = String(result?.ref_id || result?.agent_id || input?.id || input?.agent_id || '').trim()
  const name = String(result?.name || result?.agent_name || input?.name || '').trim()
  const kind = String(result?.kind || input?.kind || (item.tool === 'invite_to_thread' ? '' : 'agent')).trim()
  if (!id && !name) return null
  return { id, name, kind }
}

/** Line for one action: its label, or a kind fallback. */
export function itemLabel(item: ActivityItem, t: TFunction): string {
  if (item.labelKey) {
    return t(item.labelKey, {
      ns: 'communication',
      ...phraseParams(item.labelParams, t),
      defaultValue: item.label || item.tool,
    })
  }
  if (item.kind === 'think') {
    if (item.status === 'running') return t('activity.thinking', { ns: 'communication' })
    if (item.status === 'error') return t('activity.thoughtFailed', { ns: 'communication' })
    return t('activity.thought', { ns: 'communication' })
  }
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
  if (item.tool === 'generate_image') {
    if (item.status === 'error') {
      return t('activity.imageFailed', { ns: 'communication', defaultValue: 'Image was not generated' })
    }
    return t('activity.generatingImage', { ns: 'communication', defaultValue: 'Generating image' })
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

/** The one live line, chosen by the API (`status` on turn events). */
export type TurnStatus = {
  labelKey: string
  label: string
  labelParams?: Record<string, string>
  tool: string
  host: string
  frames: ImageFrameState[]
}

export function statusLabel(status: TurnStatus | null | undefined, t: TFunction): string {
  if (!status) return ''
  if (status.labelKey) {
    return t(status.labelKey, {
      ns: 'communication',
      ...(phraseParams(status.labelParams, t)),
      defaultValue: status.label || status.tool,
    })
  }
  return status.host || status.label || ''
}

function readStatus(raw: unknown): TurnStatus | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const labelKey = str(row.label_key ?? row.labelKey)
  const label = str(row.label)
  const tool = str(row.tool)
  const host = str(row.host)
  const frames = Array.isArray(row.frames)
    ? row.frames.flatMap((frame) => {
        if (!frame || typeof frame !== 'object') return []
        const rec = frame as Record<string, unknown>
        const frameStatus = rec.status === 'ready' || rec.status === 'error' ? rec.status : 'running'
        return [{ id: str(rec.id), status: frameStatus, src: str(rec.src) || null, alt: '' } satisfies ImageFrameState]
      })
    : []
  if (!labelKey && !label && !host && frames.length === 0) return null
  const status: TurnStatus = { labelKey, label, tool, host, frames }
  const params = row.label_params ?? row.labelParams
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    const clean: Record<string, string> = {}
    for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
      if (typeof value === 'string' && value) clean[key] = value
    }
    if (Object.keys(clean).length) status.labelParams = clean
  }
  return status
}

export type LiveTurn = {
  streamId: string | null
  entries: LiveEntry[]
  /** Between `agent.turn start` and `end`. */
  active: boolean
  /** `agent.turn end` arrived; the view waits for the saved messages. */
  ended: boolean
  /** Thinking text per think item id. */
  thinking: Record<string, string>
  /** Live status line from the API. Null hides it. */
  status: TurnStatus | null
  /** Render blocks from the socket `surface`. Null means derive them from entries. */
  blocks: LiveBlock[] | null
  /** Orb face from the socket. Null means the older local guess. */
  motion: BotOrbMotion | null
  /** Reaction the server picked for the end of the turn (done, leave, alert). */
  closing?: BotOrbMotion | null
  /** Who speaks in this turn, from the stream itself. */
  author?: LiveAuthor | null
  /** `silent` when the agent passed; the turn has nothing to show. */
  outcome?: string | null
}

export type LiveAuthor = { id: string; name: string }

export const EMPTY_TURN: LiveTurn = {
  streamId: null,
  entries: [],
  active: false,
  ended: false,
  thinking: {},
  status: null,
  blocks: null,
  motion: null,
  closing: null,
  author: null,
  outcome: null,
}

function startTurn(streamId: string | null): LiveTurn {
  return { ...EMPTY_TURN, streamId, active: true, thinking: {} }
}

function readAuthor(raw: unknown): LiveAuthor | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = str(row.id)
  return id ? { id, name: str(row.name) } : null
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
  if (!current.author) {
    const author = readAuthor(data.author)
    if (author) current = { ...current, author }
  }
  if (event === 'agent.turn' && data.phase === 'end' && data.outcome === 'silent') {
    return { ...EMPTY_TURN, streamId: current.streamId, author: current.author, ended: true, outcome: 'silent' }
  }
  if ('status' in data) current = { ...current, status: readStatus(data.status) }
  const fromSurface = applySurface(current, data.surface)
  if (fromSurface) current = fromSurface
  switch (event) {
    case 'agent.turn':
      if (data.phase === 'end') {
        const closing = isBotOrbMotion(data.closing) ? data.closing : null
        return { ...current, active: false, ended: true, closing }
      }
      return current.active ? current : { ...current, active: true, ended: false }
    case 'agent.activity': {
      if (fromSurface) return { ...current, active: true }
      current = { ...current, blocks: null }
      const item = normalizeActivityItem(data.item)
      if (!item) return current
      return { ...current, active: true, entries: upsertItem(current.entries, item) }
    }
    case 'agent.thinking': {
      if (fromSurface) return { ...current, active: true }
      const itemId = str(data.item_id)
      const delta = str(data.delta)
      if (!itemId || !delta) return current
      return {
        ...current,
        active: true,
        thinking: { ...current.thinking, [itemId]: (current.thinking[itemId] ?? '') + delta },
      }
    }
    case 'message.start': {
      // A bubble opens before its first word: show it empty with typing dots.
      const segmentId = str(data.segment_id) || 'speech'
      if (current.entries.some((row) => row.type === 'speech' && row.segmentId === segmentId)) {
        return { ...current, active: true }
      }
      return {
        ...current,
        active: true,
        entries: [...current.entries, { type: 'speech', segmentId, text: '' }],
        blocks: current.blocks ? [...current.blocks, { type: 'speech', key: segmentId, text: '' }] : null,
      }
    }
    case 'message.part': {
      if (fromSurface) return { ...current, active: true }
      current = { ...current, blocks: null }
      const segmentId = str(data.segment_id) || 'speech'
      const text = str(data.text)
      const entries = current.entries.filter(
        (row) => !(row.type === 'speech' && row.segmentId === segmentId),
      )
      if (text) entries.push({ type: 'speech', segmentId, text })
      return { ...current, active: true, entries }
    }
    case 'message.delta': {
      if (fromSurface) return { ...current, active: true }
      current = { ...current, blocks: null }
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

/** Replace the open turn with the document the API just published. */
function applySurface(turn: LiveTurn, raw: unknown): LiveTurn | null {
  if (!raw || typeof raw !== 'object') return null
  const body = raw as Record<string, unknown>
  if (!Array.isArray(body.blocks)) return null
  const entries: LiveEntry[] = []
  for (const block of body.blocks) {
    if (!block || typeof block !== 'object') continue
    const row = block as Record<string, unknown>
    if (row.type === 'speech') {
      const text = str(row.text)
      if (!text) continue
      entries.push({ type: 'speech', segmentId: str(row.id) || 'speech', text })
      continue
    }
    if (row.type !== 'activity' || !Array.isArray(row.items)) continue
    for (const item of row.items) {
      const norm = normalizeActivityItem(item)
      if (norm) entries.push({ type: 'activity', item: norm })
    }
  }
  const blocks: LiveBlock[] = []
  for (const block of body.blocks) {
    if (!block || typeof block !== 'object') continue
    const row = block as Record<string, unknown>
    if (row.type === 'speech') {
      const text = str(row.text)
      if (!text) continue
      blocks.push({ type: 'speech', key: str(row.id) || 'speech', text })
      continue
    }
    if (row.type !== 'activity' || !Array.isArray(row.items)) continue
    const items = row.items.map(normalizeActivityItem).filter((item): item is ActivityItem => item !== null)
    if (!items.length) continue
    blocks.push({ type: 'activity', key: str(row.id) || items[0].id, items })
  }
  return {
    ...turn,
    entries,
    blocks,
    motion: SURFACE_MOTIONS.has(str(body.motion) as BotOrbMotion) ? (str(body.motion) as BotOrbMotion) : turn.motion,
    status: 'status' in body ? readStatus(body.status) : turn.status,
  }
}

function applyThreadPresence(turn: LiveTurn, data: Record<string, unknown>): LiveTurn {
  const phase = str(data.phase)
  if (phase === 'idle') return { ...turn, active: false, ended: true }
  if (phase === 'writing' || phase === 'thinking' || phase === 'working') {
    // The turn event already carried the surface. Presence is only the lamp.
    return turn.active ? turn : { ...turn, active: true }
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
function blocksFromEntries(turn: LiveTurn): LiveBlock[] {
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

/** Blocks the socket published, otherwise the entries folded locally. */
export function liveBlocks(turn: LiveTurn): LiveBlock[] {
  const blocks = turn.blocks ?? blocksFromEntries(turn)
  if (!Object.keys(turn.thinking).length) return blocks
  return blocks.map((block) => {
    if (block.type !== 'activity') return block
    return {
      ...block,
      items: block.items.map((item) =>
        turn.thinking[item.id] ? { ...item, text: turn.thinking[item.id] } : item,
      ),
    }
  })
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

/** Drop a live overlay that has not moved for this long (crashed worker, reload). */
export const LIVE_TURN_STALE_MS = 120_000

/** Active turn from a plain text stream (SSE reply without gateway events). */
export function textOnlyTurn(text: string, parts?: string[]): LiveTurn {
  const bubbles = (parts ?? []).map((part) => part.trim()).filter(Boolean)
  const entries = bubbles.length
    ? bubbles.map((part, index) => ({ type: 'speech' as const, segmentId: `speech-${index}`, text: part }))
    : text
      ? [{ type: 'speech' as const, segmentId: 'speech', text }]
      : []
  return {
    ...EMPTY_TURN,
    active: true,
    motion: bubbles.length || text ? null : 'thinking',
    status: bubbles.length || text
      ? null
      : { labelKey: 'activity.looking', label: '', tool: '', host: '', frames: [] },
    entries,
  }
}
