import { appRoutes } from '../api/routes/app.routes'
import { apiDelete, apiGet, apiPatch, apiPost } from './api'
import { normalizeMyFeedback } from './inbox-api'
import type {
  InboxEvent,
  InboxMember,
  InboxMessage,
  InboxThread,
  PatchThreadInput,
  PagedThreadResult,
  ReplyInput,
  ThreadDetail,
  ThreadFilters,
} from './inbox-api'

// Signal is the only thread model (Phase 1 of the Bokito OS restructure);
// the legacy inbox path is gone.
export const USE_SIGNAL_INBOX = true

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function asNullableTimestampString(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000
    const date = new Date(ms)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return null
}

function normalizeThreadId(raw: unknown): string | null {
  if (typeof raw === 'string' && raw.length > 0) return raw
  return null
}

function normalizeSignalThread(row: unknown): InboxThread | null {
  if (!row || typeof row !== 'object') return null
  const raw = row as Record<string, unknown>
  const id = normalizeThreadId(raw.id)
  if (!id) return null
  const statusValue = asString(raw.status)
  const status =
    statusValue === 'pending'
      ? 'pending'
      : statusValue === 'closed'
        ? 'closed'
        : statusValue === 'spam'
          ? 'spam'
          : 'open'
  const priorityValue = asString(raw.priority)
  const priority = priorityValue === 'high' ? 'high' : priorityValue === 'urgent' ? 'urgent' : 'normal'
  return {
    id,
    organisationId: asString(raw.organisation_id),
    emailConnectionId: null,
    graphConversationId: asString(raw.graph_conversation_id ?? raw.external_id),
    emailSubject: asString(raw.email_subject ?? raw.subject, '(No subject)'),
    contactId: typeof raw.contact_id === 'string' && raw.contact_id.length > 0 ? raw.contact_id : null,
    agentId: typeof raw.agent_id === 'string' && raw.agent_id.length > 0 ? raw.agent_id : null,
    agentName: typeof raw.agent_name === 'string' && raw.agent_name.length > 0 ? raw.agent_name : null,
    agentKind: typeof raw.agent_kind === 'string' && raw.agent_kind.length > 0 ? raw.agent_kind : null,
    contactEmail: asString(raw.contact_email),
    contactName: asString(raw.contact_name),
    contactPhone: asString(raw.contact_phone),
    status,
    snoozedUntil: asNullableTimestampString(raw.snoozed_until),
    priority,
    assignedToUserId:
      raw.assigned_to_user_id == null || raw.assigned_to_user_id === 0
        ? null
        : asNumber(raw.assigned_to_user_id),
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [],
    lastMessageAt: asNullableTimestampString(raw.last_message_at),
    hasUnread: Boolean(raw.has_unread),
    isPinned: Boolean(raw.is_pinned),
    aiPaused: Boolean(raw.ai_paused),
    suggestedActions: Array.isArray(raw.suggested_actions)
      ? raw.suggested_actions.filter((a): a is string => typeof a === 'string')
      : [],
    channel: asString(raw.channel, 'email'),
    folder: asString(raw.folder, raw.channel === 'internal' ? 'internal' : 'external'),
    projectId: raw.project_id ? asString(raw.project_id) : null,
    createdAt: asString(raw.created_at),
  }
}

function normalizeSignalMessage(row: unknown): InboxMessage | null {
  if (!row || typeof row !== 'object') return null
  const raw = row as Record<string, unknown>
  const id = normalizeThreadId(raw.id)
  const threadId = normalizeThreadId(raw.thread_id ?? raw.signal_id)
  if (!id || !threadId) return null
  const directionValue = asString(raw.direction)
  const direction =
    directionValue === 'outbound'
      ? 'outbound'
      : directionValue === 'internal'
        ? 'internal'
        : directionValue === 'system'
          ? 'system'
          : 'inbound'
  return {
    id,
    threadId,
    connectionId: null,
    kind: asString(raw.kind, 'user_message'),
    direction,
    fromAddress: asString(raw.from_address),
    toAddresses: asString(raw.to_addresses),
    subject: asString(raw.subject),
    bodyPreview: asString(raw.body_preview ?? raw.body_text),
    bodyText: asString(raw.body_text),
    bodyHtml: typeof raw.body_html === 'string' ? raw.body_html : null,
    graphMessageId: asString(raw.graph_message_id ?? raw.external_id),
    inReplyTo: null,
    authorUserId:
      raw.author_user_id == null || raw.author_user_id === 0 ? null : asNumber(raw.author_user_id),
    isRead: Boolean(raw.is_read),
    sendStatus: null,
    attachments: Array.isArray(raw.attachments) ? raw.attachments : null,
    decisionId: raw.decision_id ? asString(raw.decision_id) : null,
    payload: raw.payload && typeof raw.payload === 'object' ? (raw.payload as Record<string, unknown>) : {},
    myFeedback: normalizeMyFeedback(raw),
    agentTrace: normalizeAgentTrace(raw),
    receivedAt: asNullableTimestampString(raw.received_at),
    createdAt: asString(raw.created_at),
  }
}

function normalizeAgentTrace(raw: Record<string, unknown>): InboxMessage['agentTrace'] {
  const payload = raw.payload && typeof raw.payload === 'object' ? (raw.payload as Record<string, unknown>) : null
  const fromPayload = payload?.agent_trace
  const fromRoot = raw.agent_trace
  const trace = (fromPayload && typeof fromPayload === 'object' ? fromPayload : null)
    ?? (fromRoot && typeof fromRoot === 'object' ? fromRoot : null)
  if (!trace || typeof trace !== 'object') return null
  const t = trace as Record<string, unknown>
  const usage =
    t.usage && typeof t.usage === 'object'
      ? (t.usage as { input_tokens?: number; output_tokens?: number })
      : undefined
  const steps = Array.isArray(t.steps) ? t.steps : undefined
  const thinking =
    t.thinking && typeof t.thinking === 'object'
      ? (t.thinking as { text?: string; ms?: number; budget?: number })
      : undefined
  if (!usage && (!steps || steps.length === 0) && !thinking) return null
  return {
    usage,
    steps: steps as NonNullable<InboxMessage['agentTrace']>['steps'],
    thinking,
  }
}

function normalizeSignalEvent(row: unknown): InboxEvent | null {
  if (!row || typeof row !== 'object') return null
  const raw = row as Record<string, unknown>
  const id = normalizeThreadId(raw.id)
  const threadId = normalizeThreadId(raw.thread_id ?? raw.signal_id)
  if (!id || !threadId) return null
  return {
    id,
    threadId,
    eventType: asString(raw.event_type),
    actorUserId:
      raw.actor_user_id == null || raw.actor_user_id === 0 ? null : asNumber(raw.actor_user_id),
    payload: raw.payload && typeof raw.payload === 'object' ? (raw.payload as Record<string, unknown>) : {},
    createdAt: asString(raw.created_at),
  }
}

export async function listSignalThreads(token: string, filters: ThreadFilters = {}): Promise<PagedThreadResult> {
  const params = new URLSearchParams()
  if (filters.view) params.set('view', filters.view)
  if (filters.folder) params.set('folder', filters.folder)
  if (filters.channel) params.set('channel', filters.channel)
  if (filters.agentId) params.set('agent_id', filters.agentId)
  if (filters.projectId) params.set('project_id', filters.projectId)
  if (filters.tag) params.set('tag', filters.tag)
  if (filters.assigneeId) params.set('assignee_id', String(filters.assigneeId))
  if (filters.search) params.set('search', filters.search)
  params.set('page', String(filters.page ?? 1))
  params.set('per_page', String(filters.perPage ?? 30))
  if (filters.connectionId && filters.connectionId > 0) {
    params.set('email_connection_id', String(filters.connectionId))
  }
  const payload = await apiGet<unknown>(appRoutes.signals.threadsQuery(params), token)
  const data = payload as Record<string, unknown>
  const itemsSource = Array.isArray(data.items) ? data.items : []
  return {
    items: itemsSource.map(normalizeSignalThread).filter((t): t is InboxThread => t !== null),
    curPage: asNumber(data.curPage, filters.page ?? 1),
    itemsTotal: Number.isFinite(asNumber(data.itemsTotal, NaN)) ? asNumber(data.itemsTotal) : null,
    nextPage: data.nextPage != null ? asNumber(data.nextPage) : null,
  }
}

export async function getSignalThread(token: string, threadId: string): Promise<ThreadDetail | null> {
  const payload = await apiGet<{ thread?: unknown; messages?: unknown[]; events?: unknown[] }>(
    appRoutes.signals.thread(threadId),
    token,
  )
  const thread = normalizeSignalThread(payload.thread)
  if (!thread) return null
  return {
    thread,
    messages: (payload.messages ?? []).map(normalizeSignalMessage).filter((m): m is InboxMessage => m !== null),
    events: (payload.events ?? []).map(normalizeSignalEvent).filter((e): e is InboxEvent => e !== null),
  }
}

export async function patchSignalThread(
  token: string,
  threadId: string,
  patch: PatchThreadInput,
): Promise<InboxThread | null> {
  const body: Record<string, unknown> = {}
  if (patch.status !== undefined) body.status = patch.status
  if (patch.assignedToUserId !== undefined) body.assigned_to_user_id = patch.assignedToUserId
  if (patch.tags !== undefined) body.tags = patch.tags
  if (patch.priority !== undefined) body.priority = patch.priority
  if (patch.projectId !== undefined) body.project_id = patch.projectId
  if (patch.snoozedUntil !== undefined) body.snoozed_until = patch.snoozedUntil
  const payload = await apiPatch<unknown>(appRoutes.signals.thread(threadId), body, token)
  return normalizeSignalThread(payload)
}

export async function bulkUpdateSignalThreads(
  token: string,
  signalIds: string[],
  action: 'close' | 'reopen' | 'spam' | 'read' | 'unread' | 'assign',
  assigneeId?: number,
): Promise<number> {
  const body: Record<string, unknown> = { signal_ids: signalIds, action }
  if (assigneeId !== undefined) body.assignee_id = assigneeId
  const payload = await apiPost<{ updated?: number }>(appRoutes.signals.bulk, body, token)
  return typeof payload.updated === 'number' ? payload.updated : 0
}

// ---------------------------------------------------------------------------
// Saved replies (canned responses for the composer)
// ---------------------------------------------------------------------------

export type SavedReplyRow = { id: string; title: string; bodyText: string }

function normalizeSavedReply(row: unknown): SavedReplyRow | null {
  if (!row || typeof row !== 'object') return null
  const raw = row as Record<string, unknown>
  const id = asString(raw.id)
  if (!id) return null
  return { id, title: asString(raw.title), bodyText: asString(raw.body_text) }
}

export async function listSavedReplies(token: string): Promise<SavedReplyRow[]> {
  const payload = await apiGet<unknown>(appRoutes.signals.savedReplies, token)
  const source = Array.isArray(payload) ? payload : []
  return source.map(normalizeSavedReply).filter((r): r is SavedReplyRow => r !== null)
}

export async function createSavedReply(
  token: string,
  input: { title: string; bodyText: string },
): Promise<SavedReplyRow | null> {
  const payload = await apiPost<unknown>(
    appRoutes.signals.savedReplies,
    { title: input.title, body_text: input.bodyText },
    token,
  )
  return normalizeSavedReply(payload)
}

export async function updateSavedReply(
  token: string,
  replyId: string,
  input: { title: string; bodyText: string },
): Promise<SavedReplyRow | null> {
  const payload = await apiPatch<unknown>(
    appRoutes.signals.savedReply(replyId),
    { title: input.title, body_text: input.bodyText },
    token,
  )
  return normalizeSavedReply(payload)
}

export async function deleteSavedReply(token: string, replyId: string): Promise<void> {
  await apiDelete<unknown>(appRoutes.signals.savedReply(replyId), token)
}

export async function deleteSignalThread(token: string, threadId: string): Promise<void> {
  await apiDelete<unknown>(appRoutes.signals.threadDelete(threadId), token)
}

export async function markSignalThreadRead(token: string, threadId: string): Promise<InboxThread | null> {
  const payload = await apiPatch<unknown>(appRoutes.signals.threadMarkRead(threadId), {}, token)
  return normalizeSignalThread(payload)
}

export async function markSignalThreadUnread(token: string, threadId: string): Promise<InboxThread | null> {
  const payload = await apiPatch<unknown>(appRoutes.signals.threadMarkUnread(threadId), {}, token)
  return normalizeSignalThread(payload)
}

export async function listSignalPinnedThreadIds(token: string): Promise<string[]> {
  const payload = await apiGet<{ thread_ids?: unknown[] }>(appRoutes.signals.pins, token)
  const source = Array.isArray(payload.thread_ids) ? payload.thread_ids : []
  return source.map((v) => asString(v)).filter((s) => s.length > 0)
}

export async function pinSignalThread(token: string, threadId: string): Promise<void> {
  await apiPost<unknown>(appRoutes.signals.threadPin(threadId), {}, token)
}

export async function unpinSignalThread(token: string, threadId: string): Promise<void> {
  await apiDelete<unknown>(appRoutes.signals.threadPin(threadId), token)
}

export async function replyToSignalThread(
  token: string,
  threadId: string,
  input: ReplyInput,
): Promise<InboxMessage | null> {
  const body: Record<string, unknown> = {
    body_text: input.bodyText,
    action: input.action ?? 'send',
  }
  if (input.bodyHtml) body.body_html = input.bodyHtml
  if (input.attachments?.length) body.attachments = input.attachments
  if (input.snoozeMinutes && input.snoozeMinutes > 0) body.snooze_minutes = input.snoozeMinutes
  const payload = await apiPost<unknown>(appRoutes.signals.threadReply(threadId), body, token)
  return normalizeSignalMessage(payload)
}

export async function takeoverSignalThread(token: string, threadId: string): Promise<boolean> {
  const payload = await apiPost<{ ai_paused?: boolean }>(
    appRoutes.signals.threadTakeover(threadId),
    {},
    token,
  )
  return Boolean(payload?.ai_paused)
}

export async function releaseSignalThread(token: string, threadId: string): Promise<boolean> {
  const payload = await apiPost<{ ai_paused?: boolean }>(
    appRoutes.signals.threadRelease(threadId),
    {},
    token,
  )
  return Boolean(payload?.ai_paused)
}

export async function addNoteToSignalThread(
  token: string,
  threadId: string,
  bodyText: string,
  attachments?: ReplyInput['attachments'],
): Promise<InboxMessage | null> {
  const body: Record<string, unknown> = { body_text: bodyText }
  if (attachments?.length) body.attachments = attachments
  const payload = await apiPost<unknown>(
    appRoutes.signals.threadNotes(threadId),
    body,
    token,
  )
  return normalizeSignalMessage(payload)
}

export type InvokeAgentResult = {
  output: 'note' | 'reply_suggestion'
  message?: InboxMessage
}

/** Invoke an agent inline on a thread (@agent mention or explicit ask). */
export async function invokeSignalAgent(
  token: string,
  threadId: string,
  params: { agentId: string; instruction?: string; output?: 'note' | 'reply_suggestion' },
): Promise<InvokeAgentResult> {
  const payload = await apiPost<Record<string, unknown>>(
    appRoutes.signals.threadInvokeAgent(threadId),
    {
      agent_id: params.agentId,
      instruction: params.instruction ?? '',
      output: params.output ?? 'note',
    },
    token,
  )
  const result: InvokeAgentResult = {
    output: payload.output === 'reply_suggestion' ? 'reply_suggestion' : 'note',
  }
  if (payload.message) {
    const message = normalizeSignalMessage(payload.message)
    if (message) result.message = message
  }
  return result
}

export async function resolveSignalDecision(
  token: string,
  threadId: string,
  messageId: string,
  action: 'approve' | 'defer' | 'reject',
  opts?: {
    optionId?: string
    body?: string
    bodyHtml?: string
    subject?: string
    responseText?: string
  },
): Promise<void> {
  const backendAction =
    action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'deferred'
  const payload: Record<string, unknown> = { action: backendAction }
  if (opts?.optionId) payload.option_id = opts.optionId
  if (opts?.body != null) {
    payload.body = opts.body
    payload.body_text = opts.body
  }
  if (opts?.bodyHtml != null) payload.body_html = opts.bodyHtml
  if (opts?.subject != null) payload.subject = opts.subject
  if (opts?.responseText != null && opts.responseText.trim()) {
    payload.response_text = opts.responseText.trim()
  }
  await apiPost<unknown>(
    appRoutes.signals.messageResolve(threadId, messageId),
    payload,
    token,
  )
}

export async function submitMessageFeedback(
  token: string,
  messageId: string,
  sentiment: 'up' | 'down',
  comment = '',
): Promise<void> {
  await apiPost<unknown>(
    appRoutes.signals.messageFeedback(messageId),
    { sentiment, comment },
    token,
  )
}

export async function listSignalMembers(token: string): Promise<InboxMember[]> {
  const payload = await apiGet<unknown>(appRoutes.signals.members, token)
  const source = Array.isArray(payload) ? payload : []
  return source
    .map((row): InboxMember | null => {
      if (!row || typeof row !== 'object') return null
      const raw = row as Record<string, unknown>
      const id = asNumber(raw.id, NaN)
      if (!Number.isFinite(id)) return null
      return {
        id,
        name: asString(raw.name, `User ${id}`),
        email: asString(raw.email),
        avatarUrl: typeof raw.avatar_url === 'string' && raw.avatar_url ? raw.avatar_url : null,
      }
    })
    .filter((m): m is InboxMember => m !== null)
}

export type SignalBadgeCounts = {
  inbox_unread: number
  inbox_by_queue: { my: number; unassigned: number; all: number }
  agents_attention: number
}

export async function fetchSignalBadgeCounts(token: string): Promise<SignalBadgeCounts> {
  return apiGet<SignalBadgeCounts>(appRoutes.signals.badgeCounts, token)
}
