import { Bot, Trash2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { isInternalThread, threadCounterpartyName, threadSecondaryLine } from '../../lib/message-composer'
import type { InboxThread, ThreadId } from '../../lib/inbox-api'
import ThreadIndicatorMenu from './ThreadIndicatorMenu'

type Props = {
  thread: InboxThread
  isSelected: boolean
  onSelect: (id: ThreadId) => void
  onMarkRead: (id: ThreadId) => void
  onMarkUnread: (id: ThreadId) => void
  onTogglePin: (id: ThreadId, currentPinned: boolean) => void
  onDelete: (id: ThreadId) => void
  deleting?: boolean
  variant?: 'customer' | 'direct'
  /** Bulk selection (checkbox) state; undefined hides the checkbox entirely. */
  checked?: boolean
  onToggleChecked?: (id: ThreadId) => void
  /** True while any thread is selected: keeps all checkboxes visible. */
  selectionActive?: boolean
  /** Clicking a tag chip filters the list on that label. */
  onTagClick?: (tag: string) => void
  /** Display name of the assigned member (resolved by the parent list). */
  assigneeName?: string | null
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const now = Date.now()
  const diff = now - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'Now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}u`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
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
  onDelete,
  deleting = false,
  variant = 'customer',
  checked,
  onToggleChecked,
  selectionActive = false,
  onTagClick,
  assigneeName = null,
}: Props) {
  const priorityDot = PRIORITY_DOT[thread.priority] ?? ''
  const isDirect = variant === 'direct' || thread.channel === 'assistant'
  const isAgentThread = isInternalThread(thread)
  const primaryLabel = isDirect
    ? thread.emailSubject || 'Untitled chat'
    : isAgentThread
      ? threadCounterpartyName(thread)
      : thread.contactName || thread.contactEmail || 'Unknown sender'
  const secondaryLabel = isDirect
    ? thread.agentName ?? (thread.agentKind === 'company' ? 'Company agent' : 'Assistant')
    : isAgentThread
      ? threadSecondaryLine(thread)
      : thread.emailSubject

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
        {onToggleChecked ? (
          <input
            type="checkbox"
            checked={Boolean(checked)}
            aria-label="Select thread"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={() => onToggleChecked(thread.id)}
            className={cn(
              'mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-border accent-[rgb(var(--color-accent))] transition-opacity',
              selectionActive || checked
                ? 'opacity-100'
                : 'opacity-0 group-hover/thread:opacity-100 focus-visible:opacity-100',
            )}
          />
        ) : null}
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
              {isDirect ? (
                <span className="inline-flex items-center gap-1.5 min-w-0">
                  <Bot size={12} className="shrink-0 text-text-muted" />
                  <span className="truncate">{primaryLabel}</span>
                </span>
              ) : (
                primaryLabel
              )}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                disabled={deleting}
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(thread.id)
                }}
                onKeyDown={(e) => e.stopPropagation()}
                title="Delete"
                aria-label="Delete thread"
                className={cn(
                  'inline-flex h-6 w-6 items-center justify-center rounded text-text-muted',
                  'opacity-0 pointer-events-none group-hover/thread:opacity-100 group-hover/thread:pointer-events-auto',
                  'hover:bg-status-error/10 hover:text-status-error transition-opacity',
                  'focus-visible:opacity-100 focus-visible:pointer-events-auto focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50',
                )}
              >
                <Trash2 size={13} />
              </button>
              <span className="text-xs text-text-muted">{formatRelativeTime(thread.lastMessageAt)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 mb-1">
            {priorityDot && !isDirect ? <span className={cn('shrink-0 h-1.5 w-1.5 rounded-full', priorityDot)} /> : null}
            <span className="text-xs font-medium text-text-secondary truncate">{secondaryLabel}</span>
          </div>
          {thread.assignedToUserId && !isDirect ? (
            <div className="flex items-center gap-1">
              <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent/15 text-[8px] font-semibold uppercase text-accent">
                {(assigneeName ?? '?').slice(0, 1)}
              </span>
              <span className="truncate text-xs text-text-muted">{assigneeName ?? 'Assigned'}</span>
            </div>
          ) : null}
          {thread.tags.length > 0 ? (
            <div className="flex gap-1 flex-wrap mt-1">
              {thread.tags.slice(0, 3).map((tag) =>
                onTagClick ? (
                  <button
                    key={tag}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onTagClick(tag)
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                    title={`Filter by ${tag}`}
                    className="inline-block rounded px-1.5 py-0.5 text-xs bg-bg-surface-hover text-text-secondary hover:bg-accent/10 hover:text-accent transition-colors"
                  >
                    {tag}
                  </button>
                ) : (
                  <span key={tag} className="inline-block rounded px-1.5 py-0.5 text-xs bg-bg-surface-hover text-text-secondary">
                    {tag}
                  </span>
                ),
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
