/**
 * Inline agent sessions render as ordinary timeline rows.
 *
 * A session is an assistant conversation attached to a customer thread. Its
 * messages live on the session signal, so the thread detail does not carry
 * them; this adapter maps the chat payload onto `InboxMessage` so the same
 * bubble renderer (stacking, activity trail, feedback) draws them next to the
 * customer mail. The `agent_session_id` payload key marks them internal.
 */
import type { InboxMessage } from './inbox-api'
import type { ChatMessage, ThreadSession } from './signals-api'
import { normalizeMessageActivity } from './agentActivity'

export const SESSION_PAYLOAD_KEY = 'agent_session_id'

export function sessionIdOf(message: Pick<InboxMessage, 'payload'>): string | null {
  const value = message.payload?.[SESSION_PAYLOAD_KEY]
  return typeof value === 'string' && value ? value : null
}

export function isSessionMessage(message: Pick<InboxMessage, 'payload'>): boolean {
  return sessionIdOf(message) !== null
}

type SessionRef = Pick<ThreadSession, 'id' | 'agentId'>

/**
 * The chat API serialises `created_at` without a zone (naive UTC), while
 * thread messages carry an offset. Normalise so the rows sort and render on
 * the same clock as the customer mail around them.
 */
export function sessionTimestampToIso(value: string | null | undefined): string {
  if (!value) return new Date().toISOString()
  const raw = value.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`
  const ms = new Date(raw).getTime()
  return Number.isFinite(ms) ? new Date(ms).toISOString() : value
}

/**
 * One chat message -> one timeline message. Operator turns become own
 * bubbles (right side); agent turns keep their activity trail and turn id so
 * the live view can hand off to the saved bubbles.
 */
export function sessionChatToInboxMessage(
  message: ChatMessage,
  session: SessionRef,
  currentUserId: number | null,
): InboxMessage {
  const isUser = message.role === 'user'
  const createdAt = sessionTimestampToIso(message.created_at)
  const activity = normalizeMessageActivity(message as unknown as Record<string, unknown>)
  return {
    id: message.id,
    // Feedback and detail fetches address the session signal, not the host.
    threadId: session.id,
    connectionId: null,
    kind: isUser ? 'user_message' : 'agent_message',
    direction: 'outbound',
    fromAddress: '',
    toAddresses: '',
    subject: '',
    bodyPreview: message.content.slice(0, 200),
    bodyText: message.content,
    bodyHtml: null,
    graphMessageId: '',
    inReplyTo: null,
    authorUserId: isUser ? currentUserId : null,
    isRead: true,
    sendStatus: null,
    attachments: message.attachments?.length ? message.attachments : null,
    payload: {
      [SESSION_PAYLOAD_KEY]: session.id,
      ...(session.agentId && !isUser ? { agent_id: session.agentId } : {}),
    },
    activity: activity.activity,
    activityAfter: activity.activityAfter,
    // The chat API already returns tool detail; nothing to load on expand.
    activityDetail: true,
    hasActivity: activity.hasActivity,
    turnId: activity.turnId ?? message.turn_id ?? null,
    receivedAt: createdAt,
    createdAt,
  }
}

/**
 * Persisted session transcript plus the operator bubbles that are still in
 * flight (optimistic). A persisted copy with the same text wins so the
 * optimistic one never sits next to it after the refresh.
 */
export function sessionTimelineMessages(
  session: SessionRef,
  persisted: ChatMessage[] | null | undefined,
  optimisticUsers: ChatMessage[],
  currentUserId: number | null,
): InboxMessage[] {
  const rows = (persisted ?? []).filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim(),
  )
  const persistedUserBodies = new Set(
    rows.filter((m) => m.role === 'user').map((m) => m.content.trim()),
  )
  const extras = optimisticUsers.filter(
    (m) => m.content.trim() && !persistedUserBodies.has(m.content.trim()),
  )
  return [...rows, ...extras].map((m) => sessionChatToInboxMessage(m, session, currentUserId))
}
