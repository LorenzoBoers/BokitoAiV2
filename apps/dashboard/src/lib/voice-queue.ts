import { useSyncExternalStore } from 'react'
import { intercomRoutes } from '../api/routes/intercom.routes'
import { apiGet, apiPost, buildAuthHeaders } from './api'
import { APP_API_BASE } from './api.config'
import { NOTE_IN_LEAD_MS, playEarcon } from './earcons'
import { onGatewayEvent } from './gateway'

/* One voicemail player per person. The server keeps the queue (shared by
 * every device); this module plays it in order, pauses for holds and live
 * calls, and replays what played while nobody was at the screen. */

export type IntercomNote = {
  noteId: string
  agentId: string | null
  agentName: string
  signalId: string | null
  messageId: string | null
  threadTitle: string
  kind: 'ack' | 'result' | 'question' | 'digest' | 'progress'
  text: string
  durationMs: number
  hasAudio: boolean
  replyToId: string | null
  viaAgentId: string | null
  viaAgentName: string
  autoplay: boolean
}

export type NowPlaying = {
  note: IntercomNote
  paused: boolean
  /** 0..1 through the note; drives subtitles and the waveform ring. */
  progress: number
}

export type HoldContext = { replyToNoteId: string; positionMs: number; agentId: string | null }

type State = {
  now: NowPlaying | null
  waiting: IntercomNote[]
}

type BlockReason = 'live' | 'recording' | 'away'

const IDLE_MS = 90_000
const CHANNEL = 'bokito:intercom'

let state: State = { now: null, waiting: [] }
const listeners = new Set<() => void>()
const blocked = new Set<BlockReason>()
let token: string | null = null
let userId: string | null = null
let player: HTMLAudioElement | null = null
let objectUrl: string | null = null
let silentTimer: number | null = null
let silentStartedAt = 0
let silentElapsed = 0
let lastActivity = Date.now()
let missed: IntercomNote[] = []
let heldNoteId: string | null = null
let bus: BroadcastChannel | null = null
const claimedElsewhere = new Set<string>()
let playGeneration = 0
const tabId = Math.random().toString(36).slice(2)
let playingAt = 0

function emit(next: Partial<State>) {
  state = { ...state, ...next }
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useVoiceQueue(): State {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

export function voiceQueueState(): State {
  return state
}

function asNote(raw: Record<string, unknown>): IntercomNote | null {
  const id = typeof raw.note_id === 'string' ? raw.note_id : ''
  if (!id) return null
  const str = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : null)
  return {
    noteId: id,
    agentId: str('agent_id'),
    agentName: str('agent_name') ?? '',
    signalId: str('signal_id'),
    messageId: str('message_id'),
    threadTitle: str('thread_title') ?? '',
    kind: (str('kind') as IntercomNote['kind']) ?? 'result',
    text: str('text') ?? '',
    durationMs: typeof raw.duration_ms === 'number' ? raw.duration_ms : 0,
    hasAudio: Boolean(raw.has_audio),
    replyToId: str('reply_to_id'),
    viaAgentId: str('via_agent_id'),
    viaAgentName: str('via_agent_name') ?? '',
    autoplay: raw.autoplay !== false,
  }
}

function idle(): boolean {
  return Date.now() - lastActivity > IDLE_MS
}

function canPlay(): boolean {
  if (blocked.size) return false
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false
  return true
}

function stopPlayer() {
  if (player) {
    player.onended = null
    player.ontimeupdate = null
    player.onerror = null
    player.pause()
  }
  player = null
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = null
  if (silentTimer !== null) window.clearInterval(silentTimer)
  silentTimer = null
}

function releaseAudio() {
  playGeneration += 1
  stopPlayer()
}

async function markPlayed(note: IntercomNote, skipped = false) {
  try {
    await apiPost(intercomRoutes.played(note.noteId), { skipped }, token ?? undefined)
  } catch {
    // The server prunes stale notes; a lost mark only means a replay later.
  }
}

function finish(skipped = false) {
  const current = state.now
  releaseAudio()
  if (current) {
    if (!skipped) playEarcon('noteOut')
    if (!skipped && idle()) missed = [...missed, current.note]
    void markPlayed(current.note, skipped)
  }
  emit({ now: null })
  window.setTimeout(pump, 200)
}

function tickSilent(total: number, generation: number) {
  silentStartedAt = performance.now() - silentElapsed
  silentTimer = window.setInterval(() => {
    if (generation !== playGeneration) {
      if (silentTimer !== null) window.clearInterval(silentTimer)
      silentTimer = null
      return
    }
    silentElapsed = performance.now() - silentStartedAt
    const progress = Math.min(1, silentElapsed / total)
    if (state.now) emit({ now: { ...state.now, progress } })
    if (progress >= 1) finish()
  }, 120)
}

function liveNote(note: IntercomNote, generation: number): boolean {
  return generation === playGeneration && state.now?.note.noteId === note.noteId && !claimedElsewhere.has(note.noteId)
}

async function start(note: IntercomNote) {
  const generation = ++playGeneration
  stopPlayer()
  playingAt = Date.now()
  bus?.postMessage({ claim: note.noteId, at: playingAt, owner: tabId })
  emit({ now: { note, paused: false, progress: 0 }, waiting: state.waiting.filter((n) => n.noteId !== note.noteId) })
  playEarcon('noteIn')
  await new Promise((resolve) => window.setTimeout(resolve, NOTE_IN_LEAD_MS))
  if (!liveNote(note, generation)) return
  if (!note.hasAudio) {
    silentElapsed = 0
    tickSilent(Math.max(1500, note.durationMs || note.text.length * 60), generation)
    return
  }
  try {
    const res = await fetch(`${APP_API_BASE}${intercomRoutes.audio(note.noteId)}`, {
      headers: buildAuthHeaders(token ?? undefined, false),
      credentials: 'include',
    })
    if (!res.ok) throw new Error(String(res.status))
    const blob = await res.blob()
    if (!liveNote(note, generation)) return
    const url = URL.createObjectURL(blob)
    objectUrl = url
    const audio = new Audio(url)
    audio.ontimeupdate = () => {
      if (player !== audio || !state.now) return
      const total = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : note.durationMs / 1000
      emit({ now: { ...state.now, progress: total ? Math.min(1, audio.currentTime / total) : 0 } })
    }
    audio.onended = () => {
      if (player === audio) finish()
    }
    audio.onerror = () => {
      if (player === audio) finish()
    }
    if (!liveNote(note, generation)) {
      audio.pause()
      if (objectUrl === url) {
        URL.revokeObjectURL(url)
        objectUrl = null
      }
      return
    }
    player = audio
    await audio.play()
    if (!liveNote(note, generation)) audio.pause()
  } catch {
    if (!liveNote(note, generation)) return
    playEarcon('error')
    silentElapsed = 0
    tickSilent(Math.max(1500, note.durationMs || note.text.length * 60), generation)
  }
}

function pump() {
  if (state.now || !canPlay()) return
  // Prefer explicit autoplay; if the tab is awake, also play notes that
  // arrived with autoplay=false (old server presence miss → badge only).
  const next = state.waiting.find((note) => !claimedElsewhere.has(note.noteId) && (note.autoplay || !idle()))
  if (next) void start(next)
}

function enqueue(note: IntercomNote) {
  if (state.waiting.some((n) => n.noteId === note.noteId) || state.now?.note.noteId === note.noteId) return
  const awake = typeof document !== 'undefined' && document.visibilityState === 'visible' && !idle()
  const playable = { ...note, autoplay: note.autoplay || awake }
  // Same rule as the server queue: a newer line from this agent on this lane
  // replaces its unheard filler (a progress only replaces an older progress).
  const fillers = note.kind === 'progress' ? ['progress'] : note.kind === 'ack' ? [] : ['ack', 'progress']
  const replaced = (n: IntercomNote) =>
    fillers.includes(n.kind) && n.agentId !== null && n.agentId === note.agentId && n.signalId === note.signalId
  emit({ waiting: [...state.waiting.filter((n) => !replaced(n)), playable] })
  pump()
}

async function refetch(returning: boolean) {
  if (!token) return
  try {
    const res = await apiGet<{ notes?: Record<string, unknown>[] }>(intercomRoutes.queue(returning), token)
    const notes = (res.notes ?? []).map(asNote).filter((n): n is IntercomNote => Boolean(n))
    const playing = state.now?.note.noteId
    emit({ waiting: notes.filter((n) => n.noteId !== playing).map((n) => ({ ...n, autoplay: true })) })
    pump()
  } catch {
    // Keep what is already queued.
  }
}

/** Start listening for notes. Returns the teardown. */
export function startVoiceQueue(nextToken: string, nextUserId: string): () => void {
  token = nextToken
  userId = nextUserId
  if (typeof BroadcastChannel !== 'undefined') {
    bus = new BroadcastChannel(CHANNEL)
    bus.onmessage = (event: MessageEvent<{ claim?: string; at?: number; owner?: string }>) => {
      const id = event.data?.claim
      const owner = event.data?.owner
      const at = event.data?.at
      if (!id || owner === tabId) return
      claimedElsewhere.add(id)
      const earlier =
        state.now?.note.noteId === id &&
        typeof at === 'number' &&
        (at < playingAt || (at === playingAt && (owner ?? '') < tabId))
      if (earlier) {
        playGeneration += 1
        stopPlayer()
        emit({ now: null, waiting: state.waiting.filter((n) => n.noteId !== id) })
        window.setTimeout(pump, 200)
        return
      }
      emit({ waiting: state.waiting.filter((n) => n.noteId !== id) })
    }
  }
  const offGateway = onGatewayEvent('notifications', (event) => {
    const data = (event.data ?? {}) as Record<string, unknown>
    if (data.user_id !== userId) return
    if (event.event === 'intercom.note') {
      const note = asNote(data)
      if (note) enqueue(note)
    } else if (event.event === 'intercom.played') {
      const id = typeof data.note_id === 'string' ? data.note_id : ''
      if (id && state.now?.note.noteId !== id) emit({ waiting: state.waiting.filter((n) => n.noteId !== id) })
    }
  })
  const onVisible = () => {
    if (document.visibilityState === 'visible') {
      blocked.delete('away')
      void refetch(true)
    }
  }
  const onActivity = () => {
    const wasIdle = idle()
    lastActivity = Date.now()
    if (wasIdle && missed.length) {
      const replay = missed
      missed = []
      emit({ waiting: [...replay, ...state.waiting] })
      pump()
    }
  }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('pointerdown', onActivity, { passive: true })
  window.addEventListener('keydown', onActivity)
  void refetch(true)
  return () => {
    offGateway()
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('pointerdown', onActivity)
    window.removeEventListener('keydown', onActivity)
    bus?.close()
    bus = null
    releaseAudio()
    token = null
    userId = null
    state = { now: null, waiting: [] }
  }
}

export function setQueueBlocked(reason: BlockReason, on: boolean) {
  if (on) blocked.add(reason)
  else blocked.delete(reason)
  pump()
}

/** Stop the note that is playing because the person actually spoke. It does not resume. */
export function interruptForSpeech() {
  if (state.now) finish(false)
}

/** The note that is playing, without stopping it. */
export function playingNoteContext(): HoldContext | null {
  const now = state.now
  if (!now) return null
  const positionMs = player ? Math.round(player.currentTime * 1000) : Math.round(silentElapsed)
  return { replyToNoteId: now.note.noteId, positionMs, agentId: now.note.agentId }
}

export function pauseNote() {
  // An incoming voice note is never paused. Speech stops it through interruptForSpeech.
}

export function resumeNote() {
  if (!state.now || !state.now.paused || !canPlay()) return
  emit({ now: { ...state.now, paused: false } })
  if (player) void player.play().catch(() => finish())
  else if (!state.now.note.hasAudio) tickSilent(Math.max(1500, state.now.note.durationMs || state.now.note.text.length * 60), playGeneration)
}

export function skipNote() {
  if (state.now) finish(true)
}

/**
 * A hold starts. Playback continues until the person actually speaks.
 * The caller learns which note was playing so the recording can reply to it.
 */
export function holdBegan(): HoldContext | null {
  return playingNoteContext()
}

/**
 * The hold ended. `answeredAgentId` is the agent the recording went to:
 * when it is the playing note's agent, that note was answered and stops;
 * otherwise the note resumes where it paused.
 */
export function holdEnded(answeredAgentId: string | null) {
  const id = heldNoteId
  heldNoteId = null
  if (!state.now || state.now.note.noteId !== id) {
    pump()
    return
  }
  if (answeredAgentId && state.now.note.agentId === answeredAgentId) {
    finish(false)
    return
  }
  resumeNote()
}

/** Click on a face: replay that agent's newest note (or the newest digest). */
export async function replayLast(agentId: string | null): Promise<boolean> {
  if (!token) return false
  const queued = state.waiting.find((n) => n.agentId === agentId)
  if (queued) {
    emit({ waiting: [queued, ...state.waiting.filter((n) => n !== queued)] })
    if (state.now) finish(true)
    else pump()
    return true
  }
  try {
    const res = await apiGet<{ note?: Record<string, unknown> | null }>(intercomRoutes.last(agentId), token)
    const note = res.note ? asNote(res.note) : null
    if (!note) return false
    if (state.now) releaseAudio()
    emit({ now: null, waiting: [{ ...note, autoplay: true }, ...state.waiting] })
    pump()
    return true
  } catch {
    return false
  }
}
