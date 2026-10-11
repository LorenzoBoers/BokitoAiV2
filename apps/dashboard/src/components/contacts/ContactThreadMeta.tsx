import { useTranslation } from 'react-i18next'
import { CalendarClock } from 'lucide-react'
import { formatAppDate } from '../../lib/app-locale'
import type { InboxThread } from '../../lib/inbox-api'
import { parseServerTime } from '../../lib/thread-schedule'
import { cn } from '../../lib/utils'

/** `#klacht · Waiting - ` before a contact's conversation status, when it is a ticket. */
export function ThreadTicketPrefix({ thread }: { thread: InboxThread }) {
  const ticket = thread.ticket
  if (!ticket || ticket.status === 'proposed') return null
  return (
    <span className="font-medium text-accent">
      #{ticket.name}
      {ticket.stage?.name ? ` · ${ticket.stage.name}` : ''}
      {' - '}
    </span>
  )
}

/** The conversation's date; amber once it is due. */
export function ThreadLookAt({ thread }: { thread: InboxThread }) {
  const { t, i18n } = useTranslation('nav')
  const at = parseServerTime(thread.nextAt)
  if (!at) return null
  const due = at.getTime() <= Date.now()
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1 text-2xs tabular-nums', due ? 'text-status-warning' : 'text-text-muted')}
      title={t('contactsPage.lookAt')}
    >
      <CalendarClock size={11} aria-hidden />
      {formatAppDate(at, i18n.language, { day: 'numeric', month: 'short' })}
    </span>
  )
}
