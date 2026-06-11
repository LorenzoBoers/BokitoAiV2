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
}

export type EmailMessage = {
  id: number
  connectionId: number
  graphMessageId: string
  subject: string
  fromAddress: string
  receivedAt: string | null
  bodyPreview: string
  bodyHtml: string | null
  toAddresses: string | null
  cc: string | null
  bcc: string | null
  threadId: string | null
  inReplyTo: string | null
  isRead: boolean
  conversationStatus: 'open' | 'snoozed' | 'closed'
  snoozedUntil: string | null
  assignedToUserId: number | null
  labels: string[]
  aiSummary: string | null
  sentiment: 'positive' | 'neutral' | 'negative' | 'urgent' | null
  attachments: unknown[] | null
}

export type PagedResult<T> = {
  items: T[]
  page: number
  perPage: number
  total: number | null
}

export type MessageFilters = {
  connectionId: number
  page?: number
  perPage?: number
  search?: string
}

export type SendEmailInput = {
  connectionId: number
  toAddresses: string
  cc?: string
  bcc?: string
  subject: string
  bodyText: string
  bodyHtml?: string
  inReplyTo?: string
  threadId?: string
  attachments?: unknown[]
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

export type AiInboxConfig = {
  suggestions_enabled: boolean
  auto_reply_enabled: boolean
  auto_reply_threshold: number
  auto_label_enabled: boolean
  tone: 'formeel' | 'informeel' | 'match'
  language: 'nl' | 'en' | 'auto'
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

/** Microsoft authorize URLs must include a non-empty client_id; empty env on Xano yields login.live.com invalid_request. */
export function ensureOutlookAuthorizeUrlHasClientId(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Ongeldige authorize-URL ontvangen van de server.')
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
      'Microsoft OAuth mist client_id in de authorize-URL. Zet MICROSOFT_CLIENT_ID (en het juiste secret) in de Xano-omgeving voor de API-groep die /email/oauth/start uitvoert (doorgaans `api:integrations`), niet alleen voor `api:app`.',
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
 * Normalize a Xano timestamp (returned as Unix ms number, seconds number, or
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
    statusValue === 'error' ? 'error' : statusValue === 'revoked' ? 'revoked' : 'active'
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
  }
}

function normalizeMessage(row: unknown): EmailMessage | null {
  if (!row || typeof row !== 'object') return null
  const raw = row as Record<string, unknown>
  const id = asNumber(raw.id, NaN)
  if (!Number.isFinite(id)) return null
  const status = asString(raw.conversation_status ?? 'open')
  const sentimentValue = asString(raw.sentiment).toLowerCase()
  const sentiment =
    sentimentValue === 'positive' || sentimentValue === 'neutral' || sentimentValue === 'negative' || sentimentValue === 'urgent'
      ? sentimentValue
      : null
  return {
    id,
    connectionId: asNumber(raw.connection_id),
    graphMessageId: asString(raw.graph_message_id),
    subject: asString(raw.subject, '(No subject)'),
    fromAddress: asString(raw.from_address),
    receivedAt: asNullableString(raw.received_at),
    bodyPreview: asString(raw.body_preview),
    bodyHtml: asNullableString(raw.body_html),
    toAddresses: asNullableString(raw.to_addresses),
    cc: asNullableString(raw.cc),
    bcc: asNullableString(raw.bcc),
    threadId: asNullableString(raw.thread_id),
    inReplyTo: asNullableString(raw.in_reply_to),
    isRead: Boolean(raw.is_read),
    conversationStatus: status === 'snoozed' || status === 'closed' ? status : 'open',
    snoozedUntil: asNullableString(raw.snoozed_until),
    assignedToUserId: raw.assigned_to_user_id == null ? null : asNumber(raw.assigned_to_user_id),
    labels: Array.isArray(raw.labels) ? raw.labels.filter((item): item is string => typeof item === 'string') : [],
    aiSummary: asNullableString(raw.ai_summary),
    sentiment,
    attachments: Array.isArray(raw.attachments) ? raw.attachments : null,
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

export async function updateMailboxSettings(
  token: string,
  connectionId: number,
  payload: { is_enabled: boolean; is_primary: boolean },
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

export async function listEmailMessages(token: string, filters: MessageFilters): Promise<PagedResult<EmailMessage>> {
  const cid = Math.trunc(Number(filters.connectionId))
  if (!Number.isFinite(cid) || cid < 1) {
    throw new Error('Ongeldige mailbox (connection_id).')
  }
  const params = new URLSearchParams()
  params.set('connection_id', String(cid))
  params.set('page', String(filters.page ?? 1))
  params.set('per_page', String(filters.perPage ?? 50))
  if (filters.search) params.set('search', filters.search)
  const payload = await apiGet<unknown>(integrationsRoutes.email.messages.listQuery(params), token)

  const data = payload as Record<string, unknown>
  const itemsSource = Array.isArray(payload)
    ? payload
    : Array.isArray(data.items)
      ? data.items
      : []

  return {
    items: itemsSource.map(normalizeMessage).filter((item): item is EmailMessage => item !== null),
    page: asNumber(data.curPage ?? data.page, filters.page ?? 1),
    perPage: asNumber(data.perPage ?? data.per_page, filters.perPage ?? 50),
    total: Number.isFinite(asNumber(data.itemsTotal, NaN)) ? asNumber(data.itemsTotal) : null,
  }
}

export async function getEmailMessage(token: string, messageId: number): Promise<EmailMessage | null> {
  const payload = await apiGet<unknown>(integrationsRoutes.email.messages.byId(messageId), token)
  return normalizeMessage(payload)
}

export async function patchEmailMessage(
  token: string,
  messageId: number,
  patch: Partial<{
    is_read: boolean
    conversation_status: 'open' | 'snoozed' | 'closed'
    assigned_to_user_id: number | null
    labels: string[]
    ai_summary: string
    sentiment: 'positive' | 'neutral' | 'negative' | 'urgent'
  }>,
): Promise<EmailMessage | null> {
  const payload = await apiPatch<unknown>(integrationsRoutes.email.messages.byId(messageId), patch, token)
  return normalizeMessage(payload)
}

export async function snoozeEmailMessage(token: string, messageId: number, snoozedUntil: string): Promise<EmailMessage | null> {
  const payload = await apiPatch<unknown>(integrationsRoutes.email.messages.snooze(messageId), { snoozed_until: snoozedUntil }, token)
  return normalizeMessage(payload)
}

export async function sendEmailMessage(token: string, input: SendEmailInput): Promise<{ ok: boolean; messageId: number | null }> {
  const payload = await apiPost<{ ok?: boolean; message_id?: number }>(
    integrationsRoutes.email.send,
    {
      connection_id: input.connectionId,
      to_addresses: input.toAddresses,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      body_text: input.bodyText,
      body_html: input.bodyHtml,
      in_reply_to: input.inReplyTo,
      thread_id: input.threadId,
      attachments: input.attachments,
    },
    token,
  )
  return { ok: Boolean(payload.ok), messageId: typeof payload.message_id === 'number' ? payload.message_id : null }
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

const DEFAULT_AI_CONFIG: AiInboxConfig = {
  suggestions_enabled: true,
  auto_reply_enabled: false,
  auto_reply_threshold: 0.85,
  auto_label_enabled: false,
  tone: 'formeel',
  language: 'nl',
}

export async function getAiConfig(token: string, connectionId: number): Promise<AiInboxConfig> {
  const payload = await apiGet<{ ai_config?: Partial<AiInboxConfig> }>(integrationsRoutes.email.connections.aiConfig(connectionId), token)
  return {
    ...DEFAULT_AI_CONFIG,
    ...(payload.ai_config ?? {}),
  }
}

export async function saveAiConfig(token: string, connectionId: number, config: AiInboxConfig): Promise<void> {
  await apiPut(integrationsRoutes.email.connections.aiConfig(connectionId), { ai_config: config }, token)
}

export async function aiSuggestReply(token: string, messageId: number): Promise<{ suggestion: string; confidence: number }> {
  const payload = await apiPost<{ suggestion?: string; confidence?: number }>(
    integrationsRoutes.email.messages.aiSuggest(messageId),
    {},
    token,
  )
  return {
    suggestion: asString(payload.suggestion),
    confidence: typeof payload.confidence === 'number' ? payload.confidence : 0,
  }
}

export async function aiSummarizeMessage(token: string, messageId: number): Promise<string> {
  const payload = await apiPost<{ ai_summary?: string }>(integrationsRoutes.email.messages.aiSummarize(messageId), {}, token)
  return asString(payload.ai_summary)
}

export async function aiAnalyzeSentiment(token: string, messageId: number): Promise<string> {
  const payload = await apiPost<{ sentiment?: string }>(integrationsRoutes.email.messages.aiSentiment(messageId), {}, token)
  return asString(payload.sentiment)
}

export async function aiCategorizeMessage(token: string, messageId: number): Promise<string[]> {
  const payload = await apiPost<{ labels?: unknown[] }>(integrationsRoutes.email.messages.aiCategorize(messageId), {}, token)
  return Array.isArray(payload.labels) ? payload.labels.filter((label): label is string => typeof label === 'string') : []
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
