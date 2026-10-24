import { intercomRoutes } from '../api/routes/intercom.routes'
import { apiGet, apiPost, apiPut, buildAuthHeaders } from './api'
import { APP_API_BASE } from './api.config'

/** Fired after pins change so the dock refetches its seats. */
export const DOCK_CHANGED_EVENT = 'bokito:dock-agents-changed'

export type DockPin = { agentId: string; dialKey: string }
export type DockConfig = { pins: DockPin[]; keys: string[]; allCallKey: string }

type RawDock = {
  agents?: { agent_id: string; dial_key: string }[]
  keys?: string[]
  all_call_key?: string
}

function normalize(raw: RawDock): DockConfig {
  return {
    pins: (raw.agents ?? []).map((row) => ({ agentId: String(row.agent_id), dialKey: row.dial_key })),
    keys: raw.keys ?? [],
    allCallKey: raw.all_call_key || 'F12',
  }
}

export async function fetchDockAgents(token: string): Promise<DockConfig> {
  return normalize(await apiGet<RawDock>(intercomRoutes.dockAgents, token))
}

export async function saveDockAgents(token: string, pins: DockPin[]): Promise<DockConfig> {
  const out = normalize(
    await apiPut<RawDock>(
      intercomRoutes.dockAgents,
      { agents: pins.map((pin) => ({ agent_id: pin.agentId, dial_key: pin.dialKey })) },
      token,
    ),
  )
  window.dispatchEvent(new Event(DOCK_CHANGED_EVENT))
  return out
}

export async function pinAgent(token: string, agentId: string, dialKey: string): Promise<DockConfig> {
  const current = await fetchDockAgents(token)
  const rest = current.pins.filter((pin) => pin.agentId !== agentId && pin.dialKey !== dialKey)
  return saveDockAgents(token, [...rest, { agentId, dialKey }])
}

export async function unpinAgent(token: string, agentId: string): Promise<DockConfig> {
  const current = await fetchDockAgents(token)
  return saveDockAgents(
    token,
    current.pins.filter((pin) => pin.agentId !== agentId),
  )
}

export type IntercomResult = {
  transcript: string
  broadcast: boolean
  agentId: string | null
  agentName: string
  decision: string | null
  threadId: string | null
  threadTitle: string
  messageId: string | null
  ack: string
  working: boolean
  results: { agentId: string; agentName: string; decision: string; threadId: string | null; threadTitle: string }[]
}

type RawResult = {
  transcript?: string
  broadcast?: boolean
  agent_id?: string
  agent_name?: string
  decision?: string
  thread_id?: string
  thread_title?: string
  message_id?: string
  ack?: string
  working?: boolean
  results?: { agent_id: string; agent_name: string; decision: string; thread_id?: string; thread_title?: string }[]
}

/** Upload one hold. `agentId` empty means the all-call dial. */
export async function sendIntercom(
  token: string,
  input: {
    agentId: string | null
    audio: Blob
    filename: string
    threadId?: string | null
    replyToNoteId?: string | null
    positionMs?: number | null
    /** Agents in the dock row. F12 falls back to these when no name matches. */
    seatIds?: string[]
  },
): Promise<IntercomResult> {
  const form = new FormData()
  form.append('audio', input.audio, input.filename)
  if (input.threadId) form.append('thread_id', input.threadId)
  if (!input.agentId && input.seatIds?.length) form.append('seat_ids', input.seatIds.join(','))
  if (input.replyToNoteId) form.append('reply_to_note_id', input.replyToNoteId)
  if (input.positionMs != null) form.append('position_ms', String(Math.max(0, Math.round(input.positionMs))))
  const path = input.agentId ? intercomRoutes.talk(input.agentId) : intercomRoutes.talkAll
  const res = await fetch(`${APP_API_BASE}${path}`, {
    method: 'POST',
    headers: buildAuthHeaders(token, false),
    credentials: 'include',
    body: form,
  })
  const text = await res.text()
  let raw: RawResult & { detail?: unknown; error?: { message?: string } } = {}
  try {
    raw = text ? JSON.parse(text) : {}
  } catch {
    raw = {}
  }
  if (!res.ok) {
    const detail =
      typeof raw.detail === 'string' ? raw.detail : raw.error?.message || `HTTP ${res.status}`
    throw new Error(detail)
  }
  return {
    transcript: raw.transcript ?? '',
    broadcast: Boolean(raw.broadcast),
    agentId: raw.agent_id ?? null,
    agentName: raw.agent_name ?? '',
    decision: raw.decision ?? null,
    threadId: raw.thread_id ?? null,
    threadTitle: raw.thread_title ?? '',
    messageId: raw.message_id ?? null,
    ack: raw.ack ?? '',
    working: Boolean(raw.working),
    results: (raw.results ?? []).map((row) => ({
      agentId: row.agent_id,
      agentName: row.agent_name,
      decision: row.decision,
      threadId: row.thread_id ?? null,
      threadTitle: row.thread_title ?? '',
    })),
  }
}

/** The agent's intercom conversation with this person (created on first use). */
export async function openIntercomLane(token: string, agentId: string): Promise<string> {
  const res = await apiPost<{ thread_id: string }>(intercomRoutes.lane(agentId), {}, token)
  return res.thread_id
}

/** Landing correction: move what was said to another conversation, or a new one. */
export async function correctIntercomRoute(
  token: string,
  messageId: string,
  targetId: string | null,
): Promise<{ thread_id: string; thread_title: string }> {
  return apiPost(intercomRoutes.route(messageId), { target_signal_id: targetId }, token)
}
