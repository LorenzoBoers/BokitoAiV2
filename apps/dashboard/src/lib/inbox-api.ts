import { integrationsRoutes } from '../api/routes/integrations.routes'
import { appRoutes } from '../api/routes/app.routes'
import {
  apiGet,
  apiPost,
  apiPatch,
  apiPut,
  apiDelete,
  apiGet as apiGetApp,
} from './api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ThreadStatus = 'open' | 'pending' | 'closed' | 'spam'
export type ThreadPriority = 'normal' | 'high' | 'urgent'
export type MessageDirection = 'inbound' | 'outbound' | 'internal' | 'system'
export type SendStatus = 'sending' | 'sent' | 'failed'

export type ThreadId = string | number

export type MessageFolder = 'external' | 'internal' | 'all'

export type InboxThread = {
  id: ThreadId
  organisationId: string
  emailConnectionId: number | null
  graphConversationId: string
  emailSubject: string
  contactId: string | null
  contactEmail: string
  contactName: string
  contactPhone: string
  status: ThreadStatus
  priority: ThreadPriority
  assignedToUserId: number | null
  tags: string[]
  lastMessageAt: string | null
  hasUnread: boolean
  isPinned: boolean
  /** True when a human operator has taken over and the AI is paused. */
  aiPaused?: boolean
  createdAt: string
  channel?: string
  folder?: MessageFolder | string
  projectId?: string | null
  /** The agent this thread targets (chat threads), if any. */
  agentId?: string | null
  agentName?: string | null
  agentKind?: string | null
}

export type InboxMessage = {
  id: ThreadId
  threadId: ThreadId
  connectionId: number | null
  kind?: string
  direction: MessageDirection
  fromAddress: string
  toAddresses: string
  subject: string
  bodyPreview: string
  bodyText?: string
  bodyHtml: string | null
  graphMessageId: string
  inReplyTo: string | null
  authorUserId: number | null
  isRead: boolean
  sendStatus: SendStatus | null
  attachments: unknown[] | null
  decisionId?: string | null
  payload?: Record<string, unknown>
  receivedAt: string | null
  createdAt: string
}

export type InboxEvent = {
  id: ThreadId
  threadId: ThreadId
  eventType: string
  actorUserId: number | null
  payload: Record<string, unknown>
  createdAt: string
}

export type InboxMember = {
  id: number
  name: string
  email: string
  avatarUrl: string | null
}

export type MailboxFolder = {
  id: string
  displayName: string
  totalItems: number
  isSelected: boolean
  lastSyncAt: string | null
}

export type FolderSyncState = {
  id: number
  folderId: string
  folderName: string
  isSelected: boolean
  lastSyncAt: string | null
}

export type ThreadDetail = {
  thread: InboxThread
  messages: InboxMessage[]
  events: InboxEvent[]
}

export type ThreadFilters = {
  view?:
    | 'all'
    | 'all_open'
    | 'unassigned'
    | 'mine'
    | 'pending'
    | 'closed'
    | 'spam'
    | 'outbound'
    | 'pinned'
    | 'awaiting_decision'
    | 'updates'
    | 'results'
    | 'external'
    | 'internal'
  folder?: 'external' | 'internal' | 'assistant' | 'inbox' | 'all'
  /** Filter on the signal channel (e.g. widget, chat, internal). */
  channel?: string
  agentId?: string
  projectId?: string
  tag?: string
  assigneeId?: number
  search?: string
  page?: number
  perPage?: number
  connectionId?: number
}

export type PagedThreadResult = {
  items: InboxThread[]
  curPage: number
  itemsTotal: number | null
  nextPage: number | null
}

export type MessageAttachment = {
  id: string
  name: string
  mime: string
  size: number
  url: string
}

export type ReplyInput = {
  bodyText: string
  bodyHtml?: string
  action?: 'send' | 'send_and_close' | 'send_and_pending'
  attachments?: MessageAttachment[]
  /** When `email`, a mailbox signature may be appended. Plain chat/internal skips it. */
  format?: 'email' | 'plain'
}

export type PatchThreadInput = {
  status?: ThreadStatus
  assignedToUserId?: number
  tags?: string[]
  priority?: ThreadPriority
  projectId?: string | null
}

export type SyncFolderStatus = {
  id: number
  folderId: string
  folderName: string
  isSelected: boolean
  lastSyncAt: string | null
  messagesSynced: number
  lastError: string
}

export type SyncConnectionStatus = {
  id: number
  mailboxEmail: string
  displayName: string
  provider: string
  status: string
  isEnabled: boolean
  lastSyncAt: string | null
  lastError: string
  folders: SyncFolderStatus[]
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function asNullableString(value: unknown): string | null {
  const text = asString(value)
  return text.length > 0 ? text : null
}

/**
 * Normalize an API timestamp (returned as Unix milliseconds number, ISO string,
 * or seconds number) into an ISO 8601 string. Returns empty string when the
 * value cannot be parsed.
 */
function asTimestampString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) {
    // API returns timestamps in ms. Treat smaller values as seconds.
    const ms = value > 1e12 ? value : value * 1000
    const date = new Date(ms)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return ''
}

function asNullableTimestampString(value: unknown): string | null {
  const iso = asTimestampString(value)
  return iso.length > 0 ? iso : null
}

export function normalizeThreadRow(row: unknown): InboxThread | null {
  return normalizeThread(row)
}

function normalizeThread(row: unknown): InboxThread | null {
  if (!row || typeof row !== 'object') return null
  const raw = row as Record<string, unknown>
  const stringId = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : null
  const numId = asNumber(raw.id, NaN)
  const id: ThreadId | null = stringId ?? (Number.isFinite(numId) && numId > 0 ? numId : null)
  if (id == null) return null
  const statusValue = asString(raw.status)
  const status: ThreadStatus =
    statusValue === 'pending' ? 'pending' : statusValue === 'closed' ? 'closed' : statusValue === 'spam' ? 'spam' : 'open'
  const priorityValue = asString(raw.priority)
  const priority: ThreadPriority = priorityValue === 'high' ? 'high' : priorityValue === 'urgent' ? 'urgent' : 'normal'
  return {
    id,
    organisationId: asString(raw.organisation_id),
    emailConnectionId: raw.email_connection_id == null || raw.email_connection_id === 0 ? null : asNumber(raw.email_connection_id),
    graphConversationId: asString(raw.graph_conversation_id),
    emailSubject: asString(raw.email_subject, '(No subject)'),
    contactId: asNullableString(raw.contact_id),
    contactEmail: asString(raw.contact_email),
    contactName: asString(raw.contact_name),
    contactPhone: asString(raw.contact_phone),
    status,
    priority,
    assignedToUserId:
      raw.assigned_to_user_id == null || raw.assigned_to_user_id === 0 ? null : asNumber(raw.assigned_to_user_id),
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [],
    lastMessageAt: asNullableTimestampString(raw.last_message_at),
    hasUnread: Boolean(raw.has_unread),
    isPinned: Boolean(raw.is_pinned),
    aiPaused: Boolean(raw.ai_paused),
    createdAt: asTimestampString(raw.created_at),
    channel: asString(raw.channel) || undefined,
    folder: asString(raw.folder) || undefined,
    projectId: asNullableString(raw.project_id),
  }
}

function normalizeMessage(row: unknown): InboxMessage | null {
  if (!row || typeof row !== 'object') return null
  const raw = row as Record<string, unknown>
  const stringId = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : null
  const numId = asNumber(raw.id, NaN)
  const id: ThreadId | null = stringId ?? (Number.isFinite(numId) && numId > 0 ? numId : null)
  if (id == null) return null
  const threadRaw = raw.thread_id
  const threadStringId = typeof threadRaw === 'string' && threadRaw.length > 0 ? threadRaw : null
  const threadNumId = asNumber(threadRaw, NaN)
  const threadId: ThreadId =
    threadStringId ?? (Number.isFinite(threadNumId) && threadNumId > 0 ? threadNumId : 0)
  const directionValue = asString(raw.direction)
  const direction: MessageDirection =
    directionValue === 'outbound'
      ? 'outbound'
      : directionValue === 'internal'
        ? 'internal'
        : directionValue === 'system'
          ? 'system'
          : 'inbound'
  const sendStatusValue = asString(raw.send_status)
  const sendStatus: SendStatus | null =
    sendStatusValue === 'sending' ? 'sending' : sendStatusValue === 'sent' ? 'sent' : sendStatusValue === 'failed' ? 'failed' : null
  return {
    id,
    threadId,
    connectionId: raw.connection_id == null || raw.connection_id === 0 ? null : asNumber(raw.connection_id),
    direction,
    fromAddress: asString(raw.from_address),
    toAddresses: asString(raw.to_addresses),
    subject: asString(raw.subject),
    bodyPreview: asString(raw.body_preview),
    bodyHtml: asNullableString(raw.body_html),
    graphMessageId: asString(raw.graph_message_id),
    inReplyTo: asNullableString(raw.in_reply_to),
    authorUserId: raw.author_user_id == null || raw.author_user_id === 0 ? null : asNumber(raw.author_user_id),
    isRead: Boolean(raw.is_read),
    sendStatus,
    attachments: Array.isArray(raw.attachments) ? raw.attachments : null,
    receivedAt: asNullableTimestampString(raw.received_at),
    createdAt: asTimestampString(raw.created_at),
  }
}

function normalizeEvent(row: unknown): InboxEvent | null {
  if (!row || typeof row !== 'object') return null
  const raw = row as Record<string, unknown>
  const stringId = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : null
  const numId = asNumber(raw.id, NaN)
  const id: ThreadId | null = stringId ?? (Number.isFinite(numId) && numId > 0 ? numId : null)
  if (id == null) return null
  const threadRaw = raw.thread_id
  const threadStringId = typeof threadRaw === 'string' && threadRaw.length > 0 ? threadRaw : null
  const threadNumId = asNumber(threadRaw, NaN)
  const threadId: ThreadId =
    threadStringId ?? (Number.isFinite(threadNumId) && threadNumId > 0 ? threadNumId : 0)
  return {
    id,
    threadId,
    eventType: asString(raw.event_type),
    actorUserId: raw.actor_user_id == null || raw.actor_user_id === 0 ? null : asNumber(raw.actor_user_id),
    payload: raw.payload && typeof raw.payload === 'object' ? (raw.payload as Record<string, unknown>) : {},
    createdAt: asTimestampString(raw.created_at),
  }
}

function normalizeFolder(row: unknown): MailboxFolder | null {
  if (!row || typeof row !== 'object') return null
  const raw = row as Record<string, unknown>
  const id = asString(raw.id)
  if (!id) return null
  return {
    id,
    displayName: asString(raw.display_name ?? raw.displayName, id),
    totalItems: asNumber(raw.total_items ?? raw.totalItemCount),
    isSelected: Boolean(raw.is_selected),
    lastSyncAt: asNullableTimestampString(raw.last_sync_at),
  }
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export async function listMailboxFolders(token: string, connectionId: number): Promise<MailboxFolder[]> {
  const payload = await apiGet<{ folders?: unknown[]; sync_state?: unknown[] }>(
    integrationsRoutes.email.connections.folders(connectionId),
    token,
  )
  const rawFolders = Array.isArray(payload.folders) ? payload.folders : Array.isArray(payload) ? (payload as unknown[]) : []
  const syncState: FolderSyncState[] = Array.isArray(payload.sync_state)
    ? payload.sync_state.map((row) => {
        const raw = row as Record<string, unknown>
        return {
          id: asNumber(raw.id),
          folderId: asString(raw.folder_id),
          folderName: asString(raw.folder_name),
          isSelected: Boolean(raw.is_selected),
          lastSyncAt: asNullableTimestampString(raw.last_sync_at),
        } satisfies FolderSyncState
      })
    : []
  const syncMap = new Map(syncState.map((s) => [s.folderId, s]))
  return rawFolders
    .map((row) => {
      const folder = normalizeFolder(row)
      if (!folder) return null
      const state = syncMap.get(folder.id)
      return { ...folder, isSelected: state?.isSelected ?? folder.isSelected, lastSyncAt: state?.lastSyncAt ?? folder.lastSyncAt }
    })
    .filter((f): f is MailboxFolder => f !== null)
}

export async function saveMailboxFolders(
  token: string,
  connectionId: number,
  folders: Array<{ id: string; display_name: string; is_selected: boolean }>,
): Promise<void> {
  await apiPut(integrationsRoutes.email.connections.folders(connectionId), { folders }, token)
}

import {
  addNoteToSignalThread,
  deleteSignalThread,
  getSignalThread,
  listSignalMembers,
  listSignalPinnedThreadIds,
  listSignalThreads,
  markSignalThreadRead,
  markSignalThreadUnread,
  patchSignalThread,
  pinSignalThread,
  releaseSignalThread,
  replyToSignalThread,
  resolveSignalDecision,
  takeoverSignalThread,
  unpinSignalThread,
} from './signals-api'

// ---------------------------------------------------------------------------
// Threads (Signal API)
// ---------------------------------------------------------------------------

export async function listThreads(token: string, filters: ThreadFilters = {}): Promise<PagedThreadResult> {
  return listSignalThreads(token, filters)
}

export async function getThread(token: string, threadId: ThreadId): Promise<ThreadDetail | null> {
  return getSignalThread(token, String(threadId))
}

export async function deleteThread(token: string, threadId: ThreadId): Promise<void> {
  return deleteSignalThread(token, String(threadId))
}

export async function patchThread(token: string, threadId: ThreadId, patch: PatchThreadInput): Promise<InboxThread | null> {
  return patchSignalThread(token, String(threadId), patch)
}

// ---------------------------------------------------------------------------
// Read / unread state
// ---------------------------------------------------------------------------

export async function markThreadRead(token: string, threadId: ThreadId): Promise<InboxThread | null> {
  return markSignalThreadRead(token, String(threadId))
}

export async function markThreadUnread(token: string, threadId: ThreadId): Promise<InboxThread | null> {
  return markSignalThreadUnread(token, String(threadId))
}

// ---------------------------------------------------------------------------
// Pin state (per-user)
// ---------------------------------------------------------------------------

export async function listPinnedThreadIds(token: string): Promise<ThreadId[]> {
  return listSignalPinnedThreadIds(token)
}

export async function pinThread(token: string, threadId: ThreadId): Promise<void> {
  return pinSignalThread(token, String(threadId))
}

export async function unpinThread(token: string, threadId: ThreadId): Promise<void> {
  return unpinSignalThread(token, String(threadId))
}

export async function replyToThread(token: string, threadId: ThreadId, input: ReplyInput): Promise<InboxMessage | null> {
  return replyToSignalThread(token, String(threadId), input)
}

export async function addNoteToThread(
  token: string,
  threadId: ThreadId,
  bodyText: string,
  attachments?: MessageAttachment[],
): Promise<InboxMessage | null> {
  return addNoteToSignalThread(token, String(threadId), bodyText, attachments)
}

/** Human takeover: pause the AI on a thread so an operator owns the reply. */
export async function takeoverThread(token: string, threadId: ThreadId): Promise<boolean> {
  return takeoverSignalThread(token, String(threadId))
}

/** Hand a thread back to the AI agent. */
export async function releaseThread(token: string, threadId: ThreadId): Promise<boolean> {
  return releaseSignalThread(token, String(threadId))
}

export async function resolveThreadDecision(
  token: string,
  threadId: ThreadId,
  messageId: ThreadId,
  action: 'approve' | 'defer' | 'reject',
): Promise<void> {
  return resolveSignalDecision(token, String(threadId), String(messageId), action)
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export async function listInboxMembers(token: string): Promise<InboxMember[]> {
  return listSignalMembers(token)
}

// ---------------------------------------------------------------------------
// Sync status
// ---------------------------------------------------------------------------

export async function getSyncStatus(token: string): Promise<SyncConnectionStatus[]> {
  const payload = await apiGetApp<unknown>(appRoutes.signals.syncStatus, token)
  const source = Array.isArray(payload) ? payload : []
  return source
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const raw = row as Record<string, unknown>
      const folderSource = Array.isArray(raw.folders) ? raw.folders : []
      const folders: SyncFolderStatus[] = folderSource
        .map((f) => {
          if (!f || typeof f !== 'object') return null
          const fr = f as Record<string, unknown>
          return {
            id: asNumber(fr.id),
            folderId: asString(fr.folder_id),
            folderName: asString(fr.folder_name),
            isSelected: Boolean(fr.is_selected),
            lastSyncAt: asNullableTimestampString(fr.last_sync_at),
            messagesSynced: asNumber(fr.messages_synced),
            lastError: asString(fr.last_error),
          } satisfies SyncFolderStatus
        })
        .filter((f): f is SyncFolderStatus => f !== null)
      return {
        id: asNumber(raw.id),
        mailboxEmail: asString(raw.mailbox_email),
        displayName: asString(raw.display_name),
        provider: asString(raw.provider),
        status: asString(raw.status),
        isEnabled: Boolean(raw.is_enabled),
        lastSyncAt: asNullableTimestampString(raw.last_sync_at),
        lastError: asString(raw.last_error),
        folders,
      } satisfies SyncConnectionStatus
    })
    .filter((c): c is SyncConnectionStatus => c !== null)
}
