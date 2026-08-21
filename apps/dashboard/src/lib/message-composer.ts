import type { InboxThread } from './inbox-api'

/** Outbound surface aligned with how Intercom picks reply channel per conversation. */
export type ComposerChannel = 'email' | 'chat' | 'slack' | 'internal' | 'assistant'

export type ComposerTab = 'reply' | 'note'

export type ComposerSurface = {
  channel: ComposerChannel
  defaultTab: ComposerTab
  tabs: ComposerTab[]
  replyLabel: string
  replyPlaceholder: string
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
  if (raw === 'widget' || raw === 'chat') return 'chat'
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
      includeSignature: false,
      showRecipient: Boolean(thread.contactName),
      recipientLabel: 'Channel',
      recipientValue: thread.contactName || 'Slack thread',
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
    includeSignature: false,
    showRecipient: Boolean(thread.contactName || thread.contactEmail),
    recipientLabel: 'With',
    recipientValue: thread.contactName || thread.contactEmail || '',
  }
}
