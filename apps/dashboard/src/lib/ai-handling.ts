import { Hand, PenLine, Zap, type LucideIcon } from 'lucide-react'

/**
 * AI handling: one setting with three modes, resolved over four layers
 * (workspace, channel, contact, conversation). The most specific layer wins;
 * Govern, privacy and the channel breaker cap the result.
 *
 * Autonomous and assisted are AI work and render violet; manual renders gray.
 */
export type AiHandlingMode = 'autonomous' | 'assisted' | 'manual'
export type AiHandlingScope = 'workspace' | 'channel' | 'contact' | 'conversation'

export const AI_HANDLING_MODES: readonly AiHandlingMode[] = ['autonomous', 'assisted', 'manual']

type ModeMeta = {
  icon: LucideIcon
  tone: 'ai' | 'muted'
  /** Icon colour. */
  iconClass: string
  /** Small pill / selected-card surface. */
  surfaceClass: string
}

export const AI_HANDLING_META: Record<AiHandlingMode, ModeMeta> = {
  autonomous: {
    icon: Zap,
    tone: 'ai',
    iconClass: 'text-ai-ink',
    surfaceClass: 'border-ai/30 bg-ai/10 text-ai-ink',
  },
  assisted: {
    icon: PenLine,
    tone: 'ai',
    iconClass: 'text-ai-ink',
    surfaceClass: 'border-ai/30 bg-ai/10 text-ai-ink',
  },
  manual: {
    icon: Hand,
    tone: 'muted',
    iconClass: 'text-text-muted',
    surfaceClass: 'border-border bg-bg-elevated text-text-secondary',
  },
}

/** Channels where AI handling means something (the header picker hides elsewhere). */
export const AI_HANDLING_CHANNELS = new Set([
  'email',
  'widget',
  'chat',
  'whatsapp',
  'webchat',
  'livechat',
  'sms',
  'telegram',
  'slack',
])

export type AiHandling = {
  effective: AiHandlingMode
  requested: AiHandlingMode
  /** Layer the requested value comes from. */
  source: AiHandlingScope | 'default'
  sourceLabel: string
  ceiling: AiHandlingMode
  /** Why effective is below requested: govern | privacy | breaker. */
  clampedBy: 'govern' | 'privacy' | 'breaker' | null
  /** Conversation reason: assigned | operator_takeover | handoff_requested | escalated | operator. */
  reason: string | null
  /** Conversation override; cleared when the conversation closes. */
  untilClose: boolean
  /** What this layer follows without its own value. */
  inherited: AiHandlingMode
  inheritedSource: AiHandlingScope | 'default'
  inheritedSourceLabel: string
  /** This layer's own value, or null when it follows the layer above. */
  own: AiHandlingMode | null
  /** Channel scope only. */
  breakerTrippedAt?: string | null
}

export function normalizeMode(value: unknown): AiHandlingMode | null {
  if (value && typeof value === 'object' && 'mode' in value) {
    return normalizeMode((value as { mode?: unknown }).mode)
  }
  return value === 'autonomous' || value === 'assisted' || value === 'manual' ? value : null
}

const SCOPES = new Set(['workspace', 'channel', 'contact', 'conversation', 'default'])

function asScope(value: unknown, fallback: AiHandling['source']): AiHandling['source'] {
  return typeof value === 'string' && SCOPES.has(value) ? (value as AiHandling['source']) : fallback
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function normalizeAiHandling(raw: unknown): AiHandling | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const effective = normalizeMode(row.effective)
  if (!effective) return null
  const clamped = row.clamped_by
  return {
    effective,
    requested: normalizeMode(row.requested) ?? effective,
    source: asScope(row.source, 'workspace'),
    sourceLabel: asText(row.source_label),
    ceiling: normalizeMode(row.ceiling) ?? 'autonomous',
    clampedBy: clamped === 'govern' || clamped === 'privacy' || clamped === 'breaker' ? clamped : null,
    reason: asText(row.reason) || null,
    untilClose: Boolean(row.until_close),
    inherited: normalizeMode(row.inherited) ?? effective,
    inheritedSource: asScope(row.inherited_source, 'workspace'),
    inheritedSourceLabel: asText(row.inherited_source_label),
    own: normalizeMode(row.own),
    breakerTrippedAt: asText(row.breaker_tripped_at) || null,
  }
}

const RANK: Record<AiHandlingMode, number> = { manual: 0, assisted: 1, autonomous: 2 }

export function minMode(a: AiHandlingMode, b: AiHandlingMode): AiHandlingMode {
  return RANK[a] <= RANK[b] ? a : b
}

/**
 * Mirrors the API rule: lowering is free; autonomous needs owner/admin,
 * except on a conversation whose channel already resolves to autonomous.
 */
export function canSetMode(
  canRaise: boolean,
  scope: AiHandlingScope,
  mode: AiHandlingMode | null,
  inheritedEffective?: AiHandlingMode | null,
): boolean {
  if (canRaise) return true
  if (mode !== 'autonomous') return scope !== 'workspace' || mode === null
  return scope === 'conversation' && inheritedEffective === 'autonomous'
}

/** True when this layer carries its own value (an override worth showing in lists). */
export function hasOverride(handling: AiHandling | null | undefined): boolean {
  return Boolean(handling && handling.own)
}

/** Effective mode as the inherited value would resolve, capped by the ceiling. */
export function inheritedEffective(handling: AiHandling): AiHandlingMode {
  return minMode(handling.inherited, handling.ceiling)
}
