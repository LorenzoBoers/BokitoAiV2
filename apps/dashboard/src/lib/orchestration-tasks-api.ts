import { appRoutes } from '../api/routes'
import { apiPost } from './api'

export type CreateConversationTaskInput = {
  title: string
  signalId: string
  scheduledFor?: string | null
  description?: string
}

/** Plan a human task on a conversation (Agenda). */
export async function createConversationTask(input: CreateConversationTaskInput): Promise<{ id: string }> {
  const body: Record<string, unknown> = {
    title: input.title,
    signal_id: input.signalId,
    assignee_kind: 'human',
    kind: 'task',
    origin: 'conversation',
    auto_start: false,
  }
  if (input.description) body.description = input.description
  if (input.scheduledFor) body.scheduled_for = input.scheduledFor
  const row = await apiPost<{ id?: string }>(appRoutes.orchestration.tasks, body)
  return { id: String(row.id ?? '') }
}
