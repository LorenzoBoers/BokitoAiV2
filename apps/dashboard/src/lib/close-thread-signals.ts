import { appRoutes } from '../api/routes'
import { APP_API_BASE, buildAuthHeaders } from './api'
import { getTicket, moveTicketToStage, patchTicket, type CollectStageFields, type Ticket, type TicketStage, type TicketStageField } from './tickets-api'

export class TicketStageMoveCancelled extends Error {
  constructor() {
    super('cancelled')
    this.name = 'TicketStageMoveCancelled'
  }
}

/** An open ticket that should not silently stay open after the conversation closes. */
export function isOpenTicket(ticket: Ticket | null): ticket is Ticket {
  if (!ticket) return false
  return ticket.status !== 'done' && ticket.status !== 'closed' && ticket.status !== 'proposed'
}

/** The conversation's open ticket, as a list so callers can count and name it. */
export async function loadOpenTickets(signalId: string): Promise<Ticket[]> {
  const ticket = await getTicket(signalId).catch(() => null)
  return isOpenTicket(ticket) ? [ticket] : []
}

/** Move each ticket to its playbook's first done stage. */
export async function resolveOpenTickets(
  tickets: Ticket[],
  collect?: CollectStageFields,
): Promise<void> {
  for (const ticket of tickets) {
    const done = ticket.stages.find((stage) => stage.kind === 'done')
    if (!done) {
      await patchTicket(ticket.signal_id, { status: 'done' })
      continue
    }
    const result = await moveTicketToStage({
      signalId: ticket.signal_id,
      stage: done,
      values: ticket.fields,
      collect,
      ticketName: ticket.name,
    })
    if (result.cancelled) {
      throw new TicketStageMoveCancelled()
    }
  }
}

export class StageFieldsRequired extends Error {
  stage: TicketStage
  fields: TicketStageField[]
  ticketName: string

  constructor(stage: TicketStage, fields: TicketStageField[], ticketName: string) {
    super('stage_fields_required')
    this.name = 'StageFieldsRequired'
    this.stage = stage
    this.fields = fields
    this.ticketName = ticketName
  }
}

/** Close on the server. When resolve is set, the API moves the open ticket to done. */
export async function closeConversation(
  token: string,
  threadId: string,
  opts?: { resolve?: boolean; fields?: Record<string, string>; projectId?: string },
): Promise<void> {
  const res = await fetch(`${APP_API_BASE}${appRoutes.signals.threadClose(threadId)}`, {
    method: 'POST',
    headers: buildAuthHeaders(token),
    credentials: 'include',
    body: JSON.stringify({
      resolve_ticket: opts?.resolve !== false,
      ...(opts?.fields ? { fields: opts.fields } : {}),
      ...(opts?.projectId ? { project_id: opts.projectId } : {}),
    }),
  })
  if (res.ok) return
  const body = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string; stage_key?: string; stage_name?: string; fields?: TicketStageField[]; ticket_name?: string }
  } | null
  const error = body?.error
  if (res.status === 409 && error?.code === 'stage_fields_required') {
    const fields = Array.isArray(error.fields) ? error.fields : []
    const stage: TicketStage = {
      key: error.stage_key || 'done',
      name: error.stage_name || 'Done',
      kind: 'done',
      fields,
    }
    throw new StageFieldsRequired(stage, fields, error.ticket_name || '')
  }
  throw new Error(error?.message || 'Could not close the conversation')
}

/**
 * One close. If the done stage still needs fields, ask once and retry.
 * Cancelled collection leaves the conversation open.
 */
export async function closeConversationCollecting(
  token: string,
  threadId: string,
  opts: { resolve: boolean; collect?: CollectStageFields; projectId?: string },
): Promise<void> {
  let fields: Record<string, string> | undefined
  for (;;) {
    try {
      await closeConversation(token, threadId, {
        resolve: opts.resolve,
        fields,
        projectId: opts.projectId,
      })
      return
    } catch (err) {
      if (!(err instanceof StageFieldsRequired) || !opts.collect) throw err
      const filled = await opts.collect({
        stage: err.stage,
        fields: err.fields,
        values: {},
        ticketName: err.ticketName,
      })
      if (filled == null) throw new TicketStageMoveCancelled()
      fields = filled
    }
  }
}
