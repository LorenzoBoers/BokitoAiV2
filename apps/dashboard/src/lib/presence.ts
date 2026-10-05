import type { TFunction } from 'i18next'
import type { AgentPresenceStatus, PresenceStatus } from './teams-api'

/** People + agents + invites share this vocabulary for dots, badges and copy. */
export type PresenceKind = PresenceStatus | 'error' | 'deactivated'

export type PresenceBadgeVariant = 'success' | 'warning' | 'secondary' | 'ai' | 'error'

const DOT_CLASS: Record<PresenceKind, string> = {
  available: 'bg-status-success',
  away: 'bg-status-warning',
  offline: 'bg-text-muted/50',
  standby: 'bg-ai',
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
