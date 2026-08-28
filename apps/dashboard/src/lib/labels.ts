import type { TFunction } from 'i18next'

/**
 * Shared humanizer for API enum/status strings shown in the UI.
 *
 * Backend enums are snake_case (`needs_auth`, `awaiting_decision`). Rendering
 * them raw reads as debug output; this converts them to sentence case with a
 * small override table for values whose natural label is not a mechanical
 * conversion. Use domain-specific label maps (e.g. `MAILBOX_STATUS_LABELS`)
 * where they exist; this is the fallback for everything else.
 */

const OVERRIDES: Record<string, string> = {
  needs_auth: 'Needs sign-in',
  token_expired: 'Sign-in expired',
  awaiting_decision: 'Awaiting decision',
  ai_paused: 'AI paused',
  ai_resumed: 'AI resumed',
  mock_skipped: 'Skipped (mock)',
  in_progress: 'In progress',
  not_indexed: 'Not indexed',
  needs_review: 'Needs review',
}

export function humanizeLabel(value: string | null | undefined): string {
  if (!value) return ''
  const key = String(value).trim().toLowerCase()
  if (OVERRIDES[key]) return OVERRIDES[key]
  const words = key.replace(/[_\-.:]+/g, ' ').trim()
  if (!words) return ''
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export const MEMBER_ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
}

export function memberRoleLabel(role: string | null | undefined): string {
  if (!role) return ''
  return MEMBER_ROLE_LABELS[role.toLowerCase()] ?? humanizeLabel(role)
}

/** Human label for agent passport autonomy_level (manual | approval | auto). */
export function agentAutonomyLevelLabel(level: string | null | undefined, t: TFunction): string {
  if (!level) {
    return t('workforce.agents.autonomyDefault', { ns: 'nav', defaultValue: 'Workspace default' })
  }
  const normalized = level.toLowerCase()
  if (normalized === 'manual') {
    return t('workforce.agents.autonomyManual', { ns: 'nav', defaultValue: 'Manual — always ask' })
  }
  if (normalized === 'approval') {
    return t('workforce.agents.autonomyApproval', { ns: 'nav', defaultValue: 'Approval — gated actions' })
  }
  if (normalized === 'auto') {
    return t('workforce.agents.autonomyAuto', { ns: 'nav', defaultValue: 'Auto — act independently' })
  }
  return humanizeLabel(level)
}
