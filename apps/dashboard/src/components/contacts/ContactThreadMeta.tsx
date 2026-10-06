import { useTranslation } from 'react-i18next'
import { CalendarClock } from 'lucide-react'
import { formatAppDate } from '../../lib/app-locale'
import type { InboxThread } from '../../lib/inbox-api'
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

/** The planned look-at of a conversation; amber once it is due. */
export function ThreadLookAt({ thread }: { thread: InboxThread }) {
  const { t, i18n } = useTranslation('nav')
  if (!thread.followUpAt) return null
  const at = new Date(thread.followUpAt)
  const due = at.getTime() <= Date.now()
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1 text-2xs tabular-nums', due ? 'text-status-warning' : 'text-text-muted')}
      title={thread.followUpTitle || t('contactsPage.lookAt')}
    >
      <CalendarClock size={11} aria-hidden />
      {formatAppDate(at, i18n.language, { day: 'numeric', month: 'short' })}
    </span>
  )
}
