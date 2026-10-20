import { Hand, type LucideIcon, type LucideProps } from 'lucide-react'
import type { ComponentType } from 'react'
import { AssistedModeIcon, AutonomousModeIcon } from './ai-handling-icons'

/**
 * AI handling: one setting with three modes, resolved over three layers
 * (workspace, channel, conversation). The most specific layer wins; the
 * Autonomy dial, privacy, the channel breaker, the agent and a flow set to
 * Always review cap the result.
 *
 * Autonomous and assisted are AI work and render violet; manual uses the
 * paper surface (card fill), not a heavy grey slab.
 * Icons: Autonomous = A in circular arrows (violet); Assisted = grey+violet
 * handshake; Manual = Hand on surface.
 */
export type AiHandlingMode = 'autonomous' | 'assisted' | 'manual'
export type AiHandlingScope = 'workspace' | 'channel' | 'conversation'
export type AiHandlingClamp = 'govern' | 'privacy' | 'breaker' | 'agent' | 'flow'
export type AiHandlingLayer = { source: AiHandlingScope; label: string; mode: AiHandlingMode | null }
export type AiHandlingCap = { cap: AiHandlingMode; reason: AiHandlingClamp }

export const AI_HANDLING_MODES: readonly AiHandlingMode[] = ['autonomous', 'assisted', 'manual']

type ModeMeta = {
  icon: LucideIcon | ComponentType<LucideProps>
  tone: 'ai' | 'muted'
  /** Icon colour (assisted paints both tones itself). */
  iconClass: string
  /** Small pill / selected-card surface. */
  surfaceClass: string
}

export const AI_HANDLING_META: Record<AiHandlingMode, ModeMeta> = {
  autonomous: {
    icon: AutonomousModeIcon,
    tone: 'ai',
    iconClass: 'text-ai-ink',
    surfaceClass: 'border-ai/30 bg-ai/10 text-ai-ink',
  },
  assisted: {
    icon: AssistedModeIcon,
    tone: 'ai',
    // Dual-tone handshake: leave empty so grey + violet paths both show.
    iconClass: '',
    surfaceClass: 'border-ai/30 bg-ai/10 text-ai-ink',
  },
  manual: {
    icon: Hand,
    tone: 'muted',
    iconClass: 'text-text-secondary',
    // Same paper as cards — hairline only, no grey elevated fill.
    surfaceClass: 'border-border/50 bg-bg-surface text-text-secondary',
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
  /** Why effective is below requested. */
  clampedBy: AiHandlingClamp | null
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
  /** Every layer that was read, most general first. */
  layers: AiHandlingLayer[]
  /** Every cap that applies; the lowest one wins. */
  ceilings: AiHandlingCap[]
  /** Channel scope only. */
  breakerTrippedAt?: string | null
  /** Assisted channels: how close unedited drafts are to an Autonomous proposal. */
  promotion?: {
    draftsResolved: number
    unedited: number
    targetDrafts: number
    targetRate: number
  } | null
}

export function normalizeMode(value: unknown): AiHandlingMode | null {
  if (value && typeof value === 'object' && 'mode' in value) {
    return normalizeMode((value as { mode?: unknown }).mode)
  }
  return value === 'autonomous' || value === 'assisted' || value === 'manual' ? value : null
}

const SCOPES = new Set(['workspace', 'channel', 'conversation', 'default'])
const CLAMPS = new Set<AiHandlingClamp>(['govern', 'privacy', 'breaker', 'agent', 'flow'])

export function normalizeClamp(value: unknown): AiHandlingClamp | null {
  return typeof value === 'string' && CLAMPS.has(value as AiHandlingClamp) ? (value as AiHandlingClamp) : null
}

function normalizeLayers(raw: unknown): AiHandlingLayer[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const row = (item ?? {}) as Record<string, unknown>
    const source = row.source
    if (source !== 'workspace' && source !== 'channel' && source !== 'conversation') return []
    return [{ source, label: asText(row.label), mode: normalizeMode(row.mode) }]
  })
}

function normalizeCaps(raw: unknown): AiHandlingCap[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const row = (item ?? {}) as Record<string, unknown>
    const cap = normalizeMode(row.cap)
    const reason = normalizeClamp(row.reason)
    return cap && reason ? [{ cap, reason }] : []
  })
}

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
  return {
    effective,
    requested: normalizeMode(row.requested) ?? effective,
    source: asScope(row.source, 'workspace'),
    sourceLabel: asText(row.source_label),
    ceiling: normalizeMode(row.ceiling) ?? 'autonomous',
    clampedBy: normalizeClamp(row.clamped_by),
    reason: asText(row.reason) || null,
    untilClose: Boolean(row.until_close),
    inherited: normalizeMode(row.inherited) ?? effective,
    inheritedSource: asScope(row.inherited_source, 'workspace'),
    inheritedSourceLabel: asText(row.inherited_source_label),
    own: normalizeMode(row.own),
    layers: normalizeLayers(row.layers),
    ceilings: normalizeCaps(row.ceilings),
    breakerTrippedAt: asText(row.breaker_tripped_at) || null,
    promotion: normalizePromotion(row.promotion),
  }
}

function normalizePromotion(raw: unknown): AiHandling['promotion'] {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const target = Number(row.target_drafts)
  if (!Number.isFinite(target) || target <= 0) return null
  return {
    draftsResolved: Number(row.drafts_resolved) || 0,
    unedited: Number(row.unedited) || 0,
    targetDrafts: target,
    targetRate: Number(row.target_rate) || 0.8,
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
