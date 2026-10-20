/**
 * Client side of the conversation event log (`services/thread_log.py`).
 *
 * The API numbers every live event of a conversation (`event_id`, with the
 * `prev_id` before it). This reducer applies them in that order: one live turn
 * per `stream_id`, the floor, and a cursor. It never guesses: a gap asks for a
 * replay, a finished turn never reopens, and every turn event carries the
 * whole `surface`, so one event is enough to draw a turn.
 */

import { applyTurnEvent, EMPTY_TURN, type LiveTurn } from './agentActivity'

export type ThreadLogTurn = LiveTurn & {
  streamId: string
  /** Id of the first event seen for this turn; orders turns on screen. */
  firstEventId: string
  lastEventId: string
  stopReason: string | null
}

export type ThreadLogState = {
  /** Last applied event id; null before the first sync. */
  cursor: string | null
  /** True between a `sync` request and its `log.synced`. */
  syncing: boolean
  /** Snapshot sync (no cursor): turns not in the snapshot are dropped on `log.synced`. */
  snapshot: boolean
  snapshotTurns: string[]
  turns: Record<string, ThreadLogTurn>
  /** Turns that ended; late events for them are ignored. */
  completed: string[]
  /** Highest event id seen, applied or not. */
  maxSeen: string
  /** `active_turn` from the last floor event; undefined until one arrives. */
  floor: unknown
  floorSeen: boolean
  floorEventId: string
}

export type ThreadLogEvent = { event: string; data: Record<string, unknown> }

/** What the hook must do after an event. */
export type ThreadLogEffect = 'none' | 'resync' | 'refetch'

export const EMPTY_LOG: ThreadLogState = {
  cursor: null,
  syncing: false,
  snapshot: false,
  snapshotTurns: [],
  turns: {},
  completed: [],
  maxSeen: '',
  floor: undefined,
  floorSeen: false,
  floorEventId: '',
}

const TURN_EVENTS = new Set([
  'agent.turn',
  'agent.activity',
  'agent.thinking',
  'message.start',
  'message.delta',
  'message.part',
])

const COMPLETED_KEEP = 50

/** Turns that end without a saved bubble leave the screen at once. */
const DROP_ON_END = new Set(['passed', 'cancelled', 'superseded'])

/** `"<ms>-<n>"` comparison. Empty sorts first. */
export function compareEventIds(a: string | null | undefined, b: string | null | undefined): number {
  const parse = (id: string | null | undefined): [number, number] => {
    if (!id) return [-1, -1]
    const [head, tail] = String(id).split('-')
    const ms = Number(head)
    const n = Number(tail ?? 0)
    return Number.isFinite(ms) && Number.isFinite(n) ? [ms, n] : [-1, -1]
  }
  const [am, an] = parse(a)
  const [bm, bn] = parse(b)
  return am !== bm ? am - bm : an - bn
}

function str(value: unknown): string {
  return value == null ? '' : String(value)
}

function rememberCompleted(completed: string[], id: string): string[] {
  if (completed.includes(id)) return completed
  const next = [...completed, id]
  return next.length > COMPLETED_KEEP ? next.slice(next.length - COMPLETED_KEEP) : next
}

function withoutTurn(turns: Record<string, ThreadLogTurn>, id: string): Record<string, ThreadLogTurn> {
  if (!(id in turns)) return turns
  const next = { ...turns }
  delete next[id]
  return next
}

/** Start a sync: `snapshot` when there is no cursor to replay from. */
export function beginSync(state: ThreadLogState): ThreadLogState {
  return { ...state, syncing: true, snapshot: !state.cursor, snapshotTurns: [] }
}

function applyTurn(state: ThreadLogState, event: string, data: Record<string, unknown>, eventId: string): ThreadLogState {
  const streamId = str(data.stream_id)
  if (!streamId || state.completed.includes(streamId)) return state
  const prev = state.turns[streamId]
  if (prev && eventId && compareEventIds(eventId, prev.lastEventId) <= 0) return state
  const base: LiveTurn = prev ?? EMPTY_TURN
  const next = applyTurnEvent(base, event, data)
  const snapshotTurns =
    state.syncing && state.snapshot && !state.snapshotTurns.includes(streamId)
      ? [...state.snapshotTurns, streamId]
      : state.snapshotTurns
  const ending = event === 'agent.turn' && data.phase === 'end'
  if (ending) {
    const reason = str(data.stop_reason) || (data.outcome === 'silent' ? 'passed' : 'end_turn')
    const completed = rememberCompleted(state.completed, streamId)
    if (DROP_ON_END.has(reason) || !prev) {
      return { ...state, snapshotTurns, completed, turns: withoutTurn(state.turns, streamId) }
    }
    return {
      ...state,
      snapshotTurns,
      completed,
      turns: {
        ...state.turns,
        [streamId]: { ...next, streamId, active: false, ended: true, firstEventId: prev.firstEventId, lastEventId: eventId || prev.lastEventId, stopReason: reason },
      },
    }
  }
  return {
    ...state,
    snapshotTurns,
    turns: {
      ...state.turns,
      [streamId]: {
        ...next,
        streamId,
        firstEventId: prev?.firstEventId || eventId,
        lastEventId: eventId || prev?.lastEventId || '',
        stopReason: null,
      },
    },
  }
}

/**
 * Apply one gateway event. Returns the next state and what the caller must do
 * (`resync` on a gap, `refetch` when the replay could not cover the gap).
 */
export function applyThreadEvent(
  state: ThreadLogState,
  { event, data }: ThreadLogEvent,
): { state: ThreadLogState; effect: ThreadLogEffect } {
  if (event === 'log.synced') {
    let cursor = state.cursor ?? ''
    for (const id of [str(data.head), state.maxSeen]) {
      if (compareEventIds(id, cursor) > 0) cursor = id
    }
    let turns = state.turns
    if (state.snapshot) {
      // A turn the server no longer has open ended while we were away.
      for (const id of Object.keys(turns)) {
        if (turns[id].active && !state.snapshotTurns.includes(id)) turns = withoutTurn(turns, id)
      }
    }
    const next = { ...state, cursor: cursor || null, syncing: false, snapshot: false, snapshotTurns: [], turns }
    return { state: next, effect: data.complete === false ? 'refetch' : 'none' }
  }

  const eventId = str(data.event_id)
  const prevId = str(data.prev_id)
  let current = state
  if (eventId) {
    if (state.syncing) {
      // Replay and live frames interleave while syncing: order per turn
      // (`lastEventId`) and move the cursor on `log.synced`.
      if (compareEventIds(eventId, state.maxSeen) > 0) current = { ...state, maxSeen: eventId }
    } else {
      if (state.cursor && compareEventIds(eventId, state.cursor) <= 0) return { state, effect: 'none' }
      if (state.cursor && prevId !== state.cursor) {
        // Missed something: ask the server to replay from what we have.
        return { state: beginSync(state), effect: 'resync' }
      }
      current = { ...state, cursor: eventId, maxSeen: eventId }
    }
  }

  if (TURN_EVENTS.has(event)) {
    return { state: applyTurn(current, event, data, eventId), effect: 'none' }
  }
  if (event === 'floor') {
    if (eventId && compareEventIds(eventId, current.floorEventId) <= 0) return { state: current, effect: 'none' }
    return {
      state: { ...current, floor: data.active_turn ?? null, floorSeen: true, floorEventId: eventId },
      effect: 'none',
    }
  }
  return { state: current, effect: 'none' }
}

/** Live turns in the order they started. */
export function orderedTurns(state: ThreadLogState): ThreadLogTurn[] {
  return Object.values(state.turns).sort((a, b) => compareEventIds(a.firstEventId, b.firstEventId))
}

/** Drop a turn the timeline now shows as saved messages. */
export function dropTurn(state: ThreadLogState, streamId: string): ThreadLogState {
  if (!(streamId in state.turns)) return state
  return {
    ...state,
    turns: withoutTurn(state.turns, streamId),
    completed: rememberCompleted(state.completed, streamId),
  }
}
