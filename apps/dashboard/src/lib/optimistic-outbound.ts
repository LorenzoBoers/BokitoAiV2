/**
 * Client-side outbound bubbles shown before the reply HTTP returns.
 * Ids use the `local:` prefix so quiet refetches and gateway events can
 * reconcile them without colliding with server UUIDs.
 */

import type { InboxMessage, MessageAttachment, ReplyInput, SendStatus } from './inbox-api'

export const LOCAL_OUTBOUND_PREFIX = 'local:'

export function isLocalOutboundId(id: string | number | null | undefined): boolean {
  return String(id ?? '').startsWith(LOCAL_OUTBOUND_PREFIX)
}

export type OptimisticReplyExtras = {
  format?: ReplyInput['format']
  cc?: string
  bcc?: string
  channelAccountId?: string
  to?: string
  mode?: ReplyInput['mode']
  sourceMessageId?: string
  subject?: string
  quotedHtml?: string
  sendAfterSeconds?: number
  action?: ReplyInput['action']
  snoozeMinutes?: number
}

/** Payload keys stashed on the optimistic bubble for retry. */
export const OPTIMISTIC_REPLY_KEY = 'optimistic_reply'

export function buildOptimisticOutbound(args: {
  threadId: string
  bodyText: string
  bodyHtml?: string
  authorUserId: number | null
  attachments?: MessageAttachment[]
  extras?: OptimisticReplyExtras
}): InboxMessage {
  const now = new Date().toISOString()
  const id = `${LOCAL_OUTBOUND_PREFIX}${crypto.randomUUID()}`
  const text = args.bodyText.trim()
  return {
    id,
    threadId: args.threadId,
    connectionId: null,
    kind: 'user_message',
    direction: 'outbound',
    fromAddress: '',
    toAddresses: '',
    subject: args.extras?.subject ?? '',
    bodyPreview: text.slice(0, 200),
    bodyText: text,
    bodyHtml: args.bodyHtml ?? (text ? `<p>${escapeHtml(text).replace(/\n/g, '<br/>')}</p>` : null),
    graphMessageId: '',
    inReplyTo: null,
    authorUserId: args.authorUserId,
    isRead: true,
    sendStatus: 'sending',
    deliveredToCustomer: false,
    attachments: args.attachments ?? null,
    payload: {
      [OPTIMISTIC_REPLY_KEY]: {
        bodyText: text,
        bodyHtml: args.bodyHtml,
        attachments: args.attachments,
        ...args.extras,
      } satisfies OptimisticReplyExtras & {
        bodyText: string
        bodyHtml?: string
        attachments?: MessageAttachment[]
      },
    },
    receivedAt: now,
    createdAt: now,
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function readOptimisticReply(
  message: InboxMessage,
): (OptimisticReplyExtras & { bodyText: string; bodyHtml?: string; attachments?: MessageAttachment[] }) | null {
  const raw = message.payload?.[OPTIMISTIC_REPLY_KEY]
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const bodyText = typeof o.bodyText === 'string' ? o.bodyText : message.bodyText ?? ''
  if (!bodyText.trim() && !(Array.isArray(o.attachments) && o.attachments.length)) return null
  return {
    bodyText,
    bodyHtml: typeof o.bodyHtml === 'string' ? o.bodyHtml : undefined,
    attachments: Array.isArray(o.attachments) ? (o.attachments as MessageAttachment[]) : undefined,
    format: o.format === 'email' || o.format === 'plain' ? o.format : undefined,
    cc: typeof o.cc === 'string' ? o.cc : undefined,
    bcc: typeof o.bcc === 'string' ? o.bcc : undefined,
    channelAccountId: typeof o.channelAccountId === 'string' ? o.channelAccountId : undefined,
    to: typeof o.to === 'string' ? o.to : undefined,
    mode:
      o.mode === 'reply' || o.mode === 'reply_all' || o.mode === 'forward' ? o.mode : undefined,
    sourceMessageId: typeof o.sourceMessageId === 'string' ? o.sourceMessageId : undefined,
    subject: typeof o.subject === 'string' ? o.subject : undefined,
    quotedHtml: typeof o.quotedHtml === 'string' ? o.quotedHtml : undefined,
    sendAfterSeconds: typeof o.sendAfterSeconds === 'number' ? o.sendAfterSeconds : undefined,
    action:
      o.action === 'send' || o.action === 'send_and_close' || o.action === 'send_and_pending'
        ? o.action
        : 'send',
    snoozeMinutes: typeof o.snoozeMinutes === 'number' ? o.snoozeMinutes : undefined,
  }
}

/** Drop local bubbles that the server has already confirmed (same author + body). */
export function dropMatchedLocals(
  messages: InboxMessage[],
  confirmed: InboxMessage,
): InboxMessage[] {
  if (confirmed.direction !== 'outbound') return messages
  const body = (confirmed.bodyText ?? '').trim()
  if (!body && !(confirmed.attachments && confirmed.attachments.length)) return messages
  return messages.filter((m) => {
    if (!isLocalOutboundId(m.id)) return true
    if (m.authorUserId != null && confirmed.authorUserId != null && m.authorUserId !== confirmed.authorUserId) {
      return true
    }
    return (m.bodyText ?? '').trim() !== body
  })
}

/** Keep in-flight / failed local bubbles across a quiet server refresh. */
export function keepPendingLocals(
  prev: InboxMessage[],
  next: InboxMessage[],
): InboxMessage[] {
  const pending = prev.filter((m) => {
    if (!isLocalOutboundId(m.id)) return false
    const status = m.sendStatus
    return status === 'sending' || (typeof status === 'string' && status.startsWith('failed'))
  })
  if (!pending.length) return next
  let merged = next
  for (const local of pending) {
    // If the server already has this send, drop the local copy.
    const confirmed = next.find(
      (m) =>
        m.direction === 'outbound' &&
        (m.bodyText ?? '').trim() === (local.bodyText ?? '').trim() &&
        (local.authorUserId == null ||
          m.authorUserId == null ||
          m.authorUserId === local.authorUserId),
    )
    if (confirmed) {
      merged = dropMatchedLocals(merged, confirmed)
      continue
    }
    if (!merged.some((m) => String(m.id) === String(local.id))) {
      merged = [...merged, local]
    }
  }
  return merged
}

export function patchLocalSendStatus(
  messages: InboxMessage[],
  localId: string,
  sendStatus: SendStatus,
): InboxMessage[] {
  return messages.map((m) => (String(m.id) === localId ? { ...m, sendStatus } : m))
}

export function replaceLocalWithServer(
  messages: InboxMessage[],
  localId: string,
  server: InboxMessage,
): InboxMessage[] {
  const without = messages.filter(
    (m) => String(m.id) !== localId && String(m.id) !== String(server.id),
  )
  return [...without, server]
}
