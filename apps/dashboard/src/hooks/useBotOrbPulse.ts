/**
 * Lightweight one-shot pulses for agent marks (yes/no/alert/jump).
 * Decision resolve, wake, and errors publish here; AgentMark consumers subscribe.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { BotOrbDrive, BotOrbMotion } from '../lib/bot-orb-motion'
import { isBotOrbOneShot } from '../lib/bot-orb-motion'

type PulseMap = Record<string, BotOrbDrive>

let pulses: PulseMap = {}
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): PulseMap {
  return pulses
}

/** Fire a one-shot on an agent mark (by agent id). */
export function publishBotOrbPulse(agentId: string | null | undefined, drive: BotOrbDrive) {
  if (!agentId || !isBotOrbOneShot(drive.motion)) return
  pulses = {
    ...pulses,
    [agentId]: {
      motion: drive.motion,
      pulseId: drive.pulseId ?? `${drive.motion}-${Date.now()}`,
    },
  }
  emit()
  // Auto-clear after the shot so later mounts don't replay.
  window.setTimeout(() => {
    const cur = pulses[agentId]
    if (cur && cur.pulseId === pulses[agentId]?.pulseId) {
      const next = { ...pulses }
      delete next[agentId]
      pulses = next
      emit()
    }
  }, 2200)
}

export function useBotOrbPulse(agentId: string | null | undefined): BotOrbDrive | null {
  const map = useSyncExternalStore(subscribe, getSnapshot, () => ({} as PulseMap))
  if (!agentId) return null
  return map[agentId] ?? null
}

/** Merge live loop + optional pulse for a mark. */
export function useAgentOrbDrive(
  agentId: string | null | undefined,
  live: BotOrbMotion | null | undefined,
): { motion: BotOrbMotion; pulseId: string | null; baseMotion: BotOrbMotion } {
  const pulse = useBotOrbPulse(agentId)
  const base: BotOrbMotion = live && live !== 'idle' ? live : 'idle'
  if (pulse && isBotOrbOneShot(pulse.motion)) {
    return {
      motion: pulse.motion,
      pulseId: pulse.pulseId ?? null,
      baseMotion: base,
    }
  }
  return { motion: base, pulseId: null, baseMotion: base }
}

/** Identity-dialog preview: local state without the global store. */
export function useLocalOrbPreview(initial: BotOrbMotion = 'idle') {
  const [motion, setMotion] = useState<BotOrbMotion>(initial)
  const [pulseId, setPulseId] = useState<string | null>(null)
  const [spawnKey, setSpawnKey] = useState<string | null>(null)
  const [previewingSpawn, setPreviewingSpawn] = useState(false)
  useEffect(() => {
    if (!isBotOrbOneShot(motion)) return
    const t = window.setTimeout(() => setMotion('idle'), 2000)
    return () => window.clearTimeout(t)
  }, [motion, pulseId])
  useEffect(() => {
    if (!previewingSpawn) return
    const t = window.setTimeout(() => setPreviewingSpawn(false), 1150)
    return () => window.clearTimeout(t)
  }, [previewingSpawn, spawnKey])
  return {
    motion,
    pulseId,
    spawnKey,
    previewingSpawn,
    play(next: BotOrbMotion) {
      setPreviewingSpawn(false)
      if (isBotOrbOneShot(next)) {
        setPulseId(`${next}-${Date.now()}`)
      }
      setMotion(next)
    },
    playSpawn() {
      setMotion('idle')
      setPreviewingSpawn(true)
      setSpawnKey(`spawn-preview-${Date.now()}`)
    },
  }
}
