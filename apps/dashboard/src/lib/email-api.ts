import { integrationsRoutes } from '../api/routes/integrations.routes'
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
} from './api'
import type { ConnectionStatus, OAuthProvider } from './email-oauth'

export type EmailConnection = {
  id: number
  provider: OAuthProvider
  mailboxEmail: string
  displayName: string
  status: ConnectionStatus
  lastSyncAt: string | null
  lastError: string | null
  signatureHtml: string | null
  /** When false, scheduled sync skips this mailbox. */
  isEnabled: boolean
  /** At most one per organisation should be primary. */
  isPrimary: boolean
  /** Initial backfill window in days; 0 = no limit. */
  syncWindowDays: number
}

export type RoutingRuleApi = {
  id: number
  mailbox_id: number
  priority: number
  condition_type: 'sender_domain' | 'subject_contains' | 'mailbox'
  condition_value: string
  assign_to_user_id: number | null
  labels: string[]
  is_active: boolean
  created_at: string
  updated_at: string
}

export type MailboxAiMode = 'suggest' | 'auto' | 'off'

/** '' = follow the workspace default; 'auto' mirrors the customer's language. */
export type MailboxReplyLanguage = '' | 'auto' | 'nl' | 'en' | 'de' | 'fr' | 'es'

export type AiInboxConfig = {
  /** Empty string = follow the workspace default for email. */
  mode: MailboxAiMode | ''
  /** Language for drafted replies; empty string = workspace default. */
  replyLanguage: MailboxReplyLanguage
}

export type KbCollection = {
  id: number
  name: string
  description: string | null
  document_count: number
  total_chunks: number
}

export type KbDocument = {
  id: number
  collection_id: number
  filename: string
  file_url: string
  file_type: 'pdf' | 'docx' | 'txt' | 'md' | 'csv'
  file_size_bytes: number
  index_status: 'queued' | 'indexing' | 'indexed' | 'error'
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** Microsoft authorize URLs must include a non-empty client_id; empty env yields login.live.com invalid_request. */
export function ensureOutlookAuthorizeUrlHasClientId(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid authorize URL received from the server.')
  }
  const host = parsed.hostname.toLowerCase()
  const isMicrosoft =
    host === 'login.microsoftonline.com' ||
    host.endsWith('.login.microsoftonline.com') ||
    host === 'login.live.com' ||
    host.endsWith('.login.live.com')
  if (!isMicrosoft) return

  const clientId = parsed.searchParams.get('client_id')
  if (!clientId?.trim()) {
    throw new Error(
      'Microsoft OAuth is missing a client_id in the authorize URL. Set MICROSOFT_CLIENT_ID (and the matching secret) in the API environment used by the integrations router that serves /email/oauth/start.',
    )
  }
}

function asNullableString(value: unknown): string | null {
  const text = asString(value)
  return text.length > 0 ? text : null
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * Normalize an API timestamp (returned as Unix ms number, seconds number, or
 * ISO string) into an ISO 8601 string. Returns null when it cannot be parsed.
 */
function asNullableTimestampString(value: unknown): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000
    const date = new Date(ms)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return null
}

function normalizeConnection(row: unknown): EmailConnection | null {
  if (!row || typeof row !== 'object') return null
  const raw = row as Record<string, unknown>
  const provider = asString(raw.provider).toLowerCase()
  if (provider !== 'outlook' && provider !== 'gmail') return null
  const id = asNumber(raw.id ?? raw.connection_pk, NaN)
  if (!Number.isFinite(id)) return null
  const statusValue = asString(raw.status).toLowerCase()
  const status: ConnectionStatus =
    statusValue === 'error'
      ? 'error'
      : statusValue === 'needs_auth'
        ? 'needs_auth'
        : statusValue === 'paused' || statusValue === 'revoked'
          ? statusValue === 'paused'
            ? 'paused'
            : 'revoked'
          : statusValue === 'connected' || statusValue === 'active'
            ? 'connected'
            : 'needs_auth'
  const rawEnabled = raw.is_enabled ?? raw.isEnabled
  const isEnabled = rawEnabled === false ? false : true
  const rawPrimary = raw.is_primary ?? raw.isPrimary
  const isPrimary = rawPrimary === true
  return {
    id,
    provider,
    mailboxEmail: asString(raw.mailbox_email ?? raw.mailboxEmail),
    displayName: asString(raw.display_name ?? raw.displayName, asString(raw.mailbox_email ?? raw.mailboxEmail)),
    status,
    lastSyncAt: asNullableTimestampString(raw.last_sync_at ?? raw.lastSyncAt),
    lastError: asNullableString(raw.last_error ?? raw.lastError),
    signatureHtml: asNullableString(raw.signature_html ?? raw.signatureHtml),
    isEnabled,
    isPrimary,
    syncWindowDays: asNumber(raw.sync_window_days ?? raw.syncWindowDays, 30),
  }
}

export async function listEmailConnections(token: string): Promise<EmailConnection[]> {
  const payload = await apiGet<unknown>(integrationsRoutes.email.connections.list, token)
  const source = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { items?: unknown[] }).items)
      ? (payload as { items: unknown[] }).items
      : []
  return source.map(normalizeConnection).filter((item): item is EmailConnection => item !== null)
}

export function buildEmailOAuthReturnUrl(): string {
  return `${window.location.origin}${window.location.pathname}`
}

export async function startOAuthConnection(
  token: string,
  provider: OAuthProvider,
  returnUrlOverride?: string,
): Promise<string> {
  const returnUrl = returnUrlOverride?.trim() || buildEmailOAuthReturnUrl()
  const encodedReturnUrl = encodeURIComponent(returnUrl)
  const genericPath = integrationsRoutes.email.oauth.start(provider, encodedReturnUrl)
  try {
    const payload = await apiGet<{ authorize_url?: string; authorizeUrl?: string }>(genericPath, token)
    const url = asString(payload.authorize_url ?? payload.authorizeUrl)
    if (!url.trim()) throw new Error('No authorize URL received from the server.')
    if (provider === 'outlook') ensureOutlookAuthorizeUrlHasClientId(url)
    return url
  } catch (error) {
    if (provider === 'outlook') {
      const payload = await apiGet<{ authorize_url?: string; authorizeUrl?: string }>(
        integrationsRoutes.email.oauth.outlookStart(encodedReturnUrl),
        token,
      )
      const url = asString(payload.authorize_url ?? payload.authorizeUrl)
      if (!url.trim()) throw new Error('No authorize URL received from the server.')
      ensureOutlookAuthorizeUrlHasClientId(url)
      return url
    }

    if (provider === 'gmail') {
      const payload = await apiGet<{ authorize_url?: string; authorizeUrl?: string }>(
        integrationsRoutes.email.oauth.googleStart(encodedReturnUrl),
        token,
      )
      const url = asString(payload.authorize_url ?? payload.authorizeUrl)
      if (!url.trim()) throw new Error('No authorize URL received from the server.')
      return url
    }

    throw error
  }
}

export async function disconnectEmailConnection(token: string, connectionId: number): Promise<void> {
  await apiDelete(integrationsRoutes.email.connections.byId(connectionId), token)
}

export async function syncMailboxes(token: string): Promise<{ synced: number }> {
  const payload = await apiPost<{ synced?: number }>(integrationsRoutes.email.sync, {}, token)
  return { synced: typeof payload.synced === 'number' ? payload.synced : 0 }
}

export async function updateMailboxSettings(
  token: string,
  connectionId: number,
  payload: { is_enabled?: boolean; is_primary?: boolean; sync_window_days?: number },
): Promise<void> {
  await apiPut(integrationsRoutes.email.connections.mailboxSettings(connectionId), payload, token)
}

export async function getConnectionSignature(token: string, connectionId: number): Promise<string> {
  const payload = await apiGet<{ signature_html?: string; signatureHtml?: string }>(
    integrationsRoutes.email.connections.signature(connectionId),
    token,
  )
  return asString(payload.signature_html ?? payload.signatureHtml)
}

export async function saveConnectionSignature(token: string, connectionId: number, signatureHtml: string): Promise<void> {
  await apiPut(integrationsRoutes.email.connections.signature(connectionId), { signature_html: signatureHtml }, token)
}

export async function listRoutingRules(token: string, mailboxId: number): Promise<RoutingRuleApi[]> {
  const payload = await apiGet<unknown>(integrationsRoutes.email.routingRules.withMailbox(mailboxId), token)
  const source = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { items?: unknown[] }).items)
      ? (payload as { items: unknown[] }).items
      : []
  return source
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const raw = row as Record<string, unknown>
      return {
        id: asNumber(raw.id),
        mailbox_id: asNumber(raw.mailbox_id),
        priority: asNumber(raw.priority, 100),
        condition_type: asString(raw.condition_type) as RoutingRuleApi['condition_type'],
        condition_value: asString(raw.condition_value),
        assign_to_user_id: raw.assign_to_user_id == null ? null : asNumber(raw.assign_to_user_id),
        labels: Array.isArray(raw.labels) ? raw.labels.filter((label): label is string => typeof label === 'string') : [],
        is_active: Boolean(raw.is_active),
        created_at: asString(raw.created_at),
        updated_at: asString(raw.updated_at),
      } satisfies RoutingRuleApi
    })
    .filter((item): item is RoutingRuleApi => item !== null)
}

export async function createRoutingRule(
  token: string,
  payload: Omit<RoutingRuleApi, 'id' | 'created_at' | 'updated_at'>,
): Promise<void> {
  await apiPost(integrationsRoutes.email.routingRules.base, payload, token)
}

export async function updateRoutingRule(
  token: string,
  ruleId: number,
  payload: Partial<Omit<RoutingRuleApi, 'id' | 'mailbox_id' | 'created_at' | 'updated_at'>>,
): Promise<void> {
  await apiPatch(integrationsRoutes.email.routingRules.byId(ruleId), payload, token)
}

export async function deleteRoutingRule(token: string, ruleId: number): Promise<void> {
  await apiDelete(integrationsRoutes.email.routingRules.byId(ruleId), token)
}

const MAILBOX_REPLY_LANGUAGES: MailboxReplyLanguage[] = ['auto', 'nl', 'en', 'de', 'fr', 'es']

export async function getAiConfig(token: string, connectionId: number): Promise<AiInboxConfig> {
  const payload = await apiGet<{ ai_config?: Record<string, unknown> }>(integrationsRoutes.email.connections.aiConfig(connectionId), token)
  const raw = payload.ai_config ?? {}
  const replyLanguage = MAILBOX_REPLY_LANGUAGES.includes(raw.reply_language as MailboxReplyLanguage)
    ? (raw.reply_language as MailboxReplyLanguage)
    : ''
  const mode = raw.mode
  if (mode === 'suggest' || mode === 'auto' || mode === 'off') {
    return { mode, replyLanguage }
  }
  // Legacy per-mailbox toggle written by the previous AI settings UI.
  if (raw.suggestions_enabled === false) {
    return { mode: 'off', replyLanguage }
  }
  return { mode: '', replyLanguage }
}

export async function saveAiConfig(token: string, connectionId: number, config: AiInboxConfig): Promise<void> {
  const aiConfig: Record<string, string> = {}
  if (config.mode) aiConfig.mode = config.mode
  if (config.replyLanguage) aiConfig.reply_language = config.replyLanguage
  await apiPut(integrationsRoutes.email.connections.aiConfig(connectionId), { ai_config: aiConfig }, token)
}

export async function listKbCollections(token: string): Promise<KbCollection[]> {
  const payload = await apiGet<unknown>(integrationsRoutes.kb.collections.list, token)
  const source = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { items?: unknown[] }).items)
      ? (payload as { items: unknown[] }).items
      : []
  return source
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const raw = row as Record<string, unknown>
      return {
        id: asNumber(raw.id),
        name: asString(raw.name),
        description: asNullableString(raw.description),
        document_count: asNumber(raw.document_count),
        total_chunks: asNumber(raw.total_chunks),
      } satisfies KbCollection
    })
    .filter((item): item is KbCollection => item !== null)
}

export async function createKbCollection(token: string, name: string, description?: string): Promise<void> {
  await apiPost(integrationsRoutes.kb.collections.create, { name, description }, token)
}

export async function listKbDocuments(token: string, collectionId: number): Promise<KbDocument[]> {
  const payload = await apiGet<unknown>(integrationsRoutes.kb.collections.documents(collectionId), token)
  const source = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { items?: unknown[] }).items)
      ? (payload as { items: unknown[] }).items
      : []
  return source
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const raw = row as Record<string, unknown>
      return {
        id: asNumber(raw.id),
        collection_id: asNumber(raw.collection_id),
        filename: asString(raw.filename),
        file_url: asString(raw.file_url),
        file_type: asString(raw.file_type) as KbDocument['file_type'],
        file_size_bytes: asNumber(raw.file_size_bytes),
        index_status: asString(raw.index_status) as KbDocument['index_status'],
      } satisfies KbDocument
    })
    .filter((item): item is KbDocument => item !== null)
}

export async function uploadKbDocument(
  token: string,
  collectionId: number,
  payload: { filename: string; file_url: string; file_type: KbDocument['file_type']; file_size_bytes?: number },
): Promise<void> {
  await apiPost(integrationsRoutes.kb.collections.documents(collectionId), payload, token)
}

export async function deleteKbDocument(token: string, documentId: number): Promise<void> {
  await apiDelete(integrationsRoutes.kb.documents.byId(documentId), token)
}

export async function searchKbContext(
  token: string,
  query: string,
  limit = 5,
): Promise<Array<{ id: number; filename: string; file_url: string }>> {
  const params = new URLSearchParams({ query, limit: String(limit) })
  const payload = await apiGet<unknown>(integrationsRoutes.kb.searchQuery(params), token)
  const source = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { items?: unknown[] }).items)
      ? (payload as { items: unknown[] }).items
      : []
  return source
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const raw = row as Record<string, unknown>
      return {
        id: asNumber(raw.id),
        filename: asString(raw.filename),
        file_url: asString(raw.file_url),
      }
    })
    .filter((item): item is { id: number; filename: string; file_url: string } => item !== null)
}
