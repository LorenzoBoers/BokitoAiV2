import type { BadgeTone } from '../components/ui/badge'

/**
 * Domain value -> Badge tone. Pages map their own statuses here instead of
 * writing color classes, so one status reads the same everywhere.
 */

export function statusTone(status: string | null | undefined): BadgeTone {
  const raw = String(status ?? '').trim().toLowerCase()
  switch (raw) {
    case 'active':
    case 'enabled':
    case 'connected':
    case 'healthy':
    case 'live':
    case 'ok':
    case 'success':
    case 'succeeded':
    case 'completed':
    case 'done':
    case 'approved':
    case 'resolved':
    case 'verified':
    case 'published':
    case 'available':
      return 'success'
    case 'pending':
    case 'paused':
    case 'draft':
    case 'warning':
    case 'degraded':
    case 'expiring':
    case 'review':
    case 'needs_review':
    case 'waiting':
    case 'away':
    case 'invited':
      return 'warning'
    case 'error':
    case 'failed':
    case 'failure':
    case 'blocked':
    case 'rejected':
    case 'revoked':
    case 'expired':
    case 'disconnected':
    case 'suspended':
      return 'error'
    case 'running':
    case 'working':
    case 'in_progress':
    case 'processing':
    case 'syncing':
    case 'new':
      return 'info'
    case 'standby':
    case 'agent':
    case 'ai':
      return 'ai'
    default:
      return 'neutral'
  }
}

/** Workspace roles: owner stands out, admin is accent, the rest neutral. */
export function roleTone(role: string | null | undefined): BadgeTone {
  const raw = String(role ?? '').trim().toLowerCase()
  if (raw === 'owner') return 'accent'
  if (raw === 'admin') return 'info'
  return 'neutral'
}

/** Member type: people neutral, agents violet. */
export function memberTypeTone(kind: 'human' | 'agent' | string | null | undefined): BadgeTone {
  return kind === 'agent' ? 'ai' : 'neutral'
}

/** 0..1 usage ratio -> tone for caps and quotas. */
export function ratioTone(ratio: number, exceeded = false): BadgeTone {
  if (exceeded || ratio >= 1) return 'error'
  if (ratio >= 0.8) return 'warning'
  return 'accent'
}
