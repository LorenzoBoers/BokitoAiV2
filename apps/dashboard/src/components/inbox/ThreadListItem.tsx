import { cn } from '../../lib/utils'
import type { InboxThread } from '../../lib/inbox-api'
import ThreadIndicatorMenu from './ThreadIndicatorMenu'

type Props = {
  thread: InboxThread
  isSelected: boolean
  onSelect: (id: number) => void
  onMarkRead: (id: number) => void
  onMarkUnread: (id: number) => void
  onTogglePin: (id: number, currentPinned: boolean) => void
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const now = Date.now()
  const diff = now - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'Nu'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}u`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
}

const PRIORITY_DOT: Record<string, string> = {
  urgent: 'bg-status-error',
  high: 'bg-status-warning',
  normal: '',
}

export default function ThreadListItem({
  thread,
  isSelected,
  onSelect,
  onMarkRead,
  onMarkUnread,
  onTogglePin,
}: Props) {
  const priorityDot = PRIORITY_DOT[thread.priority] ?? ''

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(thread.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(thread.id)
        }
      }}
      className={cn(
        'w-full cursor-pointer text-left px-3 py-2.5 rounded-md transition-colors group/thread',
        isSelected ? 'bg-accent/10 border border-accent/20' : 'hover:bg-bg-surface-hover border border-transparent',
      )}
    >
      <div className="flex items-start gap-2 min-w-0">
        <ThreadIndicatorMenu
          hasUnread={thread.hasUnread}
          isPinned={thread.isPinned}
          onMarkRead={() => onMarkRead(thread.id)}
          onMarkUnread={() => onMarkUnread(thread.id)}
          onTogglePin={() => onTogglePin(thread.id, thread.isPinned)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <span className={cn('text-sm font-medium truncate', thread.hasUnread ? 'text-text-heading' : 'text-text-primary')}>
              {thread.contactName || thread.contactEmail || 'Onbekende afzender'}
            </span>
            <span className="text-xs text-text-muted shrink-0">{formatRelativeTime(thread.lastMessageAt)}</span>
          </div>
          <div className="flex items-center gap-1 mb-1">
            {priorityDot ? <span className={cn('shrink-0 h-1.5 w-1.5 rounded-full', priorityDot)} /> : null}
            <span className="text-xs font-medium text-text-secondary truncate">{thread.emailSubject}</span>
          </div>
          {thread.assignedToUserId ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-text-muted">Toegewezen</span>
            </div>
          ) : null}
          {thread.tags.length > 0 ? (
            <div className="flex gap-1 flex-wrap mt-1">
              {thread.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="inline-block rounded px-1.5 py-0.5 text-xs bg-bg-surface-hover text-text-secondary">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
