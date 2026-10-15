/**
 * Shared shapes for Bokito thread messaging (hub, widget, mobile).
 * Transport stays caller-owned (auth headers, base URL).
 */

export type ChatParticipant = {
  id: string
  kind: 'user' | 'agent' | 'contact' | 'team' | string
  ref_id: string
  role: 'owner' | 'member' | 'watcher' | string
  name: string
  email?: string
  joined_via?: string
  avatar_kind?: string | null
  avatar_icon?: string | null
  avatar_color?: string | null
  avatar_shape?: string | null
  avatar_image_url?: string | null
}

export type ChatActiveTurn = {
  kind?: string
  ref_id?: string
  name?: string
  nonce?: string
  deadline?: string
  prompt?: string
  streak?: number
} | null

export type ChatThreadDetail = {
  thread: Record<string, unknown>
  messages: unknown[]
  events?: unknown[]
  sessions?: unknown[]
  participants?: ChatParticipant[]
  active_turn?: ChatActiveTurn
  has_older?: boolean
  oldest_message_id?: string | null
}

export type FetchJson = (path: string, init?: RequestInit) => Promise<unknown>

/** Normalize API snake_case thread detail into a stable client shape. */
export function normalizeThreadDetail(payload: unknown): ChatThreadDetail | null {
  if (!payload || typeof payload !== 'object') return null
  const row = payload as Record<string, unknown>
  if (!row.thread || typeof row.thread !== 'object') return null
  const participants = Array.isArray(row.participants)
    ? (row.participants as ChatParticipant[])
    : []
  const active =
    row.active_turn && typeof row.active_turn === 'object'
      ? (row.active_turn as ChatActiveTurn)
      : null
  return {
    thread: row.thread as Record<string, unknown>,
    messages: Array.isArray(row.messages) ? row.messages : [],
    events: Array.isArray(row.events) ? row.events : [],
    sessions: Array.isArray(row.sessions) ? row.sessions : [],
    participants,
    active_turn: active,
    has_older: Boolean(row.has_older),
    oldest_message_id:
      typeof row.oldest_message_id === 'string' ? row.oldest_message_id : null,
  }
}

/** REST path for thread detail (caller prefixes API base). */
export function threadDetailPath(threadId: string, opts?: { limit?: number; before?: string }): string {
  const params = new URLSearchParams()
  if (opts?.limit != null) params.set('limit', String(opts.limit))
  if (opts?.before) params.set('before', opts.before)
  const qs = params.toString()
  const base = `/api/signals/threads/${encodeURIComponent(threadId)}`
  return qs ? `${base}?${qs}` : base
}

export async function fetchThreadDetail(
  fetchJson: FetchJson,
  threadId: string,
  opts?: { limit?: number; before?: string },
): Promise<ChatThreadDetail | null> {
  const payload = await fetchJson(threadDetailPath(threadId, opts))
  return normalizeThreadDetail(payload)
}

/** Presence / active-turn fields on gateway WS payloads. */
export type PresencePhase = 'thinking' | 'working' | 'writing' | 'typing' | 'idle'

export type ThreadPresenceEvent = {
  signal_id: string
  phase?: PresencePhase | string
  actor_kind?: string
  actor_id?: string
  actor_name?: string
  active_turn?: ChatActiveTurn
}
