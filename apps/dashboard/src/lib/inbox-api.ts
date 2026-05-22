import { integrationsRoutes } from '../api/routes/integrations.routes'
import {
  xanoGetIntegrations,
  xanoPostIntegrations,
  xanoPatchIntegrations,
  xanoPutIntegrations,
  xanoDeleteIntegrations,
} from './xano'

const xanoGet = xanoGetIntegrations
const xanoPost = xanoPostIntegrations
const xanoPatch = xanoPatchIntegrations
const xanoPut = xanoPutIntegrations
const xanoDelete = xanoDeleteIntegrations

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ThreadStatus = 'open' | 'pending' | 'closed' | 'spam'
export type ThreadPriority = 'normal' | 'high' | 'urgent'
export type MessageDirection = 'inbound' | 'outbound' | 'internal' | 'system'
export type SendStatus = 'sending' | 'sent' | 'failed'

export type InboxThread = {
  id: number
  organisationId: string
  emailConnectionId: number | null
  graphConversationId: string
  emailSubject: string
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
  createdAt: string
}

export type InboxMessage = {
  id: number
  threadId: number
  connectionId: number | null
  direction: MessageDirection
  fromAddress: string
  toAddresses: string
  subject: string
  bodyPreview: string
  bodyHtml: string | null
  graphMessageId: string
  inReplyTo: string | null
  authorUserId: number | null
  isRead: boolean
  sendStatus: SendStatus | null
  attachments: unknown[] | null
  receivedAt: string | null
  createdAt: string
}

export type InboxEvent = {
  id: number
  threadId: number
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
  view?: 'all_open' | 'unassigned' | 'mine' | 'pending' | 'closed' | 'spam' | 'outbound' | 'pinned'
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

export type ReplyInput = {
  bodyText: string
  bodyHtml?: string
  action?: 'send' | 'send_and_close' | 'send_and_pending'
}

export type PatchThreadInput = {
  status?: ThreadStatus
  assignedToUserId?: number
  tags?: string[]
  priority?: ThreadPriority
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
 * Normalize a Xano timestamp (returned as Unix milliseconds number, ISO string,
 * or seconds number) into an ISO 8601 string. Returns empty string when the
 * value cannot be parsed.
 */
function asTimestampString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Xano returns timestamps in ms. Treat smaller values as seconds.
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

function normalizeThread(row: unknown): InboxThread | null {
  if (!row || typeof row !== 'object') return null
  const raw = row as Record<string, unknown>
  const id = asNumber(raw.id, NaN)
  if (!Number.isFinite(id) || id === 0) return null
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
    emailSubject: asString(raw.email_subject, '(Geen onderwerp)'),
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
    createdAt: asTimestampString(raw.created_at),
  }
}

function normalizeMessage(row: unknown): InboxMessage | null {
  if (!row || typeof row !== 'object') return null
  const raw = row as Record<string, unknown>
  const id = asNumber(raw.id, NaN)
  if (!Number.isFinite(id) || id === 0) return null
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
    threadId: asNumber(raw.thread_id),
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
  const id = asNumber(raw.id, NaN)
  if (!Number.isFinite(id) || id === 0) return null
  return {
    id,
    threadId: asNumber(raw.thread_id),
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
  const payload = await xanoGet<{ folders?: unknown[]; sync_state?: unknown[] }>(
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
  await xanoPut(integrationsRoutes.email.connections.folders(connectionId), { folders }, token)
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export async function listThreads(token: string, filters: ThreadFilters = {}): Promise<PagedThreadResult> {
  const params = new URLSearchParams()
  if (filters.view) params.set('view', filters.view)
  if (filters.tag) params.set('tag', filters.tag)
  if (filters.assigneeId) params.set('assignee_id', String(filters.assigneeId))
  if (filters.search) params.set('search', filters.search)
  params.set('page', String(filters.page ?? 1))
  params.set('per_page', String(filters.perPage ?? 30))
  if (filters.connectionId && filters.connectionId > 0) params.set('connection_id', String(filters.connectionId))
  const payload = await xanoGet<unknown>(integrationsRoutes.inbox.threadsQuery(params), token)
  const data = payload as Record<string, unknown>
  const itemsSource = Array.isArray(payload) ? payload : Array.isArray(data.items) ? data.items : []
  return {
    items: itemsSource.map(normalizeThread).filter((t): t is InboxThread => t !== null),
    curPage: asNumber(data.curPage ?? data.page, filters.page ?? 1),
    itemsTotal: Number.isFinite(asNumber(data.itemsTotal, NaN)) ? asNumber(data.itemsTotal) : null,
    nextPage: data.nextPage != null ? asNumber(data.nextPage) : null,
  }
}

export async function getThread(token: string, threadId: number): Promise<ThreadDetail | null> {
  const payload = await xanoGet<{ thread?: unknown; messages?: unknown[]; events?: unknown[] }>(
    integrationsRoutes.inbox.thread(threadId),
    token,
  )
  const thread = normalizeThread(payload.thread)
  if (!thread) return null
  return {
    thread,
    messages: (payload.messages ?? []).map(normalizeMessage).filter((m): m is InboxMessage => m !== null),
    events: (payload.events ?? []).map(normalizeEvent).filter((e): e is InboxEvent => e !== null),
  }
}

export async function patchThread(token: string, threadId: number, patch: PatchThreadInput): Promise<InboxThread | null> {
  const body: Record<string, unknown> = {}
  if (patch.status !== undefined) body.status = patch.status
  if (patch.assignedToUserId !== undefined) body.assigned_to_user_id = patch.assignedToUserId
  if (patch.tags !== undefined) body.tags = patch.tags
  if (patch.priority !== undefined) body.priority = patch.priority
  const payload = await xanoPatch<unknown>(integrationsRoutes.inbox.thread(threadId), body, token)
  return normalizeThread(payload)
}

// ---------------------------------------------------------------------------
// Read / unread state
// ---------------------------------------------------------------------------

/**
 * Mark a thread as read for the team. Called silently from the dashboard when
 * a user opens a thread; the UI updates optimistically before this resolves.
 */
export async function markThreadRead(token: string, threadId: number): Promise<InboxThread | null> {
  const payload = await xanoPatch<unknown>(integrationsRoutes.inbox.threadMarkRead(threadId), {}, token)
  return normalizeThread(payload)
}

/**
 * Manually flip a thread back to unread (e.g. via the "Markeer als ongelezen"
 * button in the thread detail header).
 */
export async function markThreadUnread(token: string, threadId: number): Promise<InboxThread | null> {
  const payload = await xanoPatch<unknown>(integrationsRoutes.inbox.threadMarkUnread(threadId), {}, token)
  return normalizeThread(payload)
}

// ---------------------------------------------------------------------------
// Pin state (per-user)
//
// Pin state is tracked in a separate inbox_thread_pin table on the backend.
// To keep the thread-list and thread-detail endpoints simple and free of
// type-fragile decoration logic, the dashboard fetches the user's pinned
// thread IDs separately via GET /inbox/pins, and joins client-side.
// ---------------------------------------------------------------------------

/**
 * Returns the set of thread IDs the current user has pinned. The dashboard
 * uses this to decorate thread items with `isPinned` and to sort pinned
 * threads to the top of every list view.
 */
export async function listPinnedThreadIds(token: string): Promise<number[]> {
  const payload = await xanoGet<{ thread_ids?: unknown[] } | unknown[]>(integrationsRoutes.inbox.pins, token)
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { thread_ids?: unknown[] }).thread_ids)
      ? ((payload as { thread_ids: unknown[] }).thread_ids)
      : []
  return source.map((v) => asNumber(v, NaN)).filter((n) => Number.isFinite(n) && n > 0)
}

/**
 * Pin a thread for the current user. Idempotent on the backend.
 * Pinned threads always appear at the top of any list view they match, plus
 * are listed in the dedicated "Gepind" view.
 */
export async function pinThread(token: string, threadId: number): Promise<void> {
  await xanoPost<unknown>(integrationsRoutes.inbox.threadPin(threadId), {}, token)
}

/**
 * Unpin a thread for the current user. Idempotent on the backend.
 */
export async function unpinThread(token: string, threadId: number): Promise<void> {
  await xanoDelete<unknown>(integrationsRoutes.inbox.threadPin(threadId), token)
}

export async function replyToThread(token: string, threadId: number, input: ReplyInput): Promise<InboxMessage | null> {
  const body: Record<string, unknown> = {
    body_text: input.bodyText,
    action: input.action ?? 'send',
  }
  if (input.bodyHtml) body.body_html = input.bodyHtml
  const payload = await xanoPost<unknown>(integrationsRoutes.inbox.threadReply(threadId), body, token)
  return normalizeMessage(payload)
}

export async function addNoteToThread(token: string, threadId: number, bodyText: string): Promise<InboxMessage | null> {
  const payload = await xanoPost<unknown>(integrationsRoutes.inbox.threadNotes(threadId), { body_text: bodyText }, token)
  return normalizeMessage(payload)
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export async function listInboxMembers(token: string): Promise<InboxMember[]> {
  const payload = await xanoGet<unknown>(integrationsRoutes.inbox.members, token)
  const source = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { items?: unknown[] }).items)
      ? (payload as { items: unknown[] }).items
      : []
  return source
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const raw = row as Record<string, unknown>
      const id = asNumber(raw.id, NaN)
      if (!Number.isFinite(id)) return null
      return {
        id,
        name: asString(raw.name, `User ${id}`),
        email: asString(raw.email),
        avatarUrl: asNullableString(raw.avatar_url),
      } satisfies InboxMember
    })
    .filter((m): m is InboxMember => m !== null)
}

// ---------------------------------------------------------------------------
// Sync status
// ---------------------------------------------------------------------------

export async function getSyncStatus(token: string): Promise<SyncConnectionStatus[]> {
  const payload = await xanoGet<unknown>(integrationsRoutes.inbox.syncStatus, token)
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
