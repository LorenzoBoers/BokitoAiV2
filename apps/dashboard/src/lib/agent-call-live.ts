/**
 * Shell-wide state for the in-app agent call (ringing / live).
 * The call overlay owns the session; the chat stack reads this so the
 * matching card can show the ring and follow the conversation.
 */
import { useSyncExternalStore } from 'react'

const TAB_KEY = 'bokito.callTab'

/** Stable id for this browser tab. A reload keeps it; another tab does not. */
export function callTabId(): string {
  try {
    const existing = sessionStorage.getItem(TAB_KEY)
    if (existing) return existing
    const id = crypto.randomUUID()
    sessionStorage.setItem(TAB_KEY, id)
    return id
  } catch {
    return 'tab'
  }
}

export type AgentCallLive = {
  callId: string
  signalId: string
  agentId: string
  status: 'ringing' | 'live' | 'connecting'
  agentName: string
  title: string
  summary: string
  ringUntil: string | null
}

type Listener = () => void

let current: AgentCallLive | null = null
let pushToTalk = false
let heldWanted = false
let speaking = false
/** True only while the microphone is above the speech threshold. */
let userSpeaking = false
/** 0–1 loudness of the open line. The spectrum reads this; it does not re-render. */
let callLevel = 0
let endCall: (() => void) | null = null
const listeners = new Set<Listener>()

function emit() {
  for (const listener of [...listeners]) listener()
}

export function agentCallLive(): AgentCallLive | null {
  return current
}

export function setAgentCallLive(next: AgentCallLive | null) {
  const same =
    current === next ||
    (current != null &&
      next != null &&
      current.callId === next.callId &&
      current.signalId === next.signalId &&
      current.agentId === next.agentId &&
      current.status === next.status &&
      current.agentName === next.agentName &&
      current.title === next.title &&
      current.summary === next.summary &&
      current.ringUntil === next.ringUntil)
  if (same) return
  current = next
  emit()
}

export function clearAgentCallLive(callId?: string) {
  if (callId && current && current.callId !== callId) return
  if (!current && !speaking && !userSpeaking && !sessionSnap) return
  current = null
  speaking = false
  userSpeaking = false
  callLevel = 0
  pushToTalk = false
  heldWanted = false
  sessionSnap = null
  media = null
  emit()
}

export function agentCallLevel(): number {
  return callLevel
}

export function setAgentCallLevel(next: number) {
  callLevel = next
}

export function agentCallSpeaking(): boolean {
  return speaking
}

export function setAgentCallSpeaking(next: boolean) {
  if (speaking === next) return
  speaking = next
  emit()
}

export function agentCallUserSpeaking(): boolean {
  return userSpeaking
}

export function setAgentCallUserSpeaking(next: boolean) {
  if (userSpeaking === next) return
  userSpeaking = next
  emit()
}

/** The call overlay owns hang-up (transcript + voice). The thread bar calls this. */
export function bindAgentCallEnd(handler: (() => void) | null) {
  endCall = handler
}

export function requestAgentCallEnd() {
  endCall?.()
}

export type AgentVoiceOffer = {
  call_id: string
  user_id: string
  signal_id: string
  agent_id?: string | null
  agent_name?: string
  title?: string
  summary?: string
  client_secret: string
  voice?: string
  speed?: number
  language?: string
  voices?: CallVoiceOption[]
  speeds?: number[]
  languages?: string[]
  /** Quickdial: the person holds to speak. The line stays up between turns. */
  pushToTalk?: boolean
}

let startVoice: ((offer: AgentVoiceOffer) => void) | null = null

/** The call overlay owns the audio line. The composer asks it to start voice mode. */
export function bindAgentVoiceStart(handler: ((offer: AgentVoiceOffer) => void) | null) {
  startVoice = handler
}

export function requestAgentVoiceStart(offer: AgentVoiceOffer) {
  pushToTalk = Boolean(offer.pushToTalk)
  startVoice?.(offer)
}

export function agentCallPushToTalk(): boolean {
  return pushToTalk
}

/** True while the quickdial is held, including before the audio line exists. */
export function agentCallHoldWanted(): boolean {
  return heldWanted
}

let holdHandler: ((held: boolean) => void) | null = null

export function bindAgentCallHold(handler: ((held: boolean) => void) | null) {
  holdHandler = handler
}

export function requestAgentCallHold(held: boolean) {
  heldWanted = held
  holdHandler?.(held)
}

export type CallVoiceOption = { id: string; label: string }

export type AgentCallSession = {
  voice: string
  speed: number
  language: string
  voices: CallVoiceOption[]
  speeds: number[]
  languages: string[]
  muted: boolean
  lines: { role: 'user' | 'assistant'; text: string }[]
}

export type CallSessionFields = {
  voice?: string
  speed?: number
  language?: string
  voices?: CallVoiceOption[]
  speeds?: number[]
  languages?: string[]
}

let sessionSnap: AgentCallSession | null = null

function blankSession(): AgentCallSession {
  return {
    voice: '',
    speed: 1,
    language: '',
    voices: [],
    speeds: [],
    languages: [],
    muted: false,
    lines: [],
  }
}

export function agentCallSession(): AgentCallSession | null {
  return sessionSnap
}

export function setAgentCallSession(next: AgentCallSession | null) {
  sessionSnap = next
  emit()
}

export function sessionFromPayload(data: CallSessionFields | null | undefined, opts?: { resetLines?: boolean }) {
  if (!data) return
  const prev = sessionSnap
  sessionSnap = {
    voice: data.voice || prev?.voice || '',
    speed: typeof data.speed === 'number' ? data.speed : (prev?.speed ?? 1),
    language: data.language || prev?.language || '',
    voices: Array.isArray(data.voices) ? data.voices : (prev?.voices ?? []),
    speeds: Array.isArray(data.speeds) ? data.speeds : (prev?.speeds ?? []),
    languages: Array.isArray(data.languages) ? data.languages : (prev?.languages ?? []),
    muted: opts?.resetLines ? false : (prev?.muted ?? false),
    lines: opts?.resetLines ? [] : (prev?.lines ?? []),
  }
  emit()
}

export function setAgentCallLines(lines: { role: 'user' | 'assistant'; text: string }[]) {
  if (!sessionSnap) sessionSnap = blankSession()
  sessionSnap = { ...sessionSnap, lines }
  emit()
}

export function setAgentCallMuted(muted: boolean) {
  if (!sessionSnap) sessionSnap = blankSession()
  if (sessionSnap.muted === muted) return
  sessionSnap = { ...sessionSnap, muted }
  emit()
}

type MediaControls = {
  setMuted: (muted: boolean) => void
  updateSession: (update: { instructions?: string; speed?: number; language?: string }) => void
  restart: (clientSecret: string) => void
}

let media: MediaControls | null = null

export function bindAgentCallMedia(handler: MediaControls | null) {
  media = handler
}

export function requestAgentCallMute(muted: boolean) {
  media?.setMuted(muted)
  setAgentCallMuted(muted)
}

export function requestAgentCallSessionUpdate(update: {
  instructions?: string
  speed?: number
  language?: string
}) {
  media?.updateSession(update)
}

export function requestAgentCallRestart(clientSecret: string) {
  media?.restart(clientSecret)
}

export function useAgentCallSession(): AgentCallSession | null {
  return useSyncExternalStore(subscribe, agentCallSession, () => null)
}

function subscribe(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useAgentCallLive(): AgentCallLive | null {
  return useSyncExternalStore(subscribe, agentCallLive, () => null)
}

export function useAgentCallSpeaking(): boolean {
  return useSyncExternalStore(subscribe, agentCallSpeaking, () => false)
}

export function useAgentCallUserSpeaking(): boolean {
  return useSyncExternalStore(subscribe, agentCallUserSpeaking, () => false)
}
