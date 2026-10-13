import type { TFunction } from 'i18next'
import type { AgentPresenceStatus, PresenceStatus } from './teams-api'

/** People + agents + invites share this vocabulary for dots, badges and copy. */
export type PresenceKind = PresenceStatus | 'error' | 'deactivated'

export type PresenceBadgeVariant = 'success' | 'warning' | 'secondary' | 'ai' | 'error'

const DOT_CLASS: Record<PresenceKind, string> = {
  available: 'bg-status-success',
  away: 'bg-status-warning',
  offline: 'bg-text-muted/50',
  standby: 'presence-standby-dot',
  working: 'presence-working-dot',
  error: 'bg-status-error',
  deactivated: 'bg-text-muted/50',
}

const BADGE_VARIANT: Record<PresenceKind, PresenceBadgeVariant> = {
  available: 'success',
  away: 'warning',
  offline: 'secondary',
  standby: 'ai',
  working: 'ai',
  error: 'error',
  deactivated: 'secondary',
}

const TEXT_CLASS: Record<PresenceKind, string> = {
  available: 'text-status-success',
  away: 'text-status-warning',
  offline: 'text-text-muted',
  standby: 'text-ai-ink',
  working: 'text-ai-ink',
  error: 'text-status-error',
  deactivated: 'text-text-muted',
}

/** Account menu: this tab is open, so the operator is not offline. */
export function selfVisiblePresence(
  status: 'available' | 'away' | 'offline' | undefined,
): 'available' | 'away' {
  return status === 'away' ? 'away' : 'available'
}

/** Live socket for this user beats a stale REST offline seed. */
export function overlaySelfPresence(
  userId: string | undefined,
  status: 'available' | 'away' | 'offline',
  selfId: string | null,
  selfLive: boolean,
): 'available' | 'away' | 'offline' {
  if (status === 'offline' && selfLive && userId && selfId && userId === selfId) {
    return 'available'
  }
  return status
}

export function asPresenceKind(value: string | null | undefined): PresenceKind {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
  if (
    raw === 'available' ||
    raw === 'away' ||
    raw === 'offline' ||
    raw === 'standby' ||
    raw === 'working' ||
    raw === 'error' ||
    raw === 'deactivated'
  ) {
    return raw
  }
  return 'offline'
}

export function presenceDotClass(status: string | null | undefined): string {
  return DOT_CLASS[asPresenceKind(status)]
}

export function presenceBadgeVariant(status: string | null | undefined): PresenceBadgeVariant {
  return BADGE_VARIANT[asPresenceKind(status)]
}

export function presenceTextClass(status: string | null | undefined): string {
  return TEXT_CLASS[asPresenceKind(status)]
}

export function presenceLabel(status: string | null | undefined, t: TFunction): string {
  const kind = asPresenceKind(status)
  return t(`presence.${kind}`, { ns: 'common' })
}

export function agentPresenceLabel(status: AgentPresenceStatus, t: TFunction): string {
  return presenceLabel(status, t)
}

/** Agent vocabulary is `standby | working | error`; anything else reads as standby. */
export function asAgentStatus(value: unknown): AgentPresenceStatus {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
  if (raw === 'working' || raw === 'error') return raw
  return 'standby'
}

/** Live status of an agent row: an open activity always reads as working. */
export function agentStatusOf(agent: {
  status?: string | null
  current_activity_id?: string | null
}): AgentPresenceStatus {
  if (agent.current_activity_id) return 'working'
  return asAgentStatus(agent.status)
}
