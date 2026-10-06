import { getTicket, moveTicketToStage, patchTicket, type CollectStageFields, type Ticket } from './tickets-api'

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
