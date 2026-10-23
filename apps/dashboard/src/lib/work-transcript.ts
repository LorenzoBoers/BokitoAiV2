/**
 * An agent's answer in a chat with the operator is a document: full column,
 * no fill. The operator's own messages, team chats, and anything a customer
 * sees on a chat channel stay bubbles.
 */
import type { InboxMessage } from './inbox-api'
import { isSessionMessage } from './session-timeline'

function isAgentAuthor(message: Pick<InboxMessage, 'kind' | 'payload'>): boolean {
  if (message.kind === 'agent_message') return true
  const agentId = message.payload?.agent_id
  return typeof agentId === 'string' && agentId.length > 0
}

export function isWorkTranscript(
  message: Pick<InboxMessage, 'payload' | 'kind' | 'direction'>,
  channel: string | null | undefined,
): boolean {
  if (message.kind === 'internal_note') return false
  if (!isAgentAuthor(message)) return false
  // A session on a customer thread is the agent talking to the operator.
  if (isSessionMessage(message)) return true
  // Direct agent chat. Team rooms (internal) and customer chats stay bubbles.
  return channel === 'assistant'
}
