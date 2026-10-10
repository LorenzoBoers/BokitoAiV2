import { aiHandlingRoutes } from '../api/routes/aiHandling.routes'
import { apiGet, apiPost, apiPut } from './api'
import {
  normalizeAiHandling,
  normalizeMode,
  type AiHandling,
  type AiHandlingMode,
  type AiHandlingScope,
} from './ai-handling'

export type AiHandlingSafeguards = { certaintyThreshold: number; newContacts: boolean }
export type AiHandlingBreaker = {
  enabled: boolean
  maxAutonomousPerHour: number
  maxNegativePerHour: number
}
export type AiHandlingDisclosure = { enabled: boolean; text: string }

export type AfterHumanReply = 'return_to_agent' | 'keep_with_human' | 'ask'
export type ReopenOwner = 'same_owner' | 'route_again'
export const AFTER_HUMAN_REPLY_OPTIONS: AfterHumanReply[] = ['return_to_agent', 'keep_with_human', 'ask']
export const REOPEN_OWNER_OPTIONS: ReopenOwner[] = ['same_owner', 'route_again']

/** Routing policy values (workspace defaults; channels override per key). */
export type RoutingPolicy = {
  afterHumanReply: AfterHumanReply
  closeAfterAgentReply: boolean
  closeAfterHumanReply: boolean
  reopenOwner: ReopenOwner
}
export type RoutingKey = keyof RoutingPolicy

export type AiHandlingRouting = RoutingPolicy & {
  /** Agent <-> people handovers per conversation per day before people keep it; 0 = off. */
  bounceLimit: number
}

/** One channel's routing: effective values, its own overrides and the inherited defaults. */
export type ChannelRoutingPolicy = {
  effective: RoutingPolicy
  own: Partial<RoutingPolicy>
  inherited: RoutingPolicy
  source: Record<RoutingKey, 'workspace' | 'channel'>
  bounceLimit: number
}

export const DEFAULT_ROUTING_POLICY: RoutingPolicy = {
  afterHumanReply: 'return_to_agent',
  closeAfterAgentReply: false,
  closeAfterHumanReply: false,
  reopenOwner: 'same_owner',
}

export function normalizeAfterHumanReply(value: unknown): AfterHumanReply | null {
  return value === 'return_to_agent' || value === 'keep_with_human' || value === 'ask' ? value : null
}

export function normalizeReopenOwner(value: unknown): ReopenOwner | null {
  return value === 'same_owner' || value === 'route_again' ? value : null
}

function toRoutingPolicy(raw: Raw): RoutingPolicy {
  return {
    afterHumanReply: normalizeAfterHumanReply(raw.after_human_reply) ?? DEFAULT_ROUTING_POLICY.afterHumanReply,
    closeAfterAgentReply: raw.close_after_agent_reply === true,
    closeAfterHumanReply: raw.close_after_human_reply === true,
    reopenOwner: normalizeReopenOwner(raw.reopen_owner) ?? DEFAULT_ROUTING_POLICY.reopenOwner,
  }
}

function toPartialRoutingPolicy(raw: Raw): Partial<RoutingPolicy> {
  const out: Partial<RoutingPolicy> = {}
  const after = normalizeAfterHumanReply(raw.after_human_reply)
  if (after) out.afterHumanReply = after
  if (typeof raw.close_after_agent_reply === 'boolean') out.closeAfterAgentReply = raw.close_after_agent_reply
  if (typeof raw.close_after_human_reply === 'boolean') out.closeAfterHumanReply = raw.close_after_human_reply
  const reopen = normalizeReopenOwner(raw.reopen_owner)
  if (reopen) out.reopenOwner = reopen
  return out
}

const ROUTING_WIRE: Record<RoutingKey, string> = {
  afterHumanReply: 'after_human_reply',
  closeAfterAgentReply: 'close_after_agent_reply',
  closeAfterHumanReply: 'close_after_human_reply',
  reopenOwner: 'reopen_owner',
}

function routingToWire(policy: Partial<Record<RoutingKey, unknown>>): Raw {
  const body: Raw = {}
  for (const key of Object.keys(policy) as RoutingKey[]) {
    body[ROUTING_WIRE[key]] = policy[key]
  }
  return body
}

function toChannelRouting(raw: Raw): ChannelRoutingPolicy {
  const source = (raw.source ?? {}) as Raw
  const pick = (key: RoutingKey): 'workspace' | 'channel' =>
    source[ROUTING_WIRE[key]] === 'channel' ? 'channel' : 'workspace'
  return {
    effective: toRoutingPolicy((raw.effective ?? {}) as Raw),
    own: toPartialRoutingPolicy((raw.own ?? {}) as Raw),
    inherited: toRoutingPolicy((raw.inherited ?? {}) as Raw),
    source: {
      afterHumanReply: pick('afterHumanReply'),
      closeAfterAgentReply: pick('closeAfterAgentReply'),
      closeAfterHumanReply: pick('closeAfterHumanReply'),
      reopenOwner: pick('reopenOwner'),
    },
    bounceLimit: num(raw.bounce_limit, 3),
  }
}

export async function getChannelRouting(token: string, accountId: string): Promise<ChannelRoutingPolicy> {
  return toChannelRouting(await apiGet<Raw>(aiHandlingRoutes.channelRouting(accountId), token))
}

/** Override one or more keys on a channel; `null` follows the workspace default again. */
export async function setChannelRouting(
  token: string,
  accountId: string,
  patch: Partial<Record<RoutingKey, RoutingPolicy[RoutingKey] | null>>,
): Promise<ChannelRoutingPolicy> {
  return toChannelRouting(
    await apiPut<Raw>(aiHandlingRoutes.channelRouting(accountId), routingToWire(patch), token),
  )
}

export type AiHandlingException = {
  id: string
  label: string
  channel: string
  mode: AiHandlingMode | null
  address: string | null
  contactName: string | null
  reason: string | null
  breakerTrippedAt: string | null
}

export type AiHandlingOverview = {
  workspace: AiHandling
  ceiling: AiHandlingMode
  clampedBy: AiHandling['clampedBy']
  safeguards: AiHandlingSafeguards
  breaker: AiHandlingBreaker
  disclosure: AiHandlingDisclosure
  routing: AiHandlingRouting
  disclosurePreview: string | null
  exceptions: {
    channels: AiHandlingException[]
    contacts: AiHandlingException[]
    conversations: AiHandlingException[]
  }
  canRaise: boolean
}

export type AiHandlingPreview = {
  followers: number
  resulting: AiHandlingMode
  allowed: boolean
  evidence: {
    days: number
    drafts: number
    draftsResolved: number
    uneditedRate: number | null
    escalations: number
    escalationRate: number | null
    autonomousReplies: number
  }
}

type Raw = Record<string, unknown>

const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
const str = (value: unknown): string => (typeof value === 'string' ? value : '')

function toException(raw: Raw): AiHandlingException {
  return {
    id: str(raw.id),
    label: str(raw.label),
    channel: str(raw.channel),
    mode: normalizeMode(raw.mode),
    address: str(raw.address) || null,
    contactName: str(raw.contact_name) || null,
    reason: str(raw.reason) || null,
    breakerTrippedAt: str(raw.breaker_tripped_at) || null,
  }
}

function toOverview(raw: Raw): AiHandlingOverview {
  const safeguards = (raw.safeguards ?? {}) as Raw
  const breaker = (raw.breaker ?? {}) as Raw
  const disclosure = (raw.disclosure ?? {}) as Raw
  const exceptions = (raw.exceptions ?? {}) as Raw
  const list = (value: unknown) => (Array.isArray(value) ? value.map((row) => toException(row as Raw)) : [])
  const clamped = raw.clamped_by
  return {
    workspace: normalizeAiHandling(raw.workspace) as AiHandling,
    ceiling: normalizeMode(raw.ceiling) ?? 'autonomous',
    clampedBy: clamped === 'govern' || clamped === 'privacy' || clamped === 'breaker' || clamped === 'agent'
        ? clamped
        : null,
    safeguards: {
      certaintyThreshold: num(safeguards.certainty_threshold, 7),
      newContacts: safeguards.new_contacts !== false,
    },
    breaker: {
      enabled: breaker.enabled !== false,
      maxAutonomousPerHour: num(breaker.max_autonomous_per_hour, 30),
      maxNegativePerHour: num(breaker.max_negative_per_hour, 3),
    },
    disclosure: { enabled: disclosure.enabled !== false, text: str(disclosure.text) },
    routing: {
      ...toRoutingPolicy((raw.routing ?? {}) as Raw),
      bounceLimit: num(((raw.routing ?? {}) as Raw).bounce_limit, 3),
    },
    disclosurePreview: str(raw.disclosure_preview) || null,
    exceptions: {
      channels: list(exceptions.channels),
      contacts: list(exceptions.contacts),
      conversations: list(exceptions.conversations),
    },
    canRaise: Boolean(raw.can_raise),
  }
}

export async function getAiHandlingOverview(token: string): Promise<AiHandlingOverview> {
  return toOverview(await apiGet<Raw>(aiHandlingRoutes.overview, token))
}

export async function saveAiHandlingSettings(
  token: string,
  patch: {
    safeguards?: AiHandlingSafeguards
    breaker?: AiHandlingBreaker
    disclosure?: AiHandlingDisclosure
    routing?: AiHandlingRouting
  },
): Promise<AiHandlingOverview> {
  const body: Raw = {}
  if (patch.routing) {
    body.routing = {
      ...routingToWire({
        afterHumanReply: patch.routing.afterHumanReply,
        closeAfterAgentReply: patch.routing.closeAfterAgentReply,
        closeAfterHumanReply: patch.routing.closeAfterHumanReply,
        reopenOwner: patch.routing.reopenOwner,
      }),
      bounce_limit: patch.routing.bounceLimit,
    }
  }
  if (patch.safeguards) {
    body.safeguards = {
      certainty_threshold: patch.safeguards.certaintyThreshold,
      new_contacts: patch.safeguards.newContacts,
    }
  }
  if (patch.breaker) {
    body.breaker = {
      enabled: patch.breaker.enabled,
      max_autonomous_per_hour: patch.breaker.maxAutonomousPerHour,
      max_negative_per_hour: patch.breaker.maxNegativePerHour,
    }
  }
  if (patch.disclosure) body.disclosure = patch.disclosure
  return toOverview(await apiPut<Raw>(aiHandlingRoutes.settings, body, token))
}

/** Workspace scope ignores ``targetId``; pass any value (e.g. ``"current"``). */
export async function getAiHandling(
  token: string,
  scope: AiHandlingScope,
  targetId: string,
): Promise<AiHandling | null> {
  return normalizeAiHandling(await apiGet<Raw>(aiHandlingRoutes.target(scope, targetId), token))
}

/**
 * Set one layer, or clear it with ``mode: null``. Take over is conversation +
 * manual + ``assignToMe``; hand back is conversation + ``null``.
 */
export async function setAiHandling(
  token: string,
  scope: AiHandlingScope,
  targetId: string,
  mode: AiHandlingMode | null,
  opts: { reason?: string; assignToMe?: boolean } = {},
): Promise<AiHandling | null> {
  const payload = await apiPut<Raw>(
    aiHandlingRoutes.target(scope, targetId),
    { mode, reason: opts.reason ?? null, assign_to_me: Boolean(opts.assignToMe) },
    token,
  )
  return normalizeAiHandling(payload)
}

export async function previewAiHandling(
  token: string,
  scope: AiHandlingScope,
  targetId: string,
  mode: AiHandlingMode | null,
): Promise<AiHandlingPreview> {
  const raw = await apiGet<Raw>(aiHandlingRoutes.preview(scope, targetId, mode), token)
  const ev = (raw.evidence ?? {}) as Raw
  return {
    followers: num(raw.followers),
    resulting: normalizeMode(raw.resulting) ?? 'manual',
    allowed: Boolean(raw.allowed),
    evidence: {
      days: num(ev.days, 30),
      drafts: num(ev.drafts),
      draftsResolved: num(ev.drafts_resolved),
      uneditedRate: typeof ev.unedited_rate === 'number' ? ev.unedited_rate : null,
      escalations: num(ev.escalations),
      escalationRate: typeof ev.escalation_rate === 'number' ? ev.escalation_rate : null,
      autonomousReplies: num(ev.autonomous_replies),
    },
  }
}

export type AiHandlingMetrics = {
  days: number
  openByMode: Record<AiHandlingMode, number>
  openTotal: number
  autonomousReplies: number
  handoffs: number
  handoffRate: number | null
  assistedEditRate: number | null
  draftsResolved: number
}

export async function getAiHandlingMetrics(token: string, days = 30): Promise<AiHandlingMetrics> {
  const raw = await apiGet<Raw>(aiHandlingRoutes.metrics(days), token)
  const open = (raw.open_by_mode ?? {}) as Raw
  const rate = (value: unknown) => (typeof value === 'number' ? value : null)
  return {
    days: num(raw.days, days),
    openByMode: { autonomous: num(open.autonomous), assisted: num(open.assisted), manual: num(open.manual) },
    openTotal: num(raw.open_total),
    autonomousReplies: num(raw.autonomous_replies),
    handoffs: num(raw.handoffs),
    handoffRate: rate(raw.handoff_rate),
    assistedEditRate: rate(raw.assisted_edit_rate),
    draftsResolved: num(raw.drafts_resolved),
  }
}

export async function resetAiBreaker(
  token: string,
  accountId: string,
  keepAssisted = false,
): Promise<AiHandling | null> {
  return normalizeAiHandling(
    await apiPost<Raw>(aiHandlingRoutes.resetBreaker(accountId, keepAssisted), {}, token),
  )
}
