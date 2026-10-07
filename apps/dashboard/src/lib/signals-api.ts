import { appRoutes } from '../api/routes/app.routes'
import type { AgentSummary } from './workforce-api'
import {
  APP_API_BASE,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  appScopedGet,
  buildAuthHeaders,
} from './api'
import { normalizeDelivery, normalizeMyFeedback, normalizeThreadRow } from './inbox-api'
import { normalizeMessageActivity, type ActivityItem } from './agentActivity'
import { normalizeAiHandling } from './ai-handling'
import { plainChatText } from './chatText'
import type {
  InboxEvent,
  InboxMember,
  InboxMessage,
  InboxThread,
  PatchThreadInput,
  PagedThreadResult,
  RelatedConversation,
  ReplyInput,
  ThreadDetail,
  ThreadFilters,
} from './inbox-api'
import { parsePresenceStatus, type PresenceStatus } from './teams-api'

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
    hasHtml:
      raw.has_html === true ||
      (typeof raw.body_html === 'string' && raw.body_html.trim().length > 0),
    graphMessageId: asString(raw.graph_message_id ?? raw.external_id),
    inReplyTo: null,
    authorUserId:
      raw.author_user_id == null || raw.author_user_id === 0 ? null : asNumber(raw.author_user_id),
    isRead: Boolean(raw.is_read),
    ...normalizeDelivery(raw),
    attachments: Array.isArray(raw.attachments) ? raw.attachments : null,
    decisionId: raw.decision_id ? asString(raw.decision_id) : null,
    payload: raw.payload && typeof raw.payload === 'object' ? (raw.payload as Record<string, unknown>) : {},
    myFeedback: normalizeMyFeedback(raw),
    ...normalizeMessageActivity(raw),
    receivedAt: asNullableTimestampString(raw.received_at),
    createdAt: asString(raw.created_at),
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
  if (filters.teamId) params.set('team_id', filters.teamId)
  if (filters.projectId) params.set('project_id', filters.projectId)
  if (filters.tag) params.set('tag', filters.tag)
  if (filters.categoryId) params.set('category_id', filters.categoryId)
  if (filters.stage) params.set('stage', filters.stage)
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
    items: itemsSource.map(normalizeThreadRow).filter((t): t is InboxThread => t !== null),
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

/** Full message payload (HTML + agent_trace) for lazy expand on the timeline. */
export async function getSignalMessage(
  token: string,
  threadId: string,
  messageId: string,
): Promise<InboxMessage | null> {
  const payload = await apiGet<unknown>(
    appRoutes.signals.threadMessage(threadId, messageId),
    token,
  )
  return normalizeSignalMessage(payload)
}

export async function getSignalThread(
  token: string,
  threadId: string,
  opts?: { limit?: number; before?: string },
): Promise<ThreadDetail | null> {
  const params = new URLSearchParams()
  if (opts?.limit != null) params.set('limit', String(opts.limit))
  if (opts?.before) params.set('before', opts.before)
  const qs = params.toString()
  const path = qs
    ? `${appRoutes.signals.thread(threadId)}?${qs}`
    : appRoutes.signals.thread(threadId)
  const payload = await apiGet<{
    thread?: unknown
    messages?: unknown[]
    events?: unknown[]
    sessions?: unknown[]
    csat?: { score?: unknown; comment?: unknown; created_at?: unknown } | null
    has_older?: unknown
    oldest_message_id?: unknown
    related_conversations?: unknown[]
  }>(path, token)
  const thread = normalizeThreadRow(payload.thread)
  if (!thread) return null
  const relatedConversations: RelatedConversation[] = (payload.related_conversations ?? [])
    .map((raw): RelatedConversation | null => {
      if (!raw || typeof raw !== 'object') return null
      const row = raw as Record<string, unknown>
      if (typeof row.id !== 'string' || !row.id) return null
      return {
        id: row.id,
        channel: typeof row.channel === 'string' ? row.channel : '',
        subject: typeof row.subject === 'string' ? row.subject : '',
        status: typeof row.status === 'string' ? row.status : 'open',
        lastMessageAt: typeof row.last_message_at === 'string' ? row.last_message_at : null,
        lastMessageDirection:
          row.last_message_direction === 'inbound' || row.last_message_direction === 'outbound'
            ? row.last_message_direction
            : '',
        lastMessagePreview: typeof row.last_message_preview === 'string' ? row.last_message_preview : '',
        hasOpenProposal: Boolean(row.has_open_proposal),
      }
    })
    .filter((row): row is RelatedConversation => row !== null)
  const csat =
    payload.csat && typeof payload.csat.score === 'number'
      ? {
          score: payload.csat.score,
          comment: typeof payload.csat.comment === 'string' ? payload.csat.comment : '',
          created_at: typeof payload.csat.created_at === 'string' ? payload.csat.created_at : '',
        }
      : null
  const messages = (payload.messages ?? [])
    .map(normalizeSignalMessage)
    .filter((m): m is InboxMessage => m !== null)
  return {
    thread,
    messages,
    events: (payload.events ?? []).map(normalizeSignalEvent).filter((e): e is InboxEvent => e !== null),
    sessions: (payload.sessions ?? [])
      .map(normalizeThreadSession)
      .filter((s): s is ThreadSession => s !== null),
    csat,
    hasOlder: Boolean(payload.has_older),
    oldestMessageId:
      typeof payload.oldest_message_id === 'string'
        ? payload.oldest_message_id
        : messages[0]
          ? String(messages[0].id)
          : null,
    relatedConversations,
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
  if (patch.assignee !== undefined) {
    body.assignee = {
      kind: patch.assignee.kind,
      id: patch.assignee.id ?? null,
      ...(patch.assignee.message ? { message: patch.assignee.message } : {}),
    }
  }
  if (patch.tags !== undefined) body.tags = patch.tags
  if (patch.priority !== undefined) body.priority = patch.priority
  if (patch.projectId !== undefined) body.project_id = patch.projectId
  if (patch.snoozedUntil !== undefined) body.snoozed_until = patch.snoozedUntil
  if (patch.followUpAt !== undefined) body.follow_up_at = patch.followUpAt
  if (patch.followUpTitle !== undefined) body.follow_up_title = patch.followUpTitle
  const payload = await apiPatch<unknown>(appRoutes.signals.thread(threadId), body, token)
  return normalizeThreadRow(payload)
}

export async function bulkUpdateSignalThreads(
  token: string,
  signalIds: string[],
  action: 'close' | 'reopen' | 'spam' | 'read' | 'unread' | 'assign' | 'snooze' | 'trash',
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

export async function deleteSignalThread(token: string, threadId: string): Promise<void> {
  await apiDelete<unknown>(appRoutes.signals.threadDelete(threadId), token)
}

export async function markSignalThreadRead(token: string, threadId: string): Promise<InboxThread | null> {
  const payload = await apiPatch<unknown>(appRoutes.signals.threadMarkRead(threadId), {}, token)
  return normalizeThreadRow(payload)
}

export async function markSignalThreadUnread(token: string, threadId: string): Promise<InboxThread | null> {
  const payload = await apiPatch<unknown>(appRoutes.signals.threadMarkUnread(threadId), {}, token)
  return normalizeThreadRow(payload)
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

/** Move the messages from `fromMessageId` on into a new linked conversation. */
export async function splitSignalThread(
  token: string,
  threadId: string,
  input: { fromMessageId: string; categoryId?: string | null },
): Promise<{ signal_id: string; parent_signal_id: string }> {
  return apiPost<{ signal_id: string; parent_signal_id: string }>(
    appRoutes.signals.threadSplit(threadId),
    { from_message_id: input.fromMessageId, category_id: input.categoryId || null },
    token,
  )
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
  if (input.channelAccountId?.trim()) {
    body.channel_account_id = input.channelAccountId.trim()
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
  action: 'auto_close' | 'auto_task' | 'mute_ai' | 'tag'
  /** Tags the rule adds to matching conversations. */
  tags: string[]
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
  if (action !== 'auto_close' && action !== 'auto_task' && action !== 'mute_ai' && action !== 'tag') {
    return null
  }
  const status = row.status
  return {
    id: row.id,
    matchType,
    matchValue: typeof row.match_value === 'string' ? row.match_value : '',
    label: typeof row.label === 'string' ? row.label : '',
    action,
    tags: Array.isArray(row.labels) ? row.labels.filter((t): t is string => typeof t === 'string') : [],
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
    tags?: string[]
  },
): Promise<InboxRule | null> {
  const payload = await apiPost<unknown>(
    appRoutes.signals.rules,
    {
      match_type: input.matchType,
      match_value: input.matchValue,
      action: input.action,
      label: input.label ?? '',
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
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

export type SignalTag = {
  id: string
  name: string
  description: string
  /** Conversations carrying the tag (as a link or as their category). */
  count: number
  /** Has a playbook: filing it makes the conversation a ticket. */
  isCategory: boolean
  workstreamId: string | null
  workstreamName: string | null
  /** Free tag shown in the Communication rail. */
  pinned: boolean
  /** Action tag shown in the Communication rail. */
  showInNav: boolean
  /** When false, triage does not offer or apply this tag. */
  aiAutoTag: boolean
}

function normalizeSignalTag(raw: unknown): SignalTag | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.name !== 'string') return null
  return {
    id: row.id,
    name: row.name,
    description: typeof row.description === 'string' ? row.description : '',
    count: typeof row.count === 'number' ? row.count : 0,
    isCategory: row.is_category === true,
    workstreamId: typeof row.workstream_id === 'string' ? row.workstream_id : null,
    workstreamName: typeof row.workstream_name === 'string' ? row.workstream_name : null,
    pinned: row.pinned === true,
    showInNav: row.show_in_nav === true,
    aiAutoTag: row.ai_auto_tag !== false,
  }
}

export async function listSignalTags(token: string): Promise<SignalTag[]> {
  const payload = await apiGet<unknown>(appRoutes.signals.tags, token)
  return (Array.isArray(payload) ? payload : [])
    .map(normalizeSignalTag)
    .filter((tag): tag is SignalTag => tag !== null)
}

export async function createSignalTag(
  token: string,
  input: { name: string; description?: string; pinned?: boolean },
): Promise<SignalTag | null> {
  const payload = await apiPost<unknown>(
    appRoutes.signals.tags,
    { name: input.name, description: input.description ?? '', pinned: input.pinned ?? false },
    token,
  )
  return normalizeSignalTag(payload)
}

/** Rename, describe, pin or show a tag. Renaming onto an existing free tag merges the two. */
export async function updateSignalTag(
  token: string,
  tagId: string,
  patch: {
    name?: string
    description?: string
    pinned?: boolean
    show_in_nav?: boolean
    ai_auto_tag?: boolean
  },
): Promise<SignalTag | null> {
  const payload = await apiPatch<unknown>(appRoutes.signals.tag(tagId), patch, token)
  return normalizeSignalTag(payload)
}

export async function deleteSignalTag(token: string, tagId: string): Promise<void> {
  await apiDelete(appRoutes.signals.tag(tagId), token)
}

/** Conversation list filters a rail row or deep link may set. */
export const LIST_FILTER_KEYS = ['project_id', 'category_id', 'tag', 'stage'] as const
export type ListFilterKey = (typeof LIST_FILTER_KEYS)[number]
export type ListFilter = Partial<Record<ListFilterKey, string>>

/** Read the list filter from a Communication URL's query string. */
export function listFilterFromParams(params: URLSearchParams): ListFilter {
  const out: ListFilter = {}
  for (const key of LIST_FILTER_KEYS) {
    const value = params.get(key)?.trim()
    if (value) out[key] = value
  }
  return out
}

/** `?project_id=…&tag=…` for a list filter, or an empty string. */
export function listFilterQuery(filter: ListFilter): string {
  const params = new URLSearchParams()
  for (const key of LIST_FILTER_KEYS) {
    const value = filter[key]
    if (value) params.set(key, value)
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

export type NavRow = { id: string; name: string; count: number }

/** Communication rail beyond channels, with open counts. */
export type CommunicationNav = {
  /** Categories with show_in_nav. */
  ticketTags: NavRow[]
  /** Pinned free tags. */
  tags: NavRow[]
  projects: NavRow[]
}

function normalizeNavRows(raw: unknown): NavRow[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || typeof row.name !== 'string') return []
    return [{ id: row.id, name: row.name, count: typeof row.count === 'number' ? row.count : 0 }]
  })
}

export async function getCommunicationNav(token: string): Promise<CommunicationNav> {
  const payload = await apiGet<Record<string, unknown>>(appRoutes.signals.nav, token)
  return {
    ticketTags: normalizeNavRows(payload?.ticket_tags),
    tags: normalizeNavRows(payload?.tags),
    projects: normalizeNavRows(payload?.projects),
  }
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
    /** Chat bubbles of an approved reply (one customer message each). */
    messages?: string[]
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
  if (opts?.messages?.length) payload.messages = opts.messages
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
        presence: raw.presence === 'available' || raw.presence === 'away' ? raw.presence : 'offline',
      }
    })
    .filter((m): m is InboxMember => m !== null)
}

/** Why someone cannot take this conversation; empty when they can. */
export type AssigneeBlockReason = '' | 'no_channel_access'

export type AssigneeAvatarFields = {
  avatarKind?: string | null
  avatarIcon?: string | null
  avatarColor?: string | null
  avatarImageUrl?: string | null
}

export type AssigneeCandidates = {
  people: Array<InboxMember & { canHandle: boolean; reason: AssigneeBlockReason }>
  agents: Array<
    {
      id: string
      name: string
      canHandle: boolean
      reason: AssigneeBlockReason
      status: 'standby' | 'working' | 'error'
    } & AssigneeAvatarFields
  >
  teams: Array<
    {
      id: string
      name: string
      kind: 'people' | 'agents' | 'custom'
      canHandle: boolean
      presence?: PresenceStatus
    } & AssigneeAvatarFields
  >
}

/** People, agents and teams this conversation can go to (assign picker and @mentions). */
export async function listSignalAssignees(token: string, threadId: string): Promise<AssigneeCandidates> {
  const payload = await apiGet<Record<string, unknown>>(appRoutes.signals.threadAssignees(threadId), token)
  const rows = (value: unknown) =>
    (Array.isArray(value) ? value : []).filter(
      (row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object',
    )
  const reason = (value: unknown): AssigneeBlockReason => (value === 'no_channel_access' ? value : '')
  return {
    people: rows(payload.people).map((raw) => {
      const id = asNumber(raw.id, 0)
      return {
        id,
        uuid: asString(raw.uuid),
        name: asString(raw.name, `User ${id}`),
        email: asString(raw.email),
        avatarUrl: typeof raw.avatar_url === 'string' && raw.avatar_url ? raw.avatar_url : null,
        role: null,
        presence: raw.presence === 'available' || raw.presence === 'away' ? raw.presence : 'offline',
        canHandle: raw.can_handle !== false,
        reason: reason(raw.reason),
      }
    }),
    agents: rows(payload.agents).map((raw) => {
      const statusRaw = String(raw.status || '')
        .trim()
        .toLowerCase()
      const status =
        statusRaw === 'working'
          ? ('working' as const)
          : statusRaw === 'error'
            ? ('error' as const)
            : ('standby' as const)
      return {
        id: asString(raw.id),
        name: asString(raw.name),
        canHandle: raw.can_handle !== false,
        reason: reason(raw.reason),
        status,
        avatarKind: typeof raw.avatar_kind === 'string' ? raw.avatar_kind : null,
        avatarIcon: typeof raw.avatar_icon === 'string' ? raw.avatar_icon : null,
        avatarColor: typeof raw.avatar_color === 'string' ? raw.avatar_color : null,
        avatarImageUrl: typeof raw.avatar_image_url === 'string' ? raw.avatar_image_url : null,
      }
    }),
    teams: rows(payload.teams).map((raw) => {
      const presenceRaw = raw.presence && typeof raw.presence === 'object'
        ? (raw.presence as Record<string, unknown>).status
        : raw.presence
      return {
        id: asString(raw.id),
        name: asString(raw.name),
        kind: raw.kind === 'people' || raw.kind === 'agents' ? raw.kind : 'custom',
        canHandle: raw.can_handle !== false,
        presence: parsePresenceStatus(presenceRaw),
        avatarKind: typeof raw.avatar_kind === 'string' ? raw.avatar_kind : null,
        avatarIcon: typeof raw.avatar_icon === 'string' ? raw.avatar_icon : null,
        avatarColor: typeof raw.avatar_color === 'string' ? raw.avatar_color : null,
        avatarImageUrl: typeof raw.avatar_image_url === 'string' ? raw.avatar_image_url : null,
      }
    }),
  }
}

export type SignalBadgeCounts = {
  inbox_unread: number
  inbox_by_queue: { for_you: number; for_you_unread: number; unassigned: number; all: number }
  /** Pinned team id → open work waiting on that team. */
  by_team: Record<string, number>
  agents_attention: number
  no_reply_suggestions: number
  agenda_due: number
}

export async function fetchSignalBadgeCounts(token: string): Promise<SignalBadgeCounts> {
  const raw = await apiGet<Partial<SignalBadgeCounts> & Record<string, unknown>>(
    appRoutes.signals.badgeCounts,
    token,
  )
  const queue = (raw.inbox_by_queue as Partial<SignalBadgeCounts['inbox_by_queue']> | undefined) ?? {}
  const byTeamRaw = raw.by_team && typeof raw.by_team === 'object' ? (raw.by_team as Record<string, unknown>) : {}
  return {
    inbox_unread: Number(raw.inbox_unread ?? 0),
    inbox_by_queue: {
      for_you: Number(queue.for_you ?? 0),
      for_you_unread: Number(queue.for_you_unread ?? 0),
      unassigned: Number(queue.unassigned ?? 0),
      all: Number(queue.all ?? 0),
    },
    by_team: Object.fromEntries(Object.entries(byTeamRaw).map(([k, v]) => [k, Number(v ?? 0)])),
    agents_attention: Number(raw.agents_attention ?? 0),
    no_reply_suggestions: Number(raw.no_reply_suggestions ?? 0),
    agenda_due: Number(raw.agenda_due ?? 0),
  }
}

export async function dismissNoReplySuggestions(
  token: string,
  opts?: { alsoClose?: boolean },
): Promise<{ ok: boolean; dismissed: number; closed: number }> {
  const qs = opts?.alsoClose ? '?also_close=true' : ''
  return apiPost(appRoutes.signals.dismissNoReplySuggestions + qs, {}, token)
}

// ---------------------------------------------------------------------------
// Assistant conversations (direct chats with company agents; a conversation
// is a Signal with channel="assistant" served by /signals/conversations)
// ---------------------------------------------------------------------------

export type Conversation = {
  id: string
  title: string
  channel?: string
  audience?: string
  /** Conversation-level override only (assistant conversations). */
  ai_handling?: string | null
  updated_at: string
}

/** A conversation row enriched with the agent it targets. */
export type ConversationWithAgent = Conversation & {
  agent_id?: string | null
  agent_name?: string | null
  /** Company agents only going forward; `personal` may still appear on legacy rows. */
  agent_kind?: 'company' | 'personal' | null
}

/** A chat target: a company agent the user is permitted to message. */
export type ChatTarget = AgentSummary & {
  kind: 'company'
  is_default: boolean
}

export type ChatDecisionOption = {
  id: string
  label?: string
  action_type?: string
  /** Full option payload; structured proposals (accounting, calendar) render from it. */
  payload?: Record<string, unknown> | null
  /** Integration provider slug on `setup_integration` options (brand logo + deep-link). */
  provider?: string | null
  /** Module slug when the card should open `/connections/:slug`. */
  module?: string | null
}

export type ChatDecision = {
  id: string
  status: string
  title?: string | null
  summary?: string | null
  options: ChatDecisionOption[]
  chosen_option_id?: string | null
  resolved_at?: string | null
}

export type ChatMessage = {
  id: string
  role: string
  kind?: string
  content: string
  created_at?: string
  decision_request_id?: string | null
  decision?: ChatDecision | null
  certainty?: number | null
  auto_sent?: boolean
  attachments?: unknown[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
  }
  /** Activity before this bubble (raw API items; see `normalizeActivity`). */
  activity?: ActivityItem[] | unknown[]
  /** Activity after the last bubble of a turn. */
  activity_after?: ActivityItem[] | unknown[]
  turn_id?: string | null
}

export async function bokitoListChatTargets(token: string) {
  return apiGet<{ items: ChatTarget[]; default_agent_id: string | null }>(
    appRoutes.signals.chatTargets,
    token,
  )
}

export async function bokitoListConversations(
  token: string,
  channel?: string,
  options?: {
    /** Thread source, e.g. "personal" for the user's own Bokito helper threads.
     * Omitted, personal threads are excluded from the agent chat list. */
    source?: string
  },
) {
  const params = new URLSearchParams()
  if (channel) params.set('channel', channel)
  if (options?.source) params.set('source', options.source)
  const path = [...params.keys()].length
    ? appRoutes.signals.conversationsQuery(params)
    : appRoutes.signals.conversations
  return apiGet<ConversationWithAgent[]>(path, token)
}

/** Bokito helper threads for this user, across every workspace they belong to. */
export async function bokitoListAssistantThreads(token: string) {
  return appScopedGet<{ items: PersonalAssistantThread[] }>(
    appRoutes.assistant.threads,
    token,
  )
}

export type PersonalAssistantThread = {
  id: string
  title: string
  workspace_id: string
  workspace_slug: string
  workspace_name: string
  updated_at: string | null
}

export async function bokitoCreateConversation(
  token: string,
  title = 'New conversation',
  agentId?: string | null,
  options?: {
    /** Ground the conversation in a customer thread (Ask assistant). */
    contextSignalId?: string
  },
) {
  const body: Record<string, unknown> = { title }
  if (agentId) body.agent_id = agentId
  if (options?.contextSignalId) body.context_signal_id = options.contextSignalId
  return apiPost<{
    id: string
    title: string
    channel: string
    agent_id?: string
    agent_name?: string
    agent_kind?: string
  }>(appRoutes.signals.conversations, body, token)
}

export async function bokitoRenameConversation(token: string, conversationId: string, title: string) {
  return apiPatch<{ id: string; title: string }>(
    appRoutes.signals.conversation(conversationId),
    { title },
    token,
  )
}

export async function bokitoDeleteConversation(token: string, conversationId: string) {
  return apiDelete<{ ok: boolean }>(appRoutes.signals.conversation(conversationId), token)
}

export async function bokitoListMessages(token: string, conversationId: string) {
  const data = await apiGet<ChatMessage[] | { items?: ChatMessage[] }>(
    appRoutes.signals.conversationMessages(conversationId),
    token,
  )
  if (Array.isArray(data)) return data
  return Array.isArray(data?.items) ? data.items : []
}

export async function bokitoSendMessage(
  token: string,
  conversationId: string,
  content: string,
  options?: {
    /** What the operator is looking at (route + entity), for the in-app assistant. */
    pageContext?: string
  },
) {
  const body: Record<string, unknown> = { content }
  if (options?.pageContext) body.page_context = options.pageContext
  return apiPost<{ message: ChatMessage }>(
    appRoutes.signals.conversationMessages(conversationId),
    body,
    token,
  )
}

/**
 * Send a message and stream the assistant reply over SSE.
 * Calls `onDelta` for each text chunk; optional `onThinking` for reasoning deltas.
 * Throws with message `agent_busy` when another run is already in flight (409).
 */
export async function bokitoStreamMessage(
  token: string,
  conversationId: string,
  content: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  onThinking?: (text: string) => void,
  options?: {
    /** What the operator is looking at (route + entity), for the in-app assistant. */
    pageContext?: string
  },
): Promise<string> {
  const payload: Record<string, unknown> = { content }
  if (options?.pageContext) payload.page_context = options.pageContext
  const res = await fetch(
    `${APP_API_BASE}${appRoutes.signals.conversationStream(conversationId)}`,
    {
      method: 'POST',
      headers: buildAuthHeaders(token),
      credentials: 'include',
      body: JSON.stringify(payload),
      signal,
    },
  )
  if (res.status === 409) {
    throw new Error('agent_busy')
  }
  if (!res.ok || !res.body) throw new Error(await res.text())

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalText = ''
  let eventName = ''

  const handleEvent = (name: string, data: string) => {
    try {
      const payload = JSON.parse(data) as { text?: string }
      if (name === 'thinking' && payload.text) {
        onThinking?.(payload.text)
      } else if (name === 'delta' && payload.text) {
        onDelta(payload.text)
      } else if (name === 'done') {
        finalText = payload.text ?? finalText
      }
    } catch {
      // skip malformed frames
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx = buffer.indexOf('\n')
    while (idx !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, '')
      buffer = buffer.slice(idx + 1)
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        handleEvent(eventName, line.slice(5).trim())
      } else if (line === '') {
        eventName = ''
      }
      idx = buffer.indexOf('\n')
    }
  }
  return finalText
}

/** Cooperative cancel for the in-flight chat run on a conversation. */
export async function bokitoCancelConversation(
  token: string,
  conversationId: string,
): Promise<void> {
  await fetch(`${APP_API_BASE}${appRoutes.signals.conversationCancel(conversationId)}`, {
    method: 'POST',
    headers: buildAuthHeaders(token),
    credentials: 'include',
  })
}
