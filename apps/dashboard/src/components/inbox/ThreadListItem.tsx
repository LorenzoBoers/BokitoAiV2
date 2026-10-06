import { memo, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  ArrowLeft,
  Clock,
  Mail,
  MailOpen,
  MoreHorizontal,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react'
import { AiAvatar } from '../ui/AiAvatar'
import { PersonAvatar } from '../ui/PersonAvatar'
import { TeamAvatar } from '../ui/TeamAvatar'
import { UserAvatar } from '../ui/UserAvatar'
import { toAiAvatarProps } from '../../lib/agent-avatar'
import { toTeamAvatarProps } from '../../lib/team-avatar'
import { agentPresenceOf } from '../../hooks/useAgentPresence'
import type { PresenceStatus } from '../../lib/teams-api'
import { ThreadStatusDot } from '../ui/ThreadStatusDot'
import { AiHandlingIcon } from '../ai/AiHandlingIcon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { THREAD_ROW_AI_CLASS, THREAD_ROW_SELECTED_CLASS } from '../../lib/chat-chrome'
import { cn } from '../../lib/utils'
import { translateDecisionText, translateMockAgentBody } from '../../lib/activity-labels'
import { humanizeContactName, isPlaceholderContactAddress } from '../../lib/contact-label'
import {
  isInternalThread,
  threadCounterpartyName,
  threadNeedsReply,
  threadSecondaryLine,
} from '../../lib/message-composer'
import { formatAppDate, formatAppDateTime } from '../../lib/app-locale'
import { formatWakeTime } from '../../lib/snooze'
import type { InboxThread, ThreadId } from '../../lib/inbox-api'
import { stageLabel } from '../../lib/tickets-api'
import { HashtagMark } from '../ui/HashtagMark'
import { StageProgressIcon } from '../workstreams/StageProgressIcon'

type Props = {
  thread: InboxThread
  isSelected: boolean
  onSelect: (id: ThreadId) => void
  onMarkRead?: (id: ThreadId) => void
  onMarkUnread?: (id: ThreadId) => void
  onTogglePin?: (id: ThreadId, currentPinned: boolean) => void
  onSnooze?: (id: ThreadId) => void
  /** Close/archive an open thread (shown outside Closed/Spam). */
  onClose?: (id: ThreadId) => void
  /** Permanently delete — only used for Closed/Spam rows. */
  onDelete?: (id: ThreadId) => void
  deleting?: boolean
  variant?: 'customer' | 'direct'
  /** Bulk selection (checkbox) state; undefined hides the checkbox entirely. */
  checked?: boolean
  onToggleChecked?: (id: ThreadId, shiftKey?: boolean) => void
  /** True while any thread is selected: keeps all checkboxes visible. */
  selectionActive?: boolean
  /** Display name of the assigned member or team (resolved by the parent list). */
  assigneeName?: string | null
  assigneePresence?: PresenceStatus
  assigneeKind?: 'user' | 'agent' | 'team' | null
  assigneeSeed?: string | null
  assigneeEmail?: string | null
  assigneeAvatarUrl?: string | null
  assigneeAvatarKind?: string | null
  assigneeAvatarIcon?: string | null
  assigneeAvatarColor?: string | null
  assigneeAvatarImageUrl?: string | null
  compact?: boolean
  /** Hide pin/read/close controls (Overview and other link-style lists). */
  showActions?: boolean
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

/** Hover-revealed icon button in the row's right cluster. */
const ROW_ICON_BUTTON = cn(
  'inline-flex h-6 w-6 items-center justify-center rounded text-text-muted transition-opacity',
  'opacity-0 pointer-events-none group-hover/thread:opacity-100 group-hover/thread:pointer-events-auto',
  'data-[state=open]:opacity-100 data-[state=open]:pointer-events-auto',
  'focus-visible:opacity-100 focus-visible:pointer-events-auto focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50',
)

/**
 * One conversation in the list: lead slot · avatar · name + time · preview.
 *
 * Assignee, ticket and free hashtags sit on a bottom row. Compact density
 * keeps that row collapsed until hover, keyboard focus, or selection.
 *
 * The lead slot carries one 8px state dot (unread, status, pinned). When the
 * list can bulk-select, the same slot turns into the checkbox on hover or
 * while a selection is active, so the avatar never shifts. Row actions
 * (read state, pin, snooze, close) sit in a hover cluster on the right.
 */
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
  assigneePresence,
  assigneeKind = null,
  assigneeSeed = null,
  assigneeEmail = null,
  assigneeAvatarUrl = null,
  assigneeAvatarKind = null,
  assigneeAvatarIcon = null,
  assigneeAvatarColor = null,
  assigneeAvatarImageUrl = null,
  compact = false,
  showActions = true,
  enterIndex,
}: Props) {
  const { t, i18n } = useTranslation('communication')
  const { t: tc } = useTranslation('common')
  const priorityDot = PRIORITY_DOT[thread.priority] ?? ''
  const isDirect = variant === 'direct' || thread.channel === 'assistant'
  const isAgentThread = isInternalThread(thread)
  const ticket =
    !isAgentThread && thread.ticket && thread.ticket.status !== 'proposed' ? thread.ticket : null
  const ticketName = ticket ? `#${ticket.name}` : ''
  const visitorLabel = t('contactPanel.widgetVisitor')
  const contactLabel = humanizeContactName(thread.contactName, thread.contactEmail, visitorLabel)
  const readableEmail = isPlaceholderContactAddress(thread.contactEmail) ? '' : thread.contactEmail?.trim()
  const untitledFallback = () => {
    const preview = translateMockAgentBody(thread.lastMessagePreview, t).trim().split('\n')[0]
    return preview || t('listItem.untitled')
  }
  const primaryLabel = isDirect
    ? (() => {
        const subject = (thread.emailSubject || '').trim()
        if (!subject || subject === 'New conversation' || subject === '(No subject)') return untitledFallback()
        return translateDecisionText(subject, t) || untitledFallback()
      })()
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
        ? `${thread.lastMessageByAgent ? t('listItem.ai') : t('listItem.you')}: ${rawPreview}`
        : rawPreview
  // One arrow at most: a decision card waits (AI colour) or the customer
  // spoke last (accent). "Their turn" has no mark — the preview reads "You:".
  const showDecision = !isAgentThread && Boolean(thread.hasOpenDecision)
  const showNeedsReply = !isDirect && !isAgentThread && !showDecision && threadNeedsReply(thread)
  // Purple cue only when AI has real work on the thread (open decision).
  const aiActive = !isDirect && !isAgentThread && showDecision
  // Only exceptions get an icon: a conversation or contact override. Rows that
  // follow their channel stay quiet.
  const handling = thread.aiHandling
  const handlingOverride =
    !isDirect && !isAgentThread && handling && (handling.source === 'conversation' || handling.source === 'contact')
      ? handling.effective
      : null
  const selectable = Boolean(onToggleChecked)
  const checkboxVisible = selectable && (selectionActive || Boolean(checked))
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  const ticketNameLower = ticket?.name.trim().toLowerCase() ?? ''
  const freeTags = (thread.tags ?? []).filter((tag) => tag.trim().toLowerCase() !== ticketNameLower)
  const hasMeta = Boolean((assigneeName && !isDirect) || ticket || freeTags.length > 0)

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
        'row-interactive group/thread w-full cursor-pointer rounded-md border border-transparent px-2.5 text-left',
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
      <div className="flex min-w-0 items-start gap-2">
        {/* Lead slot: state dot, or the checkbox when selecting. */}
        <span className="relative mt-0.5 flex h-7 w-4 shrink-0 items-center justify-center">
          <span
            aria-hidden
            className={cn(
              'absolute inset-0 flex items-center justify-center transition-opacity',
              checkboxVisible && 'opacity-0',
              selectable && !checkboxVisible && 'group-hover/thread:opacity-0',
            )}
          >
            {thread.isPinned ? (
              <Pin size={10} className="rotate-45 fill-text-muted text-text-muted" />
            ) : (
              <ThreadStatusDot
                status={thread.status}
                unread={thread.hasUnread}
                className={cn(thread.hasUnread && isSelected && 'pulse-dot')}
              />
            )}
          </span>
          {selectable ? (
            <input
              type="checkbox"
              checked={Boolean(checked)}
              aria-label={t('threadList.selectThread')}
              onClick={stop}
              onKeyDown={stop}
              onChange={(event) =>
                onToggleChecked?.(thread.id, (event.nativeEvent as MouseEvent).shiftKey)
              }
              className={cn(
                'absolute h-3.5 w-3.5 cursor-pointer rounded border-border accent-[rgb(var(--color-accent))] transition-opacity',
                checkboxVisible
                  ? 'opacity-100'
                  : 'opacity-0 group-hover/thread:opacity-100 focus-visible:opacity-100',
              )}
            />
          ) : null}
        </span>

        {isDirect || isAgentThread ? (
          <AiAvatar
            {...toAiAvatarProps(thread)}
            size={28}
            className="mt-0.5"
            decorative
          />
        ) : (
          <PersonAvatar name={thread.contactName} email={thread.contactEmail} size={28} className="mt-0.5" />
        )}

        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center justify-between gap-1">
            <span
              className={cn(
                'min-w-0 truncate-fade text-sm font-medium',
                thread.hasUnread ? 'text-text-heading' : 'text-text-primary',
              )}
            >
              {primaryLabel}
            </span>
            <div className="flex shrink-0 items-center gap-0.5">
              {showActions && (thread.status === 'closed' || thread.status === 'spam') ? (
                <button
                  type="button"
                  disabled={deleting}
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete?.(thread.id)
                  }}
                  onKeyDown={stop}
                  title={t('threadList.deleteThread')}
                  aria-label={t('threadList.deleteThread')}
                  className={cn(ROW_ICON_BUTTON, 'hover:bg-status-error/10 hover:text-status-error')}
                >
                  <Trash2 size={13} />
                </button>
              ) : showActions && onClose ? (
                <button
                  type="button"
                  disabled={deleting}
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose(thread.id)
                  }}
                  onKeyDown={stop}
                  title={t('threadList.closeThread')}
                  aria-label={t('threadList.closeThread')}
                  className={cn(ROW_ICON_BUTTON, 'hover:bg-bg-hover hover:text-text-heading')}
                >
                  <Archive size={13} />
                </button>
              ) : null}
              {showActions ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={stop}
                    onPointerDown={stop}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') stop(e)
                    }}
                    aria-label={t('threadChrome.threadActions')}
                    title={t('threadChrome.threadActions')}
                    className={cn(ROW_ICON_BUTTON, 'hover:bg-bg-hover hover:text-text-heading')}
                  >
                    <MoreHorizontal size={13} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={4} onClick={stop}>
                  {thread.hasUnread ? (
                    <DropdownMenuItem className="gap-2" onSelect={() => onMarkRead?.(thread.id)}>
                      <MailOpen size={13} className="text-text-muted" />
                      {t('threadChrome.markRead')}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem className="gap-2" onSelect={() => onMarkUnread?.(thread.id)}>
                      <Mail size={13} className="text-text-muted" />
                      {t('threadChrome.markUnread')}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="gap-2"
                    onSelect={() => onTogglePin?.(thread.id, thread.isPinned)}
                  >
                    {thread.isPinned ? (
                      <PinOff size={13} className="text-text-muted" />
                    ) : (
                      <Pin size={13} className="text-text-muted" />
                    )}
                    {thread.isPinned ? t('threadChrome.unpin') : t('threadChrome.pin')}
                  </DropdownMenuItem>
                  {onSnooze ? (
                    <DropdownMenuItem className="gap-2" onSelect={() => onSnooze(thread.id)}>
                      <Clock size={13} className="text-text-muted" />
                      {t('snooze.tomorrow')}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
              ) : null}
              <span
                className="text-xs tabular-nums text-text-muted"
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
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  priorityDot,
                  thread.priority === 'urgent' && 'pulse-dot',
                )}
              />
            ) : null}
            <span className="min-w-0 flex-1 truncate-fade text-xs font-medium text-text-secondary">
              {secondaryLabel}
            </span>
            {handlingOverride ? (
              <span
                title={tc(`aiHandling.modes.${handlingOverride}.label`)}
                className="inline-flex shrink-0"
                data-testid="thread-row-ai-handling"
              >
                <AiHandlingIcon mode={handlingOverride} size={12} />
              </span>
            ) : null}
            {showDecision ? (
              <span
                title={t('listItem.needsDecision')}
                aria-label={t('listItem.needsDecision')}
                className="ml-auto inline-flex shrink-0 text-ai-ink"
              >
                <ArrowLeft size={13} strokeWidth={2.25} aria-hidden />
              </span>
            ) : showNeedsReply ? (
              <span
                title={t('listItem.needsReply')}
                aria-label={t('listItem.needsReply')}
                className="ml-auto inline-flex shrink-0 text-accent"
              >
                <ArrowLeft size={13} strokeWidth={2.25} aria-hidden />
              </span>
            ) : null}
          </div>

          {hasMeta ? (
            <div
              className={cn(
                'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
                // Keep rows open while bulk-selecting so hover never shifts checkbox targets.
                compact && !isSelected && !selectionActive
                  ? 'grid-rows-[0fr] group-hover/thread:grid-rows-[1fr] group-focus-within/thread:grid-rows-[1fr]'
                  : 'grid-rows-[1fr]',
              )}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="mt-1 flex min-w-0 items-center gap-2">
                  {assigneeName && !isDirect ? (
                    <div className="flex min-w-0 shrink items-center gap-1">
                      {assigneeKind === 'team' ? (
                        <TeamAvatar
                          {...toTeamAvatarProps({
                            id: assigneeSeed,
                            name: assigneeName,
                            avatar_kind: assigneeAvatarKind,
                            avatar_icon: assigneeAvatarIcon,
                            avatar_color: assigneeAvatarColor,
                            avatar_image_url: assigneeAvatarImageUrl,
                          })}
                          size={14}
                          decorative
                          presence={assigneePresence}
                        />
                      ) : assigneeKind === 'agent' ? (
                        <AiAvatar
                          {...toAiAvatarProps({
                            id: assigneeSeed,
                            name: assigneeName,
                            avatar_kind: assigneeAvatarKind,
                            avatar_icon: assigneeAvatarIcon,
                            avatar_image_url: assigneeAvatarImageUrl,
                          })}
                          size={14}
                          decorative
                          activity={assigneeSeed ? agentPresenceOf(assigneeSeed) : 'standby'}
                        />
                      ) : (
                        <UserAvatar
                          name={assigneeName ?? '?'}
                          email={assigneeEmail ?? assigneeName ?? ''}
                          avatarUrl={assigneeAvatarUrl}
                          size={14}
                          decorative
                          presence={
                            assigneePresence === 'available' ||
                            assigneePresence === 'away' ||
                            assigneePresence === 'offline'
                              ? assigneePresence
                              : undefined
                          }
                        />
                      )}
                      <span className="truncate-fade text-xs text-text-muted">
                        {assigneeName ?? t('listItem.assigned')}
                      </span>
                    </div>
                  ) : null}
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    {ticket ? (
                      <span
                        className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/70 px-1.5 text-2xs text-text-muted"
                        title={ticket.stage ? `${ticketName} · ${stageLabel(ticket.stage, t)}` : ticketName}
                        data-testid="thread-row-ticket"
                      >
                        <HashtagMark category />
                        <span className="truncate">{ticket.name}</span>
                        {ticket.stage ? (
                          <>
                            <StageProgressIcon kind={ticket.stage.kind} className="size-3" />
                            <span className="truncate">{stageLabel(ticket.stage, t)}</span>
                          </>
                        ) : null}
                      </span>
                    ) : null}
                    {freeTags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex max-w-[7rem] items-center gap-0.5 text-2xs text-text-muted"
                        title={`#${tag}`}
                      >
                        <HashtagMark />
                        <span className="truncate">{tag}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default memo(ThreadListItem)
