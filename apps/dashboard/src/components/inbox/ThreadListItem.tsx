import { useTranslation } from 'react-i18next'
import { Bot, Trash2 } from 'lucide-react'
import { ChannelGlyph } from '../ui/ChannelGlyph'
import { DomainFavicon } from '../ui/DomainFavicon'
import { cn } from '../../lib/utils'
import { translateDecisionText, translateMockAgentBody } from '../../lib/activity-labels'
import { humanizeContactName, isPlaceholderContactAddress } from '../../lib/contact-label'
import { isInternalThread, threadCounterpartyName, threadNeedsReply, threadSecondaryLine } from '../../lib/message-composer'
import { formatAppDate, formatAppDateTime } from '../../lib/app-locale'
import { formatWakeTime } from '../../lib/snooze'
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
  onToggleChecked?: (id: ThreadId, shiftKey?: boolean) => void
  /** True while any thread is selected: keeps all checkboxes visible. */
  selectionActive?: boolean
  /** Clicking a tag chip filters the list on that label. */
  onTagClick?: (tag: string) => void
  /** Display name of the assigned member (resolved by the parent list). */
  assigneeName?: string | null
  compact?: boolean
}

function formatRelativeTime(iso: string | null, t: (key: string) => string, language?: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const now = Date.now()
  const diff = now - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return t('listItem.now')
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return formatAppDate(date, language, { day: 'numeric', month: 'short' })
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
  compact = false,
}: Props) {
  const { t, i18n } = useTranslation('communication')
  const priorityDot = PRIORITY_DOT[thread.priority] ?? ''
  const isDirect = variant === 'direct' || thread.channel === 'assistant'
  const isAgentThread = isInternalThread(thread)
  const visitorLabel = t('contactPanel.widgetVisitor')
  const contactLabel = humanizeContactName(thread.contactName, thread.contactEmail, visitorLabel)
  const readableEmail = isPlaceholderContactAddress(thread.contactEmail) ? '' : thread.contactEmail?.trim()
  const primaryLabel = isDirect
    ? translateDecisionText(thread.emailSubject, t) || t('listItem.untitled')
    : isAgentThread
      ? threadCounterpartyName(thread)
      : contactLabel || readableEmail || t('listItem.unknownSender')
  const rawPreview =
    translateMockAgentBody(thread.lastMessagePreview, t) || translateDecisionText(thread.emailSubject, t)
  const secondaryLabel = isDirect
    ? thread.agentName ?? (thread.agentKind === 'company' ? t('listItem.companyAgent') : t('listItem.assistant'))
    : isAgentThread
      ? translateDecisionText(threadSecondaryLine(thread), t)
      : thread.lastMessageDirection === 'outbound' && rawPreview
        ? `${t('listItem.you')}: ${rawPreview}`
        : rawPreview
  const showNeedsReply = !isDirect && !isAgentThread && threadNeedsReply(thread) && !thread.hasUnread

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
      data-active={isSelected || undefined}
      className={cn(
        'row-interactive w-full cursor-pointer text-left px-3 rounded-md group/thread',
        compact ? 'py-1.5' : 'py-2.5',
        isSelected
          ? 'bg-accent/10 border border-accent/20'
          : 'hover:bg-bg-hover/50 border border-transparent',
      )}
    >
      <div className="flex items-start gap-2 min-w-0">
        {onToggleChecked ? (
          <input
            type="checkbox"
            checked={Boolean(checked)}
            aria-label={t('threadList.selectThread')}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(event) =>
              onToggleChecked(thread.id, (event.nativeEvent as MouseEvent).shiftKey)
            }
            className={cn(
              'mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-border accent-[rgb(var(--color-accent))] transition-opacity',
              selectionActive || checked
                ? 'opacity-100'
                : 'opacity-0 group-hover/thread:opacity-100 focus-visible:opacity-100',
            )}
          />
        ) : null}
        {isDirect || isAgentThread ? (
          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
            <Bot size={13} />
          </span>
        ) : (
          <DomainFavicon
            email={thread.contactEmail}
            name={thread.contactName || thread.contactEmail}
            size={28}
            className="mt-0.5"
          />
        )}
        <ThreadIndicatorMenu
          hasUnread={thread.hasUnread}
          isPinned={thread.isPinned}
          onMarkRead={() => onMarkRead(thread.id)}
          onMarkUnread={() => onMarkUnread(thread.id)}
          onTogglePin={() => onTogglePin(thread.id, thread.isPinned)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className={cn('text-sm font-medium truncate', thread.hasUnread ? 'text-text-heading' : 'text-text-primary')}>
                {primaryLabel}
              </span>
              {isAgentThread && !isDirect ? (
                <span className="shrink-0 rounded-full border border-border/60 bg-bg-elevated/70 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-text-muted">
                  {t('listItem.internal')}
                </span>
              ) : null}
              {thread.status === 'pending' ? (
                <span className="shrink-0 rounded-full border border-border/60 bg-bg-elevated/70 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-text-muted">
                  {t('listItem.snoozed')}
                </span>
              ) : null}
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
                title={t('threadList.deleteThread')}
                aria-label={t('threadList.deleteThread')}
                className={cn(
                  'inline-flex h-6 w-6 items-center justify-center rounded text-text-muted',
                  'opacity-0 pointer-events-none group-hover/thread:opacity-100 group-hover/thread:pointer-events-auto',
                  'hover:bg-status-error/10 hover:text-status-error transition-opacity',
                  'focus-visible:opacity-100 focus-visible:pointer-events-auto focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50',
                )}
              >
                <Trash2 size={13} />
              </button>
              {!isDirect && !isAgentThread ? (
                <span
                  title={t(`composer.channel.${thread.channel ?? 'email'}`, {
                    defaultValue: thread.channel ?? '',
                  })}
                  className="inline-flex"
                >
                  <ChannelGlyph channel={thread.channel ?? 'email'} size={11} className="text-text-muted/80" />
                </span>
              ) : null}
              <span
                className="text-xs text-text-muted"
                title={
                  thread.lastMessageAt
                    ? formatAppDateTime(new Date(thread.lastMessageAt), i18n.language)
                    : undefined
                }
              >
                {thread.status === 'pending'
                  ? formatWakeTime(thread.snoozedUntil, t, i18n.language) ?? t('snooze.untilReply')
                  : formatRelativeTime(thread.lastMessageAt, t, i18n.language)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 mb-1">
            {priorityDot && !isDirect ? (
              <span className={cn('shrink-0 h-1.5 w-1.5 rounded-full', priorityDot, thread.priority === 'urgent' && 'pulse-dot')} />
            ) : null}
            <span className="text-xs font-medium text-text-secondary truncate">{secondaryLabel}</span>
            {showNeedsReply ? (
              <span className="shrink-0 rounded-full bg-accent/12 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-accent">
                {t('listItem.needsReply')}
              </span>
            ) : null}
          </div>
          {thread.assignedToUserId && !isDirect ? (
            <div className="flex items-center gap-1">
              <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent/15 text-[8px] font-semibold uppercase text-accent">
                {(assigneeName ?? '?').slice(0, 1)}
              </span>
              <span className="truncate text-xs text-text-muted">{assigneeName ?? t('listItem.assigned')}</span>
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
                    title={t('listItem.filterBy', { tag })}
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
