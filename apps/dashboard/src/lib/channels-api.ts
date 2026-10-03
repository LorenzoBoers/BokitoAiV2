/** Uniform channel rows: one shape for mailboxes, relays, widget, WhatsApp, Slack. */

import { appRoutes } from '../api/routes/app.routes'
import { apiDelete, apiGet, apiPatch, apiPost } from './api'
import { normalizeAccess, type ChannelAccess } from './channel-accounts-api'
import { normalizeAiHandling, type AiHandling } from './ai-handling'

export const CHANNEL_STATES = [
  'setup_required',
  'connecting',
  'active',
  'degraded',
  'action_required',
  'paused',
  'error',
] as const
export type ChannelState = (typeof CHANNEL_STATES)[number]

export type ChannelCheckState = 'ok' | 'warn' | 'fail' | 'pending' | 'na'
export type ChannelCapability = 'receive' | 'send' | 'sync'
export type ChannelKind =
  | 'email_mailbox'
  | 'email_relay'
  | 'widget'
  | 'whatsapp'
  | 'slack'
  | string

export type ChannelCheck = {
  id: string
  state: ChannelCheckState
  detail: string
  action: string
}

export type ChannelRow = {
  id: string
  channel: string
  kind: ChannelKind
  provider: string
  address: string
  displayName: string
  label: string
  isEnabled: boolean
  isPrimary: boolean
  state: ChannelState
  /** Check id that explains the state, empty when everything is fine. */
  stateReason: string
  capabilities: ChannelCapability[]
  checks: ChannelCheck[]
  actions: string[]
  configureHref: string
  lastEventAt: string | null
  lastSyncAt: string | null
  lastError: string
  /** AI handling at channel scope; ``breakerTrippedAt`` set while autonomous is paused. */
  aiHandling: AiHandling | null
  access: ChannelAccess
  /** Team that owns new conversations; null means All people. */
  defaultTeamId: string | null
  defaultAgentId: string | null
  createdAt: string
  /** Initial backfill window in days for sync channels; 0 = everything. */
  syncWindowDays: number
}

export type RelayOptions = {
  domain: string
  workspaceSlug: string
  maxRelays: number
  used: number
  reservedPrefixes: string[]
  relays: ChannelRow[]
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function normalizeCheck(raw: unknown): ChannelCheck | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const id = asString(value.id)
  if (!id) return null
  return {
    id,
    state: (asString(value.state, 'na') as ChannelCheckState) || 'na',
    detail: asString(value.detail),
    action: asString(value.action),
  }
}

export function normalizeChannelRow(raw: unknown): ChannelRow | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const id = asString(value.id)
  if (!id) return null
  return {
    id,
    channel: asString(value.channel),
    kind: asString(value.kind),
    provider: asString(value.provider),
    address: asString(value.address),
    displayName: asString(value.display_name),
    label: asString(value.label) || asString(value.display_name) || asString(value.address),
    isEnabled: value.is_enabled !== false,
    isPrimary: value.is_primary === true,
    state: (asString(value.state, 'active') as ChannelState) || 'active',
    stateReason: asString(value.state_reason),
    capabilities: asStringList(value.capabilities) as ChannelCapability[],
    checks: Array.isArray(value.checks)
      ? value.checks.map(normalizeCheck).filter((c): c is ChannelCheck => c !== null)
      : [],
    actions: asStringList(value.actions),
    configureHref: asString(value.configure_href),
    lastEventAt: asString(value.last_event_at) || null,
    lastSyncAt: asString(value.last_sync_at) || null,
    lastError: asString(value.last_error),
    aiHandling: normalizeAiHandling(value.ai_handling),
    access: normalizeAccess(value.access, value.access_is_default),
    defaultTeamId: asString(value.default_team_id) || null,
    defaultAgentId: asString(value.default_agent_id) || null,
    createdAt: asString(value.created_at),
    syncWindowDays:
      typeof value.sync_window_days === 'number' ? value.sync_window_days : 30,
  }
}

export async function listChannels(token: string): Promise<ChannelRow[]> {
  const data = await apiGet<{ channels?: unknown[] }>(appRoutes.channels.list, token)
  const rows = Array.isArray(data.channels) ? data.channels : []
  return rows.map(normalizeChannelRow).filter((r): r is ChannelRow => r !== null)
}

export async function patchChannel(
  token: string,
  channelId: string,
  payload: {
    label?: string
    is_enabled?: boolean
    is_primary?: boolean
    sync_window_days?: number
  },
): Promise<ChannelRow | null> {
  const raw = await apiPatch<Record<string, unknown>>(
    appRoutes.channels.byId(channelId),
    payload,
    token,
  )
  return normalizeChannelRow(raw)
}

export async function syncChannel(
  token: string,
  channelId: string,
): Promise<{ channel: ChannelRow | null; synced: number }> {
  const raw = await apiPost<Record<string, unknown>>(
    appRoutes.channels.sync(channelId),
    {},
    token,
  )
  return {
    channel: normalizeChannelRow(raw.channel),
    synced: typeof raw.synced === 'number' ? raw.synced : 0,
  }
}

export async function deleteChannel(token: string, channelId: string): Promise<void> {
  await apiDelete(appRoutes.channels.byId(channelId), token)
}

export async function getRelayOptions(token: string): Promise<RelayOptions> {
  const raw = await apiGet<Record<string, unknown>>(appRoutes.channels.emailRelays, token)
  return {
    domain: asString(raw.domain),
    workspaceSlug: asString(raw.workspace_slug),
    maxRelays: typeof raw.max_relays === 'number' ? raw.max_relays : 3,
    used: typeof raw.used === 'number' ? raw.used : 0,
    reservedPrefixes: asStringList(raw.reserved_prefixes),
    relays: Array.isArray(raw.relays)
      ? raw.relays.map(normalizeChannelRow).filter((r): r is ChannelRow => r !== null)
      : [],
  }
}

export async function createEmailRelay(
  token: string,
  payload: { prefix: string; label?: string },
): Promise<ChannelRow | null> {
  const raw = await apiPost<Record<string, unknown>>(
    appRoutes.channels.emailRelays,
    { prefix: payload.prefix, label: payload.label ?? '' },
    token,
  )
  return normalizeChannelRow(raw)
}

/** Same slug rules as the server, so the dialog can preview the address live. */
export function normalizeRelayPrefix(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/^-+|-+$/g, '')
}

export function buildRelayAddress(prefix: string, workspaceSlug: string, domain: string): string {
  const clean = normalizeRelayPrefix(prefix)
  if (!clean) return ''
  return `${clean}-${workspaceSlug}@${domain}`
}

/** A channel may deliver outbound messages when it can send and is not broken. */
export function channelCanSend(row: ChannelRow): boolean {
  if (!row.capabilities.includes('send')) return false
  return row.state === 'active' || row.state === 'degraded' || row.state === 'connecting'
}

export type ChannelStatusSummary = 'ready' | 'setup' | 'action' | 'paused' | 'broken'

export type ChannelStatusRow = {
  id: string
  kind: string
  channel: string
  provider: string
  address: string
  displayName: string
  isEnabled: boolean
  state: string
  stateReason: string
  canSend: boolean
  canReceive: boolean
  summary: ChannelStatusSummary
}

export type ChannelStatusSnapshot = {
  channels: ChannelStatusRow[]
  readyCount: number
  emailReady: boolean
  sendReady: boolean
}

function normalizeStatusSummary(value: unknown): ChannelStatusSummary {
  const s = asString(value)
  if (s === 'ready' || s === 'setup' || s === 'action' || s === 'paused' || s === 'broken') {
    return s
  }
  return 'setup'
}

function normalizeStatusRow(raw: unknown): ChannelStatusRow | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const id = asString(value.id)
  if (!id) return null
  return {
    id,
    kind: asString(value.kind),
    channel: asString(value.channel),
    provider: asString(value.provider),
    address: asString(value.address),
    displayName: asString(value.display_name, asString(value.address)),
    isEnabled: value.is_enabled !== false,
    state: asString(value.state, 'setup_required'),
    stateReason: asString(value.state_reason),
    canSend: value.can_send === true,
    canReceive: value.can_receive === true,
    summary: normalizeStatusSummary(value.summary),
  }
}

/** Setup / Connections / composer — same ChannelStatus truth as Kanalen. */
export async function getChannelStatus(token: string): Promise<ChannelStatusSnapshot> {
  const data = await apiGet<{
    channels?: unknown[]
    ready_count?: number
    email_ready?: boolean
    send_ready?: boolean
  }>(appRoutes.channels.status, token)
  const channels = Array.isArray(data.channels)
    ? data.channels.map(normalizeStatusRow).filter((r): r is ChannelStatusRow => r !== null)
    : []
  return {
    channels,
    readyCount: typeof data.ready_count === 'number' ? data.ready_count : channels.filter((c) => c.summary === 'ready').length,
    emailReady: data.email_ready === true,
    sendReady: data.send_ready === true,
  }
}
