import type { InboxThread } from './inbox-api'
import { humanizeContactName } from './contact-label'
import { agentChatPath, inboxPath } from './messages-paths'

/** Outbound surface aligned with how Intercom picks reply channel per conversation. */
export type ComposerChannel = 'email' | 'chat' | 'slack' | 'whatsapp' | 'internal' | 'assistant'

/**
 * One composer, three destinations: the customer (`reply`), the AI on this
 * conversation (`ask`), and the team (`note`).
 */
export type ComposerMode = 'reply' | 'ask' | 'note'

export type ComposerSurface = {
  channel: ComposerChannel
  defaultMode: ComposerMode
  modes: ComposerMode[]
  replyLabel: string
  /** Short counterparty name for the "Reply to {name}" chip. */
  replyTargetName: string
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

/** Background agent-run / ops threads (Agent-runs leaf). */
export function isAgentRunThread(thread: Pick<InboxThread, 'channel' | 'folder'>): boolean {
  const channel = thread.channel ?? 'email'
  // Assistant chats are conversations, never agent runs, regardless of the
  // folder the API stamps on them.
  if (channel === 'assistant') return false
  return thread.folder === 'internal' || channel === 'internal'
}

/** Direct operator ↔ agent chats (channel=assistant). */
export function isAssistantChatThread(thread: Pick<InboxThread, 'channel' | 'folder'>): boolean {
  return (thread.channel ?? '') === 'assistant'
}

/** True for assistant chats and agent-run threads (not customer channels). */
export function isInternalThread(thread: Pick<InboxThread, 'channel' | 'folder'>): boolean {
  return isAgentRunThread(thread) || isAssistantChatThread(thread)
}

/** Prefer a customer conversation when auto-opening the inbox. */
export function pickPreferredInboxThread<
  T extends Pick<InboxThread, 'channel' | 'folder' | 'hasUnread'>,
>(threads: T[]): T | null {
  const customers = threads.filter((thread) => !isInternalThread(thread))
  const pool = customers.length > 0 ? customers : threads
  return pool.find((thread) => thread.hasUnread) ?? pool[0] ?? null
}

/**
 * Alle communicatie ordering: customer + assistant chats first (by list order),
 * agent-run threads last when a mixed list appears.
 */
export function customersFirst<T extends Pick<InboxThread, 'channel' | 'folder'>>(threads: T[]): T[] {
  const conversations: T[] = []
  const runs: T[] = []
  for (const thread of threads) {
    if (isAgentRunThread(thread)) runs.push(thread)
    else conversations.push(thread)
  }
  return [...conversations, ...runs]
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
export function threadHubPath(
  thread: Pick<InboxThread, 'id' | 'channel' | 'folder' | 'agentId'>,
): string {
  if (isAssistantChatThread(thread) && thread.agentId) {
    return agentChatPath(thread.agentId, String(thread.id))
  }
  if (isAgentRunThread(thread)) {
    return inboxPath('all', String(thread.id))
  }
  return inboxPath('open', String(thread.id))
}

/** Primary label for thread list rows and headers. */
export function threadCounterpartyName(
  thread: InboxThread,
  labels?: { agent?: string; unknownSender?: string },
): string {
  if (isInternalThread(thread)) {
    // Team rooms keep an assigned agent for tools; the room itself is the team.
    if (thread.owner?.kind === 'team') {
      const teamName = thread.contactName?.trim()
      if (teamName) return teamName
    }
    if (thread.agentName?.trim()) return thread.agentName.trim()
    const name = thread.contactName?.trim()
    if (name && name.toLowerCase() !== 'agent') return name
    return labels?.agent ?? 'Agent'
  }
  return thread.contactName?.trim() || thread.contactEmail?.trim() || labels?.unknownSender || 'Unknown sender'
}

/** Addresses that typically bounce or ignore replies (noreply@, donotreply@, …). */
export function isNonReceivingEmailAddress(address: string | null | undefined): boolean {
  const email = (address || '').trim().toLowerCase()
  if (!email.includes('@')) return false
  const local = email.split('@')[0] ?? ''
  if (!local) return false
  if (
    local === 'noreply' ||
    local === 'no-reply' ||
    local === 'donotreply' ||
    local === 'do-not-reply' ||
    local === 'nobody' ||
    local === 'mailer-daemon'
  ) {
    return true
  }
  return (
    local.startsWith('noreply') ||
    local.startsWith('no-reply') ||
    local.startsWith('donotreply') ||
    local.startsWith('do-not-reply')
  )
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
 * Derive composer modes and defaults from thread channel + counterparty.
 * The reply destination matches the conversation source; `ask` and `note`
 * never leave the workspace, so every channel offers them.
 */
export function resolveComposerSurface(
  thread: InboxThread,
  labels?: { visitor?: string },
): ComposerSurface {
  const channel = mapSignalChannel(thread)
  const visitorLabel = labels?.visitor?.trim() || 'Website visitor'

  if (channel === 'internal' || channel === 'assistant') {
    const name = threadCounterpartyName(thread)
    // Open decisions: prefer a neutral note so Approve/Reject stays primary
    // (do not push the operator into "Message Platform PO").
    const awaitingDecision = Boolean(thread.hasOpenDecision)
    const teamRoom = thread.owner?.kind === 'team' || thread.turn?.kind === 'team'
    return {
      channel,
      // No customer sits on the other side: every line is either for the AI
      // or for the team. Team rooms start on a note so members talk to each other.
      defaultMode: awaitingDecision || teamRoom ? 'note' : 'ask',
      modes: ['ask', 'note'],
      replyLabel: channel === 'assistant' ? 'Chat' : 'Message',
      replyTargetName: name,
      replyPlaceholder: `Message ${name}...`,
      replyPlaceholderKey: 'composer.placeholders.messageAgent',
      replyPlaceholderParams: { name },
      includeSignature: false,
      showRecipient: !awaitingDecision && !teamRoom,
      recipientLabel: channel === 'assistant' ? 'Assistant' : 'Agent',
      recipientValue: name,
    }
  }

  if (channel === 'email') {
    const email = thread.contactEmail?.trim() ?? ''
    const name = thread.contactName?.trim()
    const nonReceiving = isNonReceivingEmailAddress(email)
    return {
      channel: 'email',
      defaultMode: nonReceiving ? 'note' : 'reply',
      modes: ['reply', 'ask', 'note'],
      replyLabel: 'Email',
      replyTargetName: name || email,
      replyPlaceholder: email ? `Reply to ${email}...` : 'Type an email...',
      replyPlaceholderKey: email ? 'composer.placeholders.replyEmail' : 'composer.placeholders.typeEmail',
      replyPlaceholderParams: email ? { email } : undefined,
      includeSignature: true,
      showRecipient: Boolean(email || name) && !nonReceiving,
      recipientLabel: 'To',
      recipientValue: name && email ? `${name} <${email}>` : email || name || '',
    }
  }

  if (channel === 'slack') {
    return {
      channel: 'slack',
      defaultMode: 'reply',
      modes: ['reply', 'ask', 'note'],
      replyLabel: 'Slack',
      replyTargetName: thread.contactName || 'Slack thread',
      replyPlaceholder: 'Type a Slack message...',
      replyPlaceholderKey: 'composer.placeholders.slack',
      includeSignature: false,
      showRecipient: Boolean(thread.contactName),
      recipientLabel: 'Channel',
      recipientValue: thread.contactName || 'Slack thread',
    }
  }

  if (channel === 'whatsapp') {
    const rawName = thread.contactName?.trim()
    const name = humanizeContactName(thread.contactName, thread.contactEmail, visitorLabel) || 'contact'
    return {
      channel: 'whatsapp',
      defaultMode: 'reply',
      modes: ['reply', 'ask', 'note'],
      replyLabel: 'WhatsApp',
      replyTargetName: name,
      replyPlaceholder: `Reply on WhatsApp to ${name}...`,
      replyPlaceholderKey: 'composer.placeholders.whatsapp',
      replyPlaceholderParams: { name },
      includeSignature: false,
      showRecipient: Boolean(rawName),
      recipientLabel: 'To',
      recipientValue: rawName ? name : 'WhatsApp contact',
    }
  }

  // widget / chat / integration
  const name = humanizeContactName(thread.contactName, thread.contactEmail, visitorLabel) || undefined
  return {
    channel: 'chat',
    defaultMode: 'reply',
    modes: ['reply', 'ask', 'note'],
    replyLabel: 'Chat',
    replyTargetName: name || thread.contactEmail || '',
    replyPlaceholder: name ? `Reply in chat to ${name}...` : 'Reply in chat...',
    replyPlaceholderKey: name ? 'composer.placeholders.chat' : 'composer.placeholders.chatVisitor',
    replyPlaceholderParams: name ? { name } : undefined,
    includeSignature: false,
    showRecipient: Boolean(thread.contactName || thread.contactEmail),
    recipientLabel: 'With',
    recipientValue: name || thread.contactEmail || '',
  }
}
