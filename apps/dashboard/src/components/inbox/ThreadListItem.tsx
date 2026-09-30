import { memo, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, ArrowLeft, ArrowRight, Bot, Trash2 } from 'lucide-react'
import { AiAvatar } from '../ui/AiAvatar'
import { AI_PILL_CLASS } from '../ai/AiMark'
import { ChannelGlyph } from '../ui/ChannelGlyph'
import { PersonAvatar } from '../ui/PersonAvatar'
import { THREAD_ROW_AI_CLASS, THREAD_ROW_SELECTED_CLASS } from '../../lib/chat-chrome'
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
  onSnooze?: (id: ThreadId) => void
  /** Close/archive an open thread (shown outside Closed/Spam). */
  onClose?: (id: ThreadId) => void
  /** Permanently delete — only used for Closed/Spam rows. */
  onDelete: (id: ThreadId) => void
  deleting?: boolean
  variant?: 'customer' | 'direct'
  /** Bulk selection (checkbox) state; undefined hides the checkbox entirely. */
  checked?: boolean
  onToggleChecked?: (id: ThreadId, shiftKey?: boolean) => void
  /** True while any thread is selected: keeps all checkboxes visible. */
  selectionActive?: boolean
  /** Display name of the assigned member (resolved by the parent list). */
  assigneeName?: string | null
  compact?: boolean
  /** Stagger index for list-row enter animation (cap in parent). */
  enterIndex?: number
}

function formatRelativeTime(
  iso: string | null,
  t: (key: string, opts?: Record<string, unknown>) => string,
  language?: string | null,
): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const now = Date.now()
  const diff = now - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return t('listItem.now')
  if (minutes < 60) return t('listItem.minutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('listItem.hoursAgo', { count: hours })
  const days = Math.floor(hours / 24)
  if (days < 7) return t('listItem.daysAgo', { count: days })
  return formatAppDate(date, language, { day: 'numeric', month: 'short' })
}

const PRIORITY_DOT: Record<string, string> = {
  urgent: 'bg-status-error',
  high: 'bg-status-warning',
  normal: '',
}

function ThreadListItem({
  thread,
  isSelected,
  onSelect,
  onMarkRead,
  onMarkUnread,
  onTogglePin,
  onSnooze,
  onClose,
  onDelete,
  deleting = false,
  variant = 'customer',
  checked,
  onToggleChecked,
  selectionActive = false,
  assigneeName = null,
  compact = false,
  enterIndex,
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
      ? threadCounterpartyName(thread, {
          agent: t('listItem.agent'),
          unknownSender: t('listItem.unknownSender'),
        })
      : contactLabel || readableEmail || t('listItem.unknownSender')
  const rawPreview =
    translateMockAgentBody(thread.lastMessagePreview, t) || translateDecisionText(thread.emailSubject, t)
  const secondaryLabel = isDirect
    ? (() => {
        const preview = translateMockAgentBody(thread.lastMessagePreview, t).trim()
        if (preview && preview !== primaryLabel) return preview
        const agentLabel =
          thread.agentName?.trim() ||
          (thread.agentKind === 'company' ? t('listItem.companyAgent') : t('listItem.assistant'))
        // Avatar already identifies the agent; skip a secondary that only repeats the title.
        if (agentLabel && agentLabel !== primaryLabel) return agentLabel
        return ''
      })()
    : isAgentThread
      ? (() => {
          const agentName = (thread.agentName ?? '').trim()
          const subject = translateDecisionText(threadSecondaryLine(thread), t).trim()
          const preview = translateMockAgentBody(thread.lastMessagePreview, t).trim()
          const isRedundant = (value: string) =>
            !value ||
            value === primaryLabel ||
            (agentName.length > 0 && value.toLowerCase() === agentName.toLowerCase())
          // Prefer the last message; skip a subject/preview that only repeats the agent name.
          if (!isRedundant(preview)) return preview
          if (!isRedundant(subject)) return subject
          return ''
        })()
      : thread.lastMessageDirection === 'outbound' && rawPreview
        ? `${t('listItem.you')}: ${rawPreview}`
        : rawPreview
  const showNeedsReply = !isDirect && !isAgentThread && threadNeedsReply(thread)
  // Answered and waiting on them: open thread whose last line was ours.
  const showTheirTurn =
    !isDirect &&
    !isAgentThread &&
    !showNeedsReply &&
    thread.status === 'open' &&
    thread.lastMessageDirection === 'outbound'
  // Purple cue only when AI has real work on the thread (open decision).
  // Default !aiPaused ownership no longer paints every customer row violet.
  const aiActive = !isDirect && !isAgentThread && Boolean(thread.hasOpenDecision)

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
      data-ai-managed={aiActive || undefined}
      className={cn(
        'row-interactive group/thread w-full cursor-pointer rounded-md border border-transparent px-3 text-left',
        compact ? 'py-1.5' : 'py-2',
        isSelected ? THREAD_ROW_SELECTED_CLASS : 'hover:bg-bg-hover/45',
        aiActive && THREAD_ROW_AI_CLASS,
        enterIndex != null && enterIndex < 12 && 'list-row-enter',
      )}
      style={
        enterIndex != null && enterIndex < 12
          ? ({ '--stagger': enterIndex } as CSSProperties)
          : undefined
      }
      data-channel={thread.channel ?? undefined}
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
          thread.agentAvatarKind ||
          thread.agentAvatarIcon ||
          thread.agentAvatarColor ||
          thread.agentAvatarImageUrl ? (
            <AiAvatar
              name={thread.agentName || 'Agent'}
              seed={thread.agentId || String(thread.id)}
              size={28}
              className="mt-0.5"
              kind={thread.agentAvatarKind}
              icon={thread.agentAvatarIcon}
              color={thread.agentAvatarColor}
              imageUrl={thread.agentAvatarImageUrl}
              decorative
            />
          ) : (
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-ai/25 bg-ai/10 text-ai-ink">
              <Bot size={13} />
            </span>
          )
        ) : (
          <PersonAvatar
            name={thread.contactName}
            email={thread.contactEmail}
            size={28}
            className="mt-0.5"
          />
        )}
        <ThreadIndicatorMenu
          hasUnread={thread.hasUnread}
          isPinned={thread.isPinned}
          emphasize={isSelected}
          onMarkRead={() => onMarkRead(thread.id)}
          onMarkUnread={() => onMarkUnread(thread.id)}
          onTogglePin={() => onTogglePin(thread.id, thread.isPinned)}
          onSnooze={onSnooze ? () => onSnooze(thread.id) : undefined}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className={cn(
                  'truncate text-[13px] font-medium',
                  thread.hasUnread ? 'text-text-heading' : 'text-text-primary',
                )}
              >
                {primaryLabel}
              </span>
              {isDirect ? (
                <span className="shrink-0 rounded-full border border-ai/25 bg-ai/[0.06] px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-ai-ink">
                  {t('listItem.assistant')}
                </span>
              ) : null}
              {isAgentThread && !isDirect ? (
                <span className="shrink-0 rounded-full border border-border/60 bg-bg-elevated/70 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-text-muted">
                  {t('listItem.internal')}
                </span>
              ) : null}
              {!isAgentThread && thread.hasOpenDecision ? (
                <span
                  className={cn(
                    'shrink-0 rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide',
                    AI_PILL_CLASS,
                  )}
                >
                  {t('listItem.needsDecision')}
                </span>
              ) : null}
              {thread.status === 'pending' ? (
                <span className="shrink-0 rounded-full border border-border/60 bg-bg-elevated/70 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-text-muted">
                  {t('listItem.snoozed')}
                </span>
              ) : null}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {thread.status === 'closed' || thread.status === 'spam' ? (
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
              ) : onClose ? (
                <button
                  type="button"
                  disabled={deleting}
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose(thread.id)
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                  title={t('threadList.closeThread')}
                  aria-label={t('threadList.closeThread')}
                  className={cn(
                    'inline-flex h-6 w-6 items-center justify-center rounded text-text-muted',
                    'opacity-0 pointer-events-none group-hover/thread:opacity-100 group-hover/thread:pointer-events-auto',
                    'hover:bg-bg-hover hover:text-text-heading transition-opacity',
                    'focus-visible:opacity-100 focus-visible:pointer-events-auto focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50',
                  )}
                >
                  <Archive size={13} />
                </button>
              ) : null}
              {!isDirect && !isAgentThread ? (
                <span
                  title={t(`composer.channel.${thread.channel ?? 'email'}`, {
                    defaultValue: thread.channel ?? '',
                  })}
                  className="inline-flex items-center gap-0.5 rounded border border-border/40 bg-bg-elevated/50 px-1 py-px text-text-muted"
                >
                  <ChannelGlyph channel={thread.channel ?? 'email'} size={10} className="text-text-muted" />
                </span>
              ) : null}
              <span
                className="text-[11px] tabular-nums text-text-muted"
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

          <div className="flex items-center gap-1.5">
            {priorityDot && !isDirect ? (
              <span className={cn('shrink-0 h-1.5 w-1.5 rounded-full', priorityDot, thread.priority === 'urgent' && 'pulse-dot')} />
            ) : null}
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-secondary">
              {secondaryLabel}
            </span>
            {showNeedsReply ? (
              <span
                title={t('listItem.needsReply')}
                aria-label={t('listItem.needsReply')}
                className="ml-auto inline-flex shrink-0 text-accent"
              >
                <ArrowLeft size={13} strokeWidth={2.25} aria-hidden />
              </span>
            ) : showTheirTurn ? (
              <span
                title={t('listItem.theirTurn')}
                aria-label={t('listItem.theirTurn')}
                className="ml-auto inline-flex shrink-0 text-text-muted"
              >
                <ArrowRight size={13} strokeWidth={2} aria-hidden />
              </span>
            ) : null}
          </div>

          {thread.assignedToUserId && !isDirect ? (
            <div className="mt-1 flex items-center gap-1">
              <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent/15 text-[8px] font-semibold uppercase text-accent">
                {(assigneeName ?? '?').slice(0, 1)}
              </span>
              <span className="truncate text-xs text-text-muted">{assigneeName ?? t('listItem.assigned')}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default memo(ThreadListItem)
