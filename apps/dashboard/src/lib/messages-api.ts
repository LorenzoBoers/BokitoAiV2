import { messagesRoutes } from '../api/routes'
import { xanoGetWorkforce, xanoPostWorkforce } from './xano'

export type MessageStatus =
  | 'pending'
  | 'processing'
  | 'awaiting_human'
  | 'done'
  | 'failed'

export interface MessageRow {
  id: string
  thread_id: string
  subject: string | null
  body: string
  message_type: string
  channel: string
  status: MessageStatus
  payload?: Record<string, unknown>
  created_at: string
}

export async function listMessages(filters: {
  status?: MessageStatus
  message_type?: string
  channel?: string
  thread_id?: string
}): Promise<MessageRow[]> {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.message_type) params.set('message_type', filters.message_type)
  if (filters.channel) params.set('channel', filters.channel)
  if (filters.thread_id) params.set('thread_id', filters.thread_id)
  const data = await xanoGetWorkforce<MessageRow[] | { items: MessageRow[] }>(
    messagesRoutes.listQuery(params)
  )
  return Array.isArray(data) ? data : data.items ?? []
}

export async function approveAutonomousProposal(messageId: string): Promise<void> {
  await xanoPostWorkforce(messagesRoutes.decisionApprove(messageId), {})
}

export async function deferAutonomousProposal(messageId: string, days = 7): Promise<void> {
  await xanoPostWorkforce(messagesRoutes.decisionDefer(messageId), { days })
}

export async function rejectAutonomousProposal(messageId: string): Promise<void> {
  await xanoPostWorkforce(messagesRoutes.decisionReject(messageId), {})
}
