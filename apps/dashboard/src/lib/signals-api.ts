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

export function normalizeSignalThread(row: unknown): InboxThread | null {
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
    emailConnectionId:
      typeof raw.email_connection_id === 'number' && raw.email_connection_id > 0
        ? raw.email_connection_id
        : null,
    graphConversationId: asString(raw.graph_conversation_id ?? raw.external_id),
    emailSubject: asString(raw.email_subject ?? raw.subject, '(No subject)'),
    lastMessagePreview: asString(raw.last_message_preview),
    lastMessageDirection: asString(raw.last_message_direction) as InboxThread['lastMessageDirection'],
    contactId: typeof raw.contact_id === 'string' && raw.contact_id.length > 0 ? raw.contact_id : null,
    agentId: typeof raw.agent_id === 'string' && raw.agent_id.length > 0 ? raw.agent_id : null,
    agentName: typeof raw.agent_name === 'string' && raw.agent_name.length > 0 ? raw.agent_name : null,
    agentKind: typeof raw.agent_kind === 'string' && raw.agent_kind.length > 0 ? raw.agent_kind : null,
    agentAvatarKind:
      typeof raw.agent_avatar_kind === 'string' && raw.agent_avatar_kind.length > 0
        ? raw.agent_avatar_kind
        : typeof raw.avatar_kind === 'string' && raw.avatar_kind.length > 0
          ? raw.avatar_kind
          : null,
    agentAvatarIcon:
      typeof raw.agent_avatar_icon === 'string' && raw.agent_avatar_icon.length > 0
        ? raw.agent_avatar_icon
        : typeof raw.avatar_icon === 'string' && raw.avatar_icon.length > 0
          ? raw.avatar_icon
          : null,
    agentAvatarColor:
      typeof raw.agent_avatar_color === 'string' && raw.agent_avatar_color.length > 0
        ? raw.agent_avatar_color
        : typeof raw.avatar_color === 'string' && raw.avatar_color.length > 0
          ? raw.avatar_color
          : null,
    agentAvatarImageUrl:
      typeof raw.agent_avatar_image_url === 'string' && raw.agent_avatar_image_url.length > 0
        ? raw.agent_avatar_image_url
        : typeof raw.avatar_image_url === 'string' && raw.avatar_image_url.length > 0
          ? raw.avatar_image_url
          : null,
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
    hasOpenDecision: Boolean(raw.has_open_decision),
    isPinned: Boolean(raw.is_pinned),
    aiPaused: Boolean(raw.ai_paused),
    suggestedActions: Array.isArray(raw.suggested_actions)
      ? raw.suggested_actions.filter((a): a is string => typeof a === 'string')
      : [],
    category: asString(raw.category) || null,
    urgency: typeof raw.urgency === 'number' ? raw.urgency : null,
    certainty: typeof raw.certainty === 'number' ? raw.certainty : null,
    aiSummary: asString(raw.ai_summary) || null,
    channel: asString(raw.channel, 'email'),
    folder: asString(raw.folder, raw.channel === 'internal' ? 'internal' : 'external'),
    projectId: raw.project_id ? asString(raw.project_id) : null,
    createdAt: asString(raw.created_at),
  }
}

export function normalizeSignalMessage(row: unknown): InboxMessage | null {
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
    cc: typeof raw.cc === 'string' && raw.cc ? raw.cc : null,
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
  if (filters.unread) params.set('unread', '1')
  if (filters.needsReply) params.set('needs_reply', '1')
  if (filters.needsDecision) params.set('needs_decision', '1')
  if (filters.pinnedOnly) params.set('pinned', '1')
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

// ---------------------------------------------------------------------------
// Inline agent sessions (assistant sub-conversations anchored on a thread)
// ---------------------------------------------------------------------------

export type ThreadSessionAction = { tool: string; detail: string; at: string }

export type ThreadSession = {
  id: string
  state: 'active' | 'closed'
  agentId: string | null
  agentName: string | null
  ownerUserId: string | null
  startedAt: string
  closedAt: string | null
  summary: string
  actions: ThreadSessionAction[]
  messageCount: number
}

function normalizeThreadSession(row: unknown): ThreadSession | null {
  if (!row || typeof row !== 'object') return null
  const raw = row as Record<string, unknown>
  const id = asString(raw.id)
  if (!id) return null
  const actionsSource = Array.isArray(raw.actions) ? raw.actions : []
  return {
    id,
    state: raw.state === 'closed' ? 'closed' : 'active',
    agentId: asString(raw.agent_id) || null,
    agentName: asString(raw.agent_name) || null,
    ownerUserId: asString(raw.owner_user_id) || null,
    startedAt: asString(raw.started_at),
    closedAt: asString(raw.closed_at) || null,
    summary: asString(raw.summary),
    actions: actionsSource
      .map((a): ThreadSessionAction | null => {
        if (!a || typeof a !== 'object') return null
        const rec = a as Record<string, unknown>
        const tool = asString(rec.tool)
        if (!tool) return null
        return { tool, detail: asString(rec.detail), at: asString(rec.at) }
      })
      .filter((a): a is ThreadSessionAction => a !== null),
    messageCount: asNumber(raw.message_count, 0),
  }
}

/** Why an agent is offered on a thread; drives the picker's hint label. */
export type ThreadAgentReason = 'channel' | 'project' | 'company'

export type ThreadAgentCandidate = {
  id: string
  name: string
  reason: ThreadAgentReason
}

export async function listThreadAgentCandidates(
  token: string,
  threadId: string,
): Promise<ThreadAgentCandidate[]> {
  const payload = await apiGet<{ items?: unknown[] }>(
    appRoutes.signals.threadAgentCandidates(threadId),
    token,
  )
  const reasons: ThreadAgentReason[] = ['channel', 'project', 'company']
  return (payload.items ?? [])
    .map((row): ThreadAgentCandidate | null => {
      if (!row || typeof row !== 'object') return null
      const raw = row as Record<string, unknown>
      const id = asString(raw.id)
      if (!id) return null
      const reason = asString(raw.reason) as ThreadAgentReason
      return {
        id,
        name: asString(raw.name),
        reason: reasons.includes(reason) ? reason : 'company',
      }
    })
    .filter((c): c is ThreadAgentCandidate => c !== null)
}

export async function startAgentSession(
  token: string,
  threadId: string,
  agentId?: string | null,
): Promise<ThreadSession | null> {
  const body: Record<string, unknown> = {}
  if (agentId) body.agent_id = agentId
  const payload = await apiPost<unknown>(appRoutes.signals.threadSessions(threadId), body, token)
  return normalizeThreadSession(payload)
}

export async function closeAgentSession(
  token: string,
  threadId: string,
  sessionId: string,
): Promise<ThreadSession | null> {
  const payload = await apiPost<unknown>(
    appRoutes.signals.threadSessionClose(threadId, sessionId),
    {},
    token,
  )
  return normalizeThreadSession(payload)
}

/** Cancel a session that has no turns yet; it leaves no trace on the thread. */
export async function discardAgentSession(
  token: string,
  threadId: string,
  sessionId: string,
): Promise<void> {
  await apiDelete<unknown>(appRoutes.signals.threadSession(threadId, sessionId), token)
}

export async function getSignalThread(token: string, threadId: string): Promise<ThreadDetail | null> {
  const payload = await apiGet<{
    thread?: unknown
    messages?: unknown[]
    events?: unknown[]
    sessions?: unknown[]
    csat?: { score?: unknown; comment?: unknown; created_at?: unknown } | null
  }>(
    appRoutes.signals.thread(threadId),
    token,
  )
  const thread = normalizeSignalThread(payload.thread)
  if (!thread) return null
  const csat =
    payload.csat && typeof payload.csat.score === 'number'
      ? {
          score: payload.csat.score,
          comment: typeof payload.csat.comment === 'string' ? payload.csat.comment : '',
          created_at: typeof payload.csat.created_at === 'string' ? payload.csat.created_at : '',
        }
      : null
  return {
    thread,
    messages: (payload.messages ?? []).map(normalizeSignalMessage).filter((m): m is InboxMessage => m !== null),
    events: (payload.events ?? []).map(normalizeSignalEvent).filter((e): e is InboxEvent => e !== null),
    sessions: (payload.sessions ?? [])
      .map(normalizeThreadSession)
      .filter((s): s is ThreadSession => s !== null),
    csat,
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
  action: 'close' | 'reopen' | 'spam' | 'read' | 'unread' | 'assign' | 'snooze',
  assigneeId?: number,
  extra?: { snoozedUntil?: string | null },
): Promise<number> {
  const body: Record<string, unknown> = { signal_ids: signalIds, action }
  if (assigneeId !== undefined) body.assignee_id = assigneeId
  if (extra?.snoozedUntil !== undefined) body.snoozed_until = extra.snoozedUntil
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

// ---------------------------------------------------------------------------
// Tag registry (tag folders in the sidebar, thread tag picker, settings)
// ---------------------------------------------------------------------------

export type SignalTagRow = {
  tag: string
  total: number
  open: number
  /** When to use this tag; also the guidance AI tagging reads. */
  description: string
  /** False for legacy tags found on threads but not in the registry. */
  registered: boolean
}

/** Fired when the tenant tag catalog may have changed (add/remove/rename). */
export const SIGNAL_TAGS_CHANGED_EVENT = 'bokito:signal-tags-changed'

export function notifySignalTagsChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(SIGNAL_TAGS_CHANGED_EVENT))
}

/** Merge pinned default-view tags with the live catalog (used tags). */
export function mergeSidebarTagRows(
  pinned: string[],
  catalog: SignalTagRow[],
): SignalTagRow[] {
  const byTag = new Map(catalog.map((row) => [row.tag.toLowerCase(), row]))
  const seen = new Set<string>()
  const rows: SignalTagRow[] = []
  for (const raw of pinned) {
    const key = raw.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    rows.push(byTag.get(key) ?? { tag: key, total: 0, open: 0, description: '', registered: false })
  }
  for (const row of catalog) {
    const key = row.tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(row)
  }
  return rows
}

export async function listSignalTags(token: string): Promise<SignalTagRow[]> {
  const payload = await apiGet<{ items?: unknown }>(appRoutes.signals.tags, token)
  const source = Array.isArray(payload.items) ? payload.items : []
  return source
    .map((row): SignalTagRow | null => {
      if (!row || typeof row !== 'object') return null
      const raw = row as Record<string, unknown>
      const tag = asString(raw.tag)
      if (!tag) return null
      return {
        tag,
        total: asNumber(raw.total, 0),
        open: asNumber(raw.open, 0),
        description: asString(raw.description),
        registered: raw.registered !== false,
      }
    })
    .filter((r): r is SignalTagRow => r !== null)
}

/** Add a tag to the tenant vocabulary before any thread uses it. */
export async function createSignalTag(
  token: string,
  name: string,
  description = '',
): Promise<string> {
  const payload = await apiPost<{ tag?: string }>(
    appRoutes.signals.tags,
    { name, description },
    token,
  )
  notifySignalTagsChanged()
  return asString(payload.tag) || name.trim().toLowerCase()
}

export async function renameSignalTag(token: string, tag: string, newTag: string): Promise<number> {
  const payload = await apiPatch<{ changed?: number }>(
    appRoutes.signals.tag(tag),
    { new_tag: newTag },
    token,
  )
  notifySignalTagsChanged()
  return asNumber(payload.changed, 0)
}

/** Set the "when to use this" guidance an operator and the AI both read. */
export async function describeSignalTag(
  token: string,
  tag: string,
  description: string,
): Promise<void> {
  await apiPatch<unknown>(appRoutes.signals.tag(tag), { description }, token)
  notifySignalTagsChanged()
}

export async function deleteSignalTag(token: string, tag: string): Promise<number> {
  const payload = await apiDelete<{ changed?: number }>(appRoutes.signals.tag(tag), token)
  notifySignalTagsChanged()
  return asNumber(payload?.changed, 0)
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
  if (input.cc?.trim()) body.cc = input.cc.trim()
  if (input.bcc?.trim()) body.bcc = input.bcc.trim()
  if (input.sendAfterSeconds && input.sendAfterSeconds > 0) {
    body.send_after_seconds = input.sendAfterSeconds
  }
  const payload = await apiPost<unknown>(appRoutes.signals.threadReply(threadId), body, token)
  return normalizeSignalMessage(payload)
}

/** Soft undo: cancel a scheduled outbound message before delivery. */
export async function cancelScheduledMessage(
  token: string,
  messageId: string,
): Promise<{ signal_id?: string; body_text?: string } | null> {
  return apiPost<{ signal_id?: string; body_text?: string }>(
    appRoutes.signals.messageCancel(messageId),
    {},
    token,
  )
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

export async function updateSignalNote(
  token: string,
  threadId: string,
  messageId: string,
  bodyText: string,
): Promise<InboxMessage | null> {
  const payload = await apiPatch<unknown>(
    appRoutes.signals.note(threadId, messageId),
    { body_text: bodyText },
    token,
  )
  return normalizeSignalMessage(payload)
}

export async function deleteSignalNote(
  token: string,
  threadId: string,
  messageId: string,
): Promise<void> {
  await apiDelete<unknown>(appRoutes.signals.note(threadId, messageId), token)
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

// ---------------------------------------------------------------------------
// Inbox rules (learned per-sender automation)
// ---------------------------------------------------------------------------

export type InboxRule = {
  id: string
  matchType: 'sender' | 'domain' | 'list_id'
  matchValue: string
  label: string
  action: 'auto_close' | 'auto_task' | 'mute_ai'
  status: 'suggested' | 'active' | 'paused'
  source: 'learned' | 'manual'
  observations: number
  promotionThreshold: number
  hitCount: number
  lastHitAt: string | null
  createdAt: string
  updatedAt: string
}

export type InboxRuleSuggestion = InboxRule & {
  readyToActivate: boolean
  autoPromoted: boolean
}

export function normalizeInboxRule(raw: unknown): InboxRule | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (typeof row.id !== 'string') return null
  const matchType = row.match_type
  const action = row.action
  if (matchType !== 'sender' && matchType !== 'domain' && matchType !== 'list_id') return null
  if (action !== 'auto_close' && action !== 'auto_task' && action !== 'mute_ai') return null
  const status = row.status
  return {
    id: row.id,
    matchType,
    matchValue: typeof row.match_value === 'string' ? row.match_value : '',
    label: typeof row.label === 'string' ? row.label : '',
    action,
    status: status === 'active' || status === 'paused' ? status : 'suggested',
    source: row.source === 'manual' ? 'manual' : 'learned',
    observations: typeof row.observations === 'number' ? row.observations : 0,
    promotionThreshold:
      typeof row.promotion_threshold === 'number' ? row.promotion_threshold : 3,
    hitCount: typeof row.hit_count === 'number' ? row.hit_count : 0,
    lastHitAt: typeof row.last_hit_at === 'string' ? row.last_hit_at : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
  }
}

export function normalizeRuleSuggestion(raw: unknown): InboxRuleSuggestion | null {
  const rule = normalizeInboxRule(raw)
  if (!rule) return null
  const row = raw as Record<string, unknown>
  return {
    ...rule,
    readyToActivate: row.ready_to_activate === true,
    autoPromoted: row.auto_promoted === true,
  }
}

export async function listInboxRules(token: string): Promise<InboxRule[]> {
  const payload = await apiGet<unknown>(appRoutes.signals.rules, token)
  const source = Array.isArray(payload) ? payload : []
  return source
    .map(normalizeInboxRule)
    .filter((rule): rule is InboxRule => rule !== null)
}

export async function createInboxRule(
  token: string,
  input: {
    matchType: InboxRule['matchType']
    matchValue: string
    action: InboxRule['action']
    label?: string
  },
): Promise<InboxRule | null> {
  const payload = await apiPost<unknown>(
    appRoutes.signals.rules,
    {
      match_type: input.matchType,
      match_value: input.matchValue,
      action: input.action,
      label: input.label ?? '',
    },
    token,
  )
  return normalizeInboxRule(payload)
}

export async function updateInboxRule(
  token: string,
  ruleId: string,
  patch: { action?: InboxRule['action']; status?: 'active' | 'paused'; label?: string },
): Promise<InboxRule | null> {
  const payload = await apiPatch<unknown>(
    appRoutes.signals.rule(ruleId),
    {
      ...(patch.action !== undefined ? { action: patch.action } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.label !== undefined ? { label: patch.label } : {}),
    },
    token,
  )
  return normalizeInboxRule(payload)
}

export async function deleteInboxRule(token: string, ruleId: string): Promise<void> {
  await apiDelete(appRoutes.signals.rule(ruleId), token)
}

export type ResolveDecisionResult = {
  ruleSuggestion: InboxRuleSuggestion | null
  taskId?: string | null
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
    /** Sender identity for approved reply suggestions. */
    sendAs?: 'user' | 'agent'
  },
): Promise<ResolveDecisionResult> {
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
  if (opts?.sendAs) payload.send_as = opts.sendAs
  const response = await apiPost<Record<string, unknown>>(
    appRoutes.signals.messageResolve(threadId, messageId),
    payload,
    token,
  )
  return {
    ruleSuggestion: normalizeRuleSuggestion(
      response && typeof response === 'object' ? response.rule_suggestion : null,
    ),
    taskId:
      response && typeof response === 'object' && typeof response.task_id === 'string'
        ? response.task_id
        : null,
  }
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
        uuid: asString(raw.uuid),
        name: asString(raw.name, `User ${id}`),
        email: asString(raw.email),
        avatarUrl: typeof raw.avatar_url === 'string' && raw.avatar_url ? raw.avatar_url : null,
        role: asString(raw.role) || null,
      }
    })
    .filter((m): m is InboxMember => m !== null)
}

export type SignalBadgeCounts = {
  inbox_unread: number
  inbox_by_queue: { my: number; unassigned: number; all: number }
  agents_attention: number
  no_reply_suggestions: number
}

export async function fetchSignalBadgeCounts(token: string): Promise<SignalBadgeCounts> {
  const raw = await apiGet<Partial<SignalBadgeCounts> & Record<string, unknown>>(
    appRoutes.signals.badgeCounts,
    token,
  )
  const queue = (raw.inbox_by_queue as SignalBadgeCounts['inbox_by_queue'] | undefined) ?? {
    my: 0,
    unassigned: 0,
    all: 0,
  }
  return {
    inbox_unread: Number(raw.inbox_unread ?? 0),
    inbox_by_queue: {
      my: Number(queue.my ?? 0),
      unassigned: Number(queue.unassigned ?? 0),
      all: Number(queue.all ?? 0),
    },
    agents_attention: Number(raw.agents_attention ?? 0),
    no_reply_suggestions: Number(raw.no_reply_suggestions ?? 0),
  }
}

export async function dismissNoReplySuggestions(
  token: string,
  opts?: { alsoClose?: boolean },
): Promise<{ ok: boolean; dismissed: number; closed: number }> {
  const qs = opts?.alsoClose ? '?also_close=true' : ''
  return apiPost(appRoutes.signals.dismissNoReplySuggestions + qs, {}, token)
}
