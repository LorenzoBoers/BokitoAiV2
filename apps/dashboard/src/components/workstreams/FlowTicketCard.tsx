import { useMemo } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Bot, ClipboardCheck } from 'lucide-react'
import { relativeMoment } from '../agenda/agenda-style'
import { useMembers } from '../../hooks/useMembers'
import { inboxPath } from '../../lib/messages-paths'
import type { BoardTicket } from '../../lib/tickets-api'
import { timeAgo } from '../../lib/time-ago'
import { cn } from '../../lib/utils'
import { ChannelGlyph } from '../ui/ChannelGlyph'
import { Hashtag } from '../ui/HashtagMark'
import { UserAvatar } from '../ui/UserAvatar'

/**
 * The ticket card on every board (flow page and project boards). Click opens
 * the conversation; drag moves it to another stage when `disabled` is false.
 */
export function FlowTicketCard({
  ticket,
  disabled,
  showTag = false,
}: {
  ticket: BoardTicket
  disabled: boolean
  showTag?: boolean
}) {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const { members } = useMembers()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: ticket.signal_id,
    disabled,
  })
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined
  const title = ticket.subject || ticket.contact_name || t('projects.home.ticketUntitled')
  const assignee = useMemo(
    () => (ticket.assigned_user_id ? members.find((m) => m.uuid === ticket.assigned_user_id) : undefined),
    [members, ticket.assigned_user_id],
  )
  const fields = Object.entries(ticket.fields ?? {})
    .filter(([, value]) => String(value).trim())
    .slice(0, 2)

  return (
    <article
      ref={setNodeRef}
      style={style}
      aria-label={title}
      onClick={() => navigate(inboxPath('all', ticket.signal_id))}
      onKeyDown={(event) => {
        if (event.key === 'Enter') navigate(inboxPath('all', ticket.signal_id))
      }}
      className={cn(
        'group rounded-lg border border-border/60 bg-bg-surface px-2.5 py-2 text-left shadow-sm outline-none transition',
        'hover:-translate-y-px hover:border-border hover:shadow-md focus-visible:ring-1 focus-visible:ring-accent/60',
        isDragging && 'z-20 opacity-80 shadow-lg',
        disabled ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
      )}
      data-testid="flow-ticket-card"
      {...listeners}
      {...attributes}
    >
      <p className="line-clamp-2 text-xs font-medium leading-snug text-text-primary">{title}</p>
      {ticket.contact_name && ticket.subject ? (
        <p className="mt-0.5 truncate text-2xs text-text-muted">{ticket.contact_name}</p>
      ) : null}
      {fields.length > 0 ? (
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {fields.map(([key, value]) => (
            <li
              key={key}
              className="max-w-full truncate rounded border border-border/50 bg-bg-muted/40 px-1.5 py-px text-2xs text-text-secondary"
            >
              {value}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-1.5 flex items-center gap-1.5 text-2xs text-text-muted">
        <ChannelGlyph channel={ticket.channel} size={11} />
        {showTag ? <Hashtag name={ticket.tag} category /> : null}
        <span className="tabular-nums">{timeAgo(ticket.last_message_at, t)}</span>
        {ticket.checkup_at ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5',
              Date.parse(ticket.checkup_at) <= Date.now() ? 'text-status-warning' : 'text-text-muted',
            )}
            title={t('tickets.checkupNext', { when: relativeMoment(Date.parse(ticket.checkup_at), Date.now(), t) })}
          >
            <ClipboardCheck size={11} aria-hidden />
          </span>
        ) : null}
        {ticket.assignee_kind === 'agent' && !assignee ? (
          <span className="ml-auto text-text-muted" title={t('tickets.agentOwner')}>
            <Bot size={13} aria-hidden />
          </span>
        ) : null}
        {assignee ? (
          <span className="ml-auto" title={assignee.name}>
            <UserAvatar
              name={assignee.name}
              email={assignee.email}
              avatarUrl={assignee.avatarUrl}
              size={16}
              decorative
            />
          </span>
        ) : null}
      </div>
    </article>
  )
}
