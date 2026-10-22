/**
 * Bot-orb motion model. Loops are moods the server names on the live turn
 * (`surface.motion`) or the thread sets (listening); one-shots are short
 * reactions to events (decision, wake, turn end). BotOrbAvatar plays them
 * on a spring rig (`bot-orb-rig.ts`).
 */

import type { AgentPresenceStatus } from './teams-api'

/** Face / chrome mood for the bot orb. */
export type BotOrbMotion =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'working'
  | 'searching'
  | 'writing'
  | 'sending'
  | 'sleeping'
  | 'yes'
  | 'no'
  | 'alert'
  | 'jump'
  | 'done'
  | 'leave'

export type BotOrbDrive = {
  motion: BotOrbMotion
  /** Change this to replay a one-shot even when motion is unchanged. */
  pulseId?: string | null
}

export const BOT_ORB_LOOPS = [
  'idle',
  'listening',
  'thinking',
  'working',
  'searching',
  'writing',
  'sending',
  'sleeping',
] as const

export const BOT_ORB_ONE_SHOTS = ['yes', 'no', 'alert', 'jump', 'done', 'leave'] as const
export type BotOrbOneShot = (typeof BOT_ORB_ONE_SHOTS)[number]

const BUSY_LOOPS = new Set<BotOrbMotion>(['thinking', 'working', 'searching', 'writing', 'sending'])

export function isBotOrbMotion(value: unknown): value is BotOrbMotion {
  return (
    typeof value === 'string' &&
    ((BOT_ORB_LOOPS as readonly string[]).includes(value) || (BOT_ORB_ONE_SHOTS as readonly string[]).includes(value))
  )
}

export function isBotOrbOneShot(motion: BotOrbMotion): motion is BotOrbOneShot {
  return (BOT_ORB_ONE_SHOTS as readonly string[]).includes(motion)
}

export function isBotOrbBusyLoop(motion: BotOrbMotion): boolean {
  return BUSY_LOOPS.has(motion)
}

export const BOT_ORB_MS = {
  yes: 1300,
  no: 1350,
  alert: 1500,
  jump: 1300,
  done: 1600,
  leave: 1900,
  look: 580,
  settle: 1200,
} as const

export function oneShotDurationMs(motion: BotOrbOneShot): number {
  return BOT_ORB_MS[motion]
}

/**
 * Merge drives: one-shot wins, then explicit live motion, then presence working.
 */
export function resolveBotOrbDrive(parts: {
  oneShot?: BotOrbDrive | null
  live?: BotOrbMotion | null
  presence?: AgentPresenceStatus | null
}): BotOrbDrive {
  if (parts.oneShot && isBotOrbOneShot(parts.oneShot.motion)) {
    return { motion: parts.oneShot.motion, pulseId: parts.oneShot.pulseId ?? null }
  }
  if (parts.live && parts.live !== 'idle') {
    return { motion: parts.live }
  }
  if (parts.presence === 'working') return { motion: 'working' }
  return { motion: 'idle' }
}

export function presenceOrbMotion(status: AgentPresenceStatus | null | undefined): BotOrbMotion {
  // Error stays on the presence corner; face alert is a one-shot via errorOrbPulse.
  if (status === 'working') return 'working'
  return 'idle'
}

export function decisionOrbPulse(outcome: 'approved' | 'rejected' | string): BotOrbDrive {
  const ok = outcome === 'approved' || outcome === 'approve' || outcome === 'yes'
  return {
    motion: ok ? 'yes' : 'no',
    pulseId: `decision-${outcome}-${Date.now()}`,
  }
}

export function errorOrbPulse(id?: string): BotOrbDrive {
  return { motion: 'alert', pulseId: id ?? `alert-${Date.now()}` }
}

export function wakeOrbPulse(id?: string): BotOrbDrive {
  return { motion: 'jump', pulseId: id ?? `jump-${Date.now()}` }
}

/** The reaction the server named when a turn sealed (`agent.turn end.closing`). */
export function closingOrbPulse(closing: BotOrbMotion | null | undefined, streamId: string): BotOrbDrive | null {
  if (!closing || !isBotOrbOneShot(closing)) return null
  return { motion: closing, pulseId: `closing-${closing}-${streamId}` }
}
