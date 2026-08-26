import { isPlaceholderContactAddress } from './format'

export type ComposerChannel = 'email' | 'chat' | 'slack' | 'whatsapp' | 'internal' | 'assistant'

export type ComposerSurface = {
  channel: ComposerChannel
  replyLabelKey: 'thread.replyEmail' | 'thread.replyChat' | 'thread.replySlack' | 'thread.replyWhatsapp' | 'thread.reply'
  placeholderKey:
    | 'thread.replyPlaceholderEmail'
    | 'thread.replyPlaceholderChat'
    | 'thread.replyPlaceholderSlack'
    | 'thread.replyPlaceholderWhatsapp'
    | 'thread.replyPlaceholderAgent'
    | 'thread.replyPlaceholder'
  placeholderName?: string
  showRecipient: boolean
  recipientLabelKey: 'thread.recipientTo' | 'thread.recipientWith' | 'thread.recipientChannel' | 'thread.recipientAgent'
  recipientValue: string
  showCloseActions: boolean
}

type ThreadLike = {
  channel?: string
  folder?: string
  contact_name?: string
  contact_email?: string
}

export function isInternalThread(thread: ThreadLike): boolean {
  const channel = (thread.channel ?? '').toLowerCase()
  return thread.folder === 'internal' || channel === 'internal' || channel === 'assistant'
}

function mapChannel(thread: ThreadLike): ComposerChannel {
  const raw = (thread.channel ?? 'email').toLowerCase()
  if (raw === 'email') return 'email'
  if (raw === 'assistant') return 'assistant'
  if (raw === 'internal') return 'internal'
  if (raw === 'slack') return 'slack'
  if (raw === 'whatsapp') return 'whatsapp'
  if (raw === 'widget' || raw === 'chat' || raw === 'webchat' || raw === 'livechat') return 'chat'
  if (isInternalThread(thread)) return 'internal'
  if (thread.contact_email?.trim() && !isPlaceholderContactAddress(thread.contact_email)) return 'email'
  return 'chat'
}

export function resolveComposerSurface(
  thread: ThreadLike,
  labels: { visitor: string; agent: string },
): ComposerSurface {
  const channel = mapChannel(thread)
  const name =
    thread.contact_name?.trim() && thread.contact_name.trim().toLowerCase() !== 'agent'
      ? thread.contact_name.trim()
      : labels.visitor
  const email = isPlaceholderContactAddress(thread.contact_email) ? '' : (thread.contact_email ?? '').trim()

  if (channel === 'internal' || channel === 'assistant') {
    const agentName = thread.contact_name?.trim() || labels.agent
    return {
      channel,
      replyLabelKey: 'thread.reply',
      placeholderKey: 'thread.replyPlaceholderAgent',
      placeholderName: agentName,
      showRecipient: true,
      recipientLabelKey: 'thread.recipientAgent',
      recipientValue: agentName,
      showCloseActions: false,
    }
  }

  if (channel === 'email') {
    return {
      channel,
      replyLabelKey: 'thread.replyEmail',
      placeholderKey: 'thread.replyPlaceholderEmail',
      placeholderName: email || name,
      showRecipient: Boolean(email || name),
      recipientLabelKey: 'thread.recipientTo',
      recipientValue: name && email ? `${name} <${email}>` : email || name,
      showCloseActions: true,
    }
  }

  if (channel === 'slack') {
    return {
      channel,
      replyLabelKey: 'thread.replySlack',
      placeholderKey: 'thread.replyPlaceholderSlack',
      showRecipient: Boolean(thread.contact_name),
      recipientLabelKey: 'thread.recipientChannel',
      recipientValue: thread.contact_name || 'Slack',
      showCloseActions: true,
    }
  }

  if (channel === 'whatsapp') {
    return {
      channel,
      replyLabelKey: 'thread.replyWhatsapp',
      placeholderKey: 'thread.replyPlaceholderWhatsapp',
      placeholderName: name,
      showRecipient: Boolean(thread.contact_name),
      recipientLabelKey: 'thread.recipientTo',
      recipientValue: name,
      showCloseActions: true,
    }
  }

  return {
    channel: 'chat',
    replyLabelKey: 'thread.replyChat',
    placeholderKey: 'thread.replyPlaceholderChat',
    placeholderName: name,
    showRecipient: Boolean(thread.contact_name || email),
    recipientLabelKey: 'thread.recipientWith',
    recipientValue: name || email,
    showCloseActions: true,
  }
}
