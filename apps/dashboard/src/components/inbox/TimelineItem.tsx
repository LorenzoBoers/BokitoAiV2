import { StickyNote } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { InboxEvent, InboxMessage } from '../../lib/inbox-api'

type MessageItemProps = {
  message: InboxMessage
}

type EventItemProps = {
  event: InboxEvent
  memberName?: string
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('nl-NL', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const EVENT_LABELS: Record<string, (payload: Record<string, unknown>, memberName?: string) => string> = {
  thread_created: () => 'Thread aangemaakt',
  assigned: (p, name) => `Toegewezen aan ${name ?? `gebruiker ${p.assignee_id}`}`,
  unassigned: () => 'Toewijzing verwijderd',
  status_changed: (p) => `Status gewijzigd naar ${p.to_status ?? ''}`,
  tag_added: (p) => `Label toegevoegd: ${Array.isArray(p.tags) ? p.tags.join(', ') : ''}`,
  tag_removed: () => 'Label verwijderd',
  priority_changed: (p) => `Prioriteit: ${p.priority ?? ''}`,
  replied: () => 'Antwoord verstuurd',
  note_added: () => 'Notitie toegevoegd',
  reopened: () => 'Heropend',
}

export function MessageTimelineItem({ message }: MessageItemProps) {
  const isInternal = message.direction === 'internal'
  const isOutbound = message.direction === 'outbound'

  return (
    <div
      className={cn(
        'rounded-lg p-3 text-sm',
        isInternal ? 'bg-yellow-50 border border-yellow-200/60 dark:bg-yellow-900/10 dark:border-yellow-700/30' : 'bg-bg-surface border border-border/50',
        isOutbound ? 'ml-8' : '',
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {isInternal ? <StickyNote size={13} className="text-yellow-600 shrink-0" /> : null}
          <span className="font-medium text-text-heading text-xs truncate">
            {isInternal ? 'Interne notitie' : isOutbound ? 'Jij' : message.fromAddress || 'Afzender'}
          </span>
        </div>
        <span className="text-xs text-text-muted shrink-0">{formatTime(message.receivedAt)}</span>
      </div>

      {message.bodyHtml ? (
        <div
          className="prose prose-sm max-w-none text-text-primary text-xs leading-relaxed"
          dangerouslySetInnerHTML={{ __html: message.bodyHtml }}
        />
      ) : (
        <p className="text-xs text-text-primary leading-relaxed whitespace-pre-wrap">{message.bodyPreview}</p>
      )}
    </div>
  )
}

export function EventTimelineItem({ event, memberName }: EventItemProps) {
  const labelFn = EVENT_LABELS[event.eventType]
  const label = labelFn ? labelFn(event.payload, memberName) : event.eventType

  return (
    <div className="flex items-center gap-2 py-1 px-2">
      <div className="h-px flex-1 bg-border/40" />
      <span className="text-xs text-text-muted whitespace-nowrap">{label}</span>
      <span className="text-xs text-text-muted shrink-0">{formatTime(event.createdAt)}</span>
      <div className="h-px flex-1 bg-border/40" />
    </div>
  )
}
