import type { InboxThread } from './inbox-api'
import { agentRunsPath, inboxPath } from './messages-paths'

/** Outbound surface aligned with how Intercom picks reply channel per conversation. */
export type ComposerChannel = 'email' | 'chat' | 'slack' | 'whatsapp' | 'internal' | 'assistant'

export type ComposerTab = 'reply' | 'note'

export type ComposerSurface = {
  channel: ComposerChannel
  defaultTab: ComposerTab
  tabs: ComposerTab[]
  replyLabel: string
  replyPlaceholder: string
  replyPlaceholderKey: string
  replyPlaceholderParams?: Record<string, string>
  /** Append mailbox signature + logo on send (email only). */
  includeSignature: boolean
  /** Show a read-only recipient row above the composer (email / some chat). */
  showRecipient: boolean
  recipientLabel: string
  recipientValue: string
}

const INTERNAL_CHANNELS = new Set(['internal', 'assistant'])

export function isInternalThread(thread: Pick<InboxThread, 'channel' | 'folder'>): boolean {
  const channel = thread.channel ?? 'email'
  return thread.folder === 'internal' || INTERNAL_CHANNELS.has(channel)
}

/** Prefer a customer conversation when auto-opening the inbox. */
export function pickPreferredInboxThread<
  T extends Pick<InboxThread, 'channel' | 'folder' | 'hasUnread'>,
>(threads: T[]): T | null {
  const customers = threads.filter((thread) => !isInternalThread(thread))
  const pool = customers.length > 0 ? customers : threads
  return pool.find((thread) => thread.hasUnread) ?? pool[0] ?? null
}

/** Keep All looking like a customer inbox: agent work stays visible, but below. */
export function customersFirst<T extends Pick<InboxThread, 'channel' | 'folder'>>(threads: T[]): T[] {
  const customers: T[] = []
  const internal: T[] = []
  for (const thread of threads) {
    if (isInternalThread(thread)) internal.push(thread)
    else customers.push(thread)
  }
  return [...customers, ...internal]
}

/** Open is customer work; agent runs live under Agent-runs. */
export function customersOnly<T extends Pick<InboxThread, 'channel' | 'folder'>>(threads: T[]): T[] {
  return threads.filter((thread) => !isInternalThread(thread))
}

/** Open work where the last real line is inbound, or the row is unread. */
export function threadNeedsReply(
  thread: Pick<InboxThread, 'status' | 'hasUnread' | 'lastMessageDirection'>,
): boolean {
  if (thread.status !== 'open') return false
  if (thread.hasUnread) return true
  return thread.lastMessageDirection === 'inbound'
}

/** Deep-link a thread to the hub leaf a first-time user expects. */
export function threadHubPath(thread: Pick<InboxThread, 'id' | 'channel' | 'folder'>): string {
  return isInternalThread(thread)
    ? agentRunsPath('all', String(thread.id))
    : inboxPath('open', String(thread.id))
}

/** Primary label for thread list rows and headers. */
export function threadCounterpartyName(thread: InboxThread): string {
  if (isInternalThread(thread)) {
    if (thread.agentName?.trim()) return thread.agentName.trim()
    const name = thread.contactName?.trim()
    if (name && name.toLowerCase() !== 'agent') return name
    return 'Agent'
  }
  return thread.contactName?.trim() || thread.contactEmail?.trim() || 'Unknown sender'
}

export function threadSecondaryLine(thread: InboxThread): string {
  if (isInternalThread(thread)) {
    return thread.emailSubject || '(No subject)'
  }
  return thread.emailSubject || ''
}

function mapSignalChannel(thread: InboxThread): ComposerChannel {
  const raw = (thread.channel ?? 'email').toLowerCase()
  if (raw === 'email') return 'email'
  if (raw === 'assistant') return 'assistant'
  if (raw === 'internal') return 'internal'
  if (raw === 'slack') return 'slack'
  if (raw === 'whatsapp') return 'whatsapp'
  if (raw === 'widget' || raw === 'chat' || raw === 'webchat' || raw === 'livechat' || raw === 'website') {
    return 'chat'
  }
  if (isInternalThread(thread)) return 'internal'
  if (thread.contactEmail?.trim()) return 'email'
  return 'chat'
}

/**
 * Derive composer tabs and defaults from thread channel + counterparty.
 * Mirrors Intercom: reply channel matches the conversation source; notes are always internal.
 */
export function resolveComposerSurface(thread: InboxThread): ComposerSurface {
  const channel = mapSignalChannel(thread)

  if (channel === 'internal' || channel === 'assistant') {
    const name = threadCounterpartyName(thread)
    return {
      channel,
      defaultTab: 'reply',
      tabs: ['reply', 'note'],
      replyLabel: channel === 'assistant' ? 'Chat' : 'Message',
      replyPlaceholder: `Message ${name}...`,
      replyPlaceholderKey: 'composer.placeholders.messageAgent',
      replyPlaceholderParams: { name },
      includeSignature: false,
      showRecipient: true,
      recipientLabel: channel === 'assistant' ? 'Assistant' : 'Agent',
      recipientValue: name,
    }
  }

  if (channel === 'email') {
    const email = thread.contactEmail?.trim() ?? ''
    const name = thread.contactName?.trim()
    return {
      channel: 'email',
      defaultTab: 'reply',
      tabs: ['reply', 'note'],
      replyLabel: 'Email',
      replyPlaceholder: email ? `Reply to ${email}...` : 'Type an email...',
      replyPlaceholderKey: email ? 'composer.placeholders.replyEmail' : 'composer.placeholders.typeEmail',
      replyPlaceholderParams: email ? { email } : undefined,
      includeSignature: true,
      showRecipient: Boolean(email || name),
      recipientLabel: 'To',
      recipientValue: name && email ? `${name} <${email}>` : email || name || '',
    }
  }

  if (channel === 'slack') {
    return {
      channel: 'slack',
      defaultTab: 'reply',
      tabs: ['reply', 'note'],
      replyLabel: 'Slack',
      replyPlaceholder: 'Type a Slack message...',
      replyPlaceholderKey: 'composer.placeholders.slack',
      includeSignature: false,
      showRecipient: Boolean(thread.contactName),
      recipientLabel: 'Channel',
      recipientValue: thread.contactName || 'Slack thread',
    }
  }

  if (channel === 'whatsapp') {
    const name = thread.contactName?.trim() || 'contact'
    return {
      channel: 'whatsapp',
      defaultTab: 'reply',
      tabs: ['reply', 'note'],
      replyLabel: 'WhatsApp',
      replyPlaceholder: `Reply on WhatsApp to ${name}...`,
      replyPlaceholderKey: 'composer.placeholders.whatsapp',
      replyPlaceholderParams: { name },
      includeSignature: false,
      showRecipient: Boolean(thread.contactName),
      recipientLabel: 'To',
      recipientValue: thread.contactName || 'WhatsApp contact',
    }
  }

  // widget / chat / integration
  const name = thread.contactName?.trim() || 'visitor'
  return {
    channel: 'chat',
    defaultTab: 'reply',
    tabs: ['reply', 'note'],
    replyLabel: 'Chat',
    replyPlaceholder: `Reply in chat to ${name}...`,
    replyPlaceholderKey: 'composer.placeholders.chat',
    replyPlaceholderParams: { name },
    includeSignature: false,
    showRecipient: Boolean(thread.contactName || thread.contactEmail),
    recipientLabel: 'With',
    recipientValue: thread.contactName || thread.contactEmail || '',
  }
}
