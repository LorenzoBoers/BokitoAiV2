/**
 * Bot-orb motion model — timings stolen from apps/dashboard/docs/references/ai-robo.lottie
 * (markers @ 60fps). SVG BotOrbAvatar implements these; the Lottie is reference only.
 *
 * Markers: idle 0–29, yes 31–105, no 106–180, alert 181–270, thinking 271–390, jump 391–479.
 */

import type { AgentPresenceStatus } from './teams-api'

/** Face / chrome mood for the bot orb. */
export type BotOrbMotion =
  | 'idle'
  | 'thinking'
  | 'typing'
  | 'working'
  | 'yes'
  | 'no'
  | 'alert'
  | 'jump'

export type BotOrbDrive = {
  motion: BotOrbMotion
  /** Change this to replay a one-shot even when motion is unchanged. */
  pulseId?: string | null
}

export const BOT_ORB_ONE_SHOTS = ['yes', 'no', 'alert', 'jump'] as const
export type BotOrbOneShot = (typeof BOT_ORB_ONE_SHOTS)[number]

export function isBotOrbOneShot(motion: BotOrbMotion): motion is BotOrbOneShot {
  return (BOT_ORB_ONE_SHOTS as readonly string[]).includes(motion)
}

export function isBotOrbBusyLoop(motion: BotOrbMotion): boolean {
  return motion === 'thinking' || motion === 'typing' || motion === 'working'
}

/** Frames @ 60fps → ms (from Lottie markers). */
const FRAME_MS = 1000 / 60

export const BOT_ORB_MS = {
  /** idle segment length (~29f) — breathe cycle half-period uses this. */
  idleLoop: Math.round(29 * FRAME_MS),
  yes: Math.round(74 * FRAME_MS),
  no: Math.round(74 * FRAME_MS),
  alert: Math.round(89 * FRAME_MS),
  thinkingSegment: Math.round(119 * FRAME_MS),
  jump: Math.round(88 * FRAME_MS),
  look: 580,
  thinkSway: 700,
  settle: 1200,
  track: 90,
  typeBob: 420,
} as const

export function oneShotDurationMs(motion: BotOrbOneShot): number {
  switch (motion) {
    case 'yes':
      return BOT_ORB_MS.yes
    case 'no':
      return BOT_ORB_MS.no
    case 'alert':
      return BOT_ORB_MS.alert
    case 'jump':
      return BOT_ORB_MS.jump
  }
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
