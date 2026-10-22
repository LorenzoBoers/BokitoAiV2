/**
 * Shell-wide state for the in-app agent call (ringing / live).
 * The call overlay owns the session; the chat stack reads this so the
 * matching card can show the ring and follow the conversation.
 */
import { useSyncExternalStore } from 'react'

export type AgentCallLive = {
  callId: string
  signalId: string
  status: 'ringing' | 'live' | 'connecting'
  agentName: string
  title: string
  summary: string
  ringUntil: string | null
}

type Listener = () => void

let current: AgentCallLive | null = null
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
  if (!current) return
  current = null
  emit()
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
