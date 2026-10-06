import { getTicket, patchTicket, type Ticket } from './tickets-api'

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
export async function resolveOpenTickets(tickets: Ticket[]): Promise<void> {
  await Promise.all(
    tickets.map((ticket) => {
      const done = ticket.stages.find((stage) => stage.kind === 'done')
      return patchTicket(ticket.signal_id, done ? { stage_key: done.key } : { status: 'done' })
    }),
  )
}
