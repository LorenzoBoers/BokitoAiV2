/**
 * Thread header chrome: who this conversation is with, its status, the AI
 * handling picker (which owns take over / hand back), and the action cluster.
 */
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Bot,
  Clock,
  Flag,
  Forward,
  Hand,
  Hash,
  Link2,
  ListPlus,
  Mail,
  MoreHorizontal,
  OctagonAlert,
  PanelRightOpen,
  Pin,
  PinOff,
  ShieldBan,
  Star,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import type { InboxThread, PatchThreadInput, ThreadDetail as ThreadDetailType } from '../../lib/inbox-api'
import { humanizeContactName, isGenericVisitorName, isPlaceholderContactAddress } from '../../lib/contact-label'
import { isInternalThread, threadCounterpartyName, threadHubPath } from '../../lib/message-composer'
import { translateDecisionText } from '../../lib/activity-labels'
import { threadStatusLabel } from '../../lib/status-labels'
import { formatWakeTime, SNOOZE_PRESETS, snoozeUntilIso, toLocalDateTimeValue } from '../../lib/snooze'
import {
  THREAD_ACTION_CLUSTER_CLASS,
  THREAD_HEADER_CLASS,
  THREAD_HEADER_ICON_CLASS,
} from '../../lib/chat-chrome'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import AssigneeSelector from './AssigneeSelector'
import AiHandlingPicker from '../ai/AiHandlingPicker'
import { AI_HANDLING_CHANNELS, type AiHandlingMode } from '../../lib/ai-handling'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import { PRIORITY_META } from './ConversationWorkSection'

const HEADER_ICON = THREAD_HEADER_ICON_CLASS

type Props = {
  thread: InboxThread
  csat?: ThreadDetailType['csat']
  saving: boolean
  loading: boolean
  /** Number of earlier conversations with this contact (links to the panel). */
  previousCount: number
  onPatch: (input: PatchThreadInput) => Promise<void>
  /** Close flow that first asks about still-open Signals. */
  onRequestClose: () => void | Promise<void>
  closeBusy?: boolean
  onBack?: () => void
  onToggleContact?: () => void
  contactOpen?: boolean
  /** Conversation AI handling; ``assignToMe`` turns manual into a take over. */
  onChangeAiHandling?: (
    mode: AiHandlingMode | null,
    opts?: { assignToMe?: boolean },
  ) => void | Promise<void>
  aiHandlingSaving?: boolean
  onForward?: () => void
  onMarkUnread?: () => void | Promise<void>
  onTogglePin?: () => void | Promise<void>
  onDelete?: () => void | Promise<void>
  deleting?: boolean
  onAlwaysCloseSender?: () => void | Promise<void>
  closingSender?: boolean
  /** Block the counterparty contact (external threads). */
  onBlockContact?: () => void | Promise<void>
  blockingContact?: boolean
  /** Opens the look-again planner (external, open threads). */
  onWhatsNext?: () => void
  /** Items under "This conversation" in the panel; shown while the panel is closed. */
  panelCount?: number
}

export default function ThreadHeader({
  thread,
  csat,
  saving,
  loading,
  previousCount,
  onPatch,
  onRequestClose,
  closeBusy = false,
  onBack,
  onToggleContact,
  contactOpen,
  onChangeAiHandling,
  aiHandlingSaving = false,
  onForward,
  onMarkUnread,
  onTogglePin,
  onDelete,
  deleting = false,
  onAlwaysCloseSender,
  closingSender = false,
  onBlockContact,
  blockingContact = false,
  onWhatsNext,
  panelCount = 0,
}: Props) {
  const { t, i18n } = useTranslation('communication')
  const { t: tc } = useTranslation('common')
  const canRaise = useIsAdmin()
  const internal = isInternalThread(thread)
  const handling = thread.aiHandling ?? null
  const showHandling =
    !internal && Boolean(onChangeAiHandling) && AI_HANDLING_CHANNELS.has((thread.channel ?? '').toLowerCase())
  const held = handling?.own === 'manual'
  const canSnooze = !internal && thread.status !== 'closed' && thread.status !== 'spam'
  const priority = thread.priority || 'normal'
  const priorityMeta = PRIORITY_META[priority] ?? PRIORITY_META.normal

  // The " · email" suffix is skipped when the name already is the address, to
  // avoid reading "x@y · x@y".
  const contactDisplayName =
    humanizeContactName(thread.contactName, thread.contactEmail, t('contactPanel.widgetVisitor')) ||
    (isPlaceholderContactAddress(thread.contactEmail) ? '' : thread.contactEmail)

  return (
    <div className={THREAD_HEADER_CLASS}>
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label={t('threadChrome.backToConversations')}
          className="-ml-1 shrink-0 rounded-md p-1.5 text-text-muted hover:bg-bg-hover hover:text-text-primary md:hidden"
        >
          <ArrowLeft size={16} />
        </button>
      ) : null}
      <div className="min-w-0 flex-1 overflow-hidden leading-tight">
        <h2 className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-text-heading">
          {priority !== 'normal' ? (
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${priorityMeta.dot}`}
              title={`${t('threadChrome.setPriority')}: ${t(priorityMeta.labelKey)}`}
            />
          ) : null}
          <span className="min-w-0 flex-1 truncate-fade">{translateDecisionText(thread.emailSubject, t)}</span>
        </h2>
        <p className="truncate-fade text-xs text-text-muted">
          {internal ? (
            <>
              {`${t('threadChrome.internalPrefix')} · ${threadCounterpartyName(thread)}`}
              <span className="text-text-muted/75">
                {' · '}
                {threadStatusLabel(thread.status, t)}
              </span>
            </>
          ) : (
            <>
              {thread.contactId &&
              !isGenericVisitorName(thread.contactName) &&
              Boolean((thread.contactName || '').trim()) ? (
                <Link to={`/contacts/${thread.contactId}`} className="hover:text-accent hover:underline">
                  {humanizeContactName(
                    thread.contactName,
                    thread.contactEmail,
                    t('contactPanel.widgetVisitor'),
                  ) ||
                    (isPlaceholderContactAddress(thread.contactEmail)
                      ? t('contactPanel.widgetVisitor')
                      : thread.contactEmail || t('listItem.contact'))}
                </Link>
              ) : (
                contactDisplayName
              )}
              {thread.contactEmail &&
              !isPlaceholderContactAddress(thread.contactEmail) &&
              contactDisplayName !== thread.contactEmail ? (
                <>
                  {' · '}
                  <button
                    type="button"
                    title={t('threadChrome.copyEmail')}
                    onClick={() => {
                      void navigator.clipboard.writeText(thread.contactEmail).then(
                        () => toast.success(t('threadChrome.emailCopied')),
                        () => toast.error(t('threadChrome.copyEmail')),
                      )
                    }}
                    className="hover:text-accent hover:underline"
                  >
                    {thread.contactEmail}
                  </button>
                </>
              ) : null}
              {previousCount > 0 && onToggleContact ? (
                <>
                  {' · '}
                  <button type="button" onClick={onToggleContact} className="hover:text-accent hover:underline">
                    {t('threadChrome.earlierConversations', { count: previousCount })}
                  </button>
                </>
              ) : null}
              <span className="text-text-muted/75">
                {' · '}
                {threadStatusLabel(thread.status, t)}
                {thread.status === 'pending'
                  ? ` · ${
                      (thread.snoozedUntil
                        ? formatWakeTime(thread.snoozedUntil, t, i18n.language)
                        : null) ?? t('snooze.wakesOnReply')
                    }`
                  : ''}
              </span>
            </>
          )}
        </p>
      </div>
      {csat ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-border/70 px-2 text-xs font-medium text-text-primary"
              aria-label={t('threadChrome.customerRatingScore', { score: csat.score })}
            >
              <Star size={11} className="fill-amber-500 text-amber-500" />
              {csat.score}/5
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-64">
            {csat.comment
              ? t('threadChrome.customerRatingWithComment', { comment: csat.comment })
              : t('threadChrome.customerRating')}
          </TooltipContent>
        </Tooltip>
      ) : null}
      <div className={THREAD_ACTION_CLUSTER_CLASS} role="toolbar" aria-label={t('threadChrome.threadActions')}>
        {showHandling && onChangeAiHandling ? (
          <AiHandlingPicker
            handling={handling}
            scope="conversation"
            canRaise={canRaise}
            saving={aiHandlingSaving || loading}
            onChange={(mode) => onChangeAiHandling(mode)}
            testId="thread-ai-handling"
            extraItems={
              held ? (
                <DropdownMenuItem className="gap-2 text-xs" onSelect={() => void onChangeAiHandling(null)}>
                  <Bot size={13} />
                  {tc('aiHandling.handBack')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  className="gap-2 text-xs"
                  onSelect={() => void onChangeAiHandling('manual', { assignToMe: true })}
                >
                  <Hand size={13} />
                  {tc('aiHandling.takeOver')}
                </DropdownMenuItem>
              )
            }
          />
        ) : null}
        <AssigneeSelector
          threadId={String(thread.id)}
          owner={thread.owner}
          currentAssigneeId={thread.assignedToUserId}
          disabled={saving}
          onAssign={(assignee) =>
            assignee.kind === 'team' && (assignee.id == null || assignee.id === '')
              ? onPatch({ assignee: { kind: 'team', id: null }, assignedToUserId: 0 })
              : onPatch({ assignee })
          }
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled={saving || closeBusy}
              onClick={() => {
                if (thread.status === 'closed') {
                  void onPatch({ status: 'open' })
                  return
                }
                void onRequestClose()
              }}
              aria-label={thread.status === 'closed' ? t('threadChrome.reopen') : t('threadChrome.close')}
              className={HEADER_ICON}
            >
              {thread.status === 'closed' ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {thread.status === 'closed' ? t('threadChrome.reopen') : t('threadChrome.close')}
          </TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={saving}
                  aria-label={t('threadChrome.moreActions')}
                  className={HEADER_ICON}
                >
                  <MoreHorizontal size={14} />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('threadChrome.moreActions')}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="min-w-48">
            {!internal ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="gap-2">
                  <Flag size={13} />
                  {t('threadChrome.setPriority')}
                  <span className={`ml-auto h-1.5 w-1.5 rounded-full ${priorityMeta.dot}`} />
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-36">
                  {Object.entries(PRIORITY_META).map(([value, meta]) => (
                    <DropdownMenuItem
                      key={value}
                      className="gap-2"
                      onClick={() => void onPatch({ priority: value as PatchThreadInput['priority'] })}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                      {t(meta.labelKey)}
                      {value === priority ? (
                        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-text-heading" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
            {canSnooze ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="gap-2">
                  <Clock size={13} />
                  {t('threadChrome.snooze')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-44">
                  {thread.status === 'pending' ? (
                    <DropdownMenuItem onClick={() => void onPatch({ status: 'open', snoozedUntil: null })}>
                      {t('threadChrome.resumeNow')}
                    </DropdownMenuItem>
                  ) : null}
                  {SNOOZE_PRESETS.map((preset) => (
                    <DropdownMenuItem
                      key={preset.key}
                      onClick={() =>
                        void onPatch({ status: 'pending', snoozedUntil: snoozeUntilIso(preset) })
                      }
                    >
                      {t(preset.labelKey)}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem
                    onClick={() => {
                      const raw = window.prompt(t('snooze.customTitle'), toLocalDateTimeValue())
                      if (!raw) return
                      const wake = new Date(raw)
                      if (Number.isNaN(wake.getTime()) || wake.getTime() <= Date.now()) {
                        toast.error(t('snooze.customInvalid'))
                        return
                      }
                      void onPatch({ status: 'pending', snoozedUntil: wake.toISOString() })
                    }}
                  >
                    {t('snooze.custom')}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
            {canSnooze && onWhatsNext ? (
              <DropdownMenuItem className="gap-2" onClick={() => onWhatsNext()}>
                <ListPlus size={13} />
                {t('threadChrome.whatsNext')}
              </DropdownMenuItem>
            ) : null}
            {!internal ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              className="gap-2"
              onClick={() => {
                const url = `${window.location.origin}${threadHubPath(thread)}`
                void navigator.clipboard.writeText(url).then(
                  () => toast.success(t('threadChrome.linkCopied')),
                  () => toast.error(t('threadChrome.copyLink')),
                )
              }}
            >
              <Link2 size={13} />
              {t('threadChrome.copyLink')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2"
              onClick={() => {
                void navigator.clipboard.writeText(String(thread.id)).then(
                  () => toast.success(t('threadChrome.threadIdCopied')),
                  () => toast.error(t('threadChrome.copyThreadId')),
                )
              }}
            >
              <Hash size={13} />
              {t('threadChrome.copyThreadId')}
            </DropdownMenuItem>
            {thread.graphConversationId ? (
              <DropdownMenuItem
                className="gap-2"
                onClick={() => {
                  void navigator.clipboard.writeText(thread.graphConversationId).then(
                    () => toast.success(t('threadChrome.externalIdCopied')),
                    () => toast.error(t('threadChrome.copyExternalId')),
                  )
                }}
              >
                <Hash size={13} />
                {t('threadChrome.copyExternalId')}
              </DropdownMenuItem>
            ) : null}
            {onForward ? (
              <DropdownMenuItem className="gap-2" disabled={loading} onClick={() => onForward()}>
                <Forward size={13} />
                {t('threadChrome.forwardAsEmail')}
              </DropdownMenuItem>
            ) : null}
            {!internal &&
            onAlwaysCloseSender &&
            thread.contactEmail &&
            !isPlaceholderContactAddress(thread.contactEmail) ? (
              <DropdownMenuItem
                className="gap-2"
                disabled={closingSender}
                onClick={() => void onAlwaysCloseSender()}
              >
                <Archive size={13} />
                {t('threadChrome.alwaysCloseFromSender')}
              </DropdownMenuItem>
            ) : null}
            {!internal && onBlockContact && thread.contactId ? (
              <DropdownMenuItem
                className="gap-2 text-status-error"
                disabled={blockingContact}
                onClick={() => void onBlockContact()}
              >
                <ShieldBan size={13} />
                {t('threadChrome.blockContact', {
                  name:
                    contactDisplayName ||
                    (!isPlaceholderContactAddress(thread.contactEmail) && thread.contactEmail) ||
                    t('contactPanel.thisContact'),
                })}
              </DropdownMenuItem>
            ) : null}
            {!internal ? (
              <DropdownMenuItem
                className="gap-2"
                onClick={() => void onPatch({ status: thread.status === 'spam' ? 'open' : 'spam' })}
              >
                <OctagonAlert size={13} />
                {thread.status === 'spam' ? t('threadChrome.notSpam') : t('threadChrome.markSpam')}
              </DropdownMenuItem>
            ) : null}
            {onMarkUnread && !thread.hasUnread ? (
              <DropdownMenuItem className="gap-2" disabled={loading} onClick={() => void onMarkUnread()}>
                <Mail size={13} />
                {t('threadChrome.markUnread')}
              </DropdownMenuItem>
            ) : null}
            {onTogglePin ? (
              <DropdownMenuItem className="gap-2" disabled={loading} onClick={() => void onTogglePin()}>
                {thread.isPinned ? <PinOff size={13} /> : <Pin size={13} />}
                {thread.isPinned ? t('threadChrome.unpinThread') : t('threadChrome.pinThread')}
              </DropdownMenuItem>
            ) : null}
            {onDelete ? (
              <DropdownMenuItem
                disabled={deleting}
                className="gap-2 text-status-error"
                onClick={() => void onDelete()}
              >
                <Trash2 size={13} />
                {t('threadChrome.delete')}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        {onToggleContact && !contactOpen ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggleContact}
                aria-label={t('threadChrome.showDetails')}
                className={`relative ${HEADER_ICON}`}
              >
                <PanelRightOpen size={13} />
                {panelCount > 0 ? (
                  <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-text-heading px-1 text-[9px] font-medium leading-none text-bg tabular-nums">
                    {panelCount > 9 ? '9+' : panelCount}
                  </span>
                ) : null}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t('threadChrome.showDetails')}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  )
}
