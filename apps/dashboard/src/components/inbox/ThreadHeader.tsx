/**
 * Thread header chrome: who this conversation is with, its status, the AI
 * status chip (which owns takeover / hand back), and the action cluster.
 */
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Clock,
  Forward,
  Hash,
  Link2,
  Mail,
  MoreHorizontal,
  OctagonAlert,
  PanelRight,
  Pin,
  PinOff,
  Star,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import type { InboxThread, PatchThreadInput, ThreadDetail as ThreadDetailType } from '../../lib/inbox-api'
import { humanizeContactName, isPlaceholderContactAddress } from '../../lib/contact-label'
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
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import AssigneeSelector from './AssigneeSelector'
import AiStatusChip from './AiStatusChip'

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
  onToggleTakeover?: () => void | Promise<void>
  onForward?: () => void
  onMarkUnread?: () => void | Promise<void>
  onTogglePin?: () => void | Promise<void>
  onDelete?: () => void | Promise<void>
  deleting?: boolean
  onAlwaysCloseSender?: () => void | Promise<void>
  closingSender?: boolean
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
  onToggleTakeover,
  onForward,
  onMarkUnread,
  onTogglePin,
  onDelete,
  deleting = false,
  onAlwaysCloseSender,
  closingSender = false,
}: Props) {
  const { t, i18n } = useTranslation('communication')
  const internal = isInternalThread(thread)

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
      <div className="min-w-0 flex-1 leading-tight">
        <h2 className="truncate text-[13px] font-medium text-text-heading">
          {translateDecisionText(thread.emailSubject, t)}
        </h2>
        <p className="truncate text-[11px] text-text-muted">
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
              {thread.contactId ? (
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
              className="flex shrink-0 items-center gap-1 rounded-full border border-border/60 bg-bg-surface-hover/40 px-2 py-0.5 text-[11px] font-medium text-text-primary"
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
        <AiStatusChip
          aiMode={thread.aiMode ?? null}
          aiPaused={Boolean(thread.aiPaused)}
          assignedToUserId={thread.assignedToUserId}
          channel={thread.channel}
          saving={saving || loading}
          onTakeover={onToggleTakeover}
          onHandBack={onToggleTakeover}
        />
        <AssigneeSelector
          currentAssigneeId={thread.assignedToUserId}
          disabled={saving}
          onChange={(userId) => void onPatch({ assignedToUserId: userId ?? 0 })}
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
        {!internal && thread.status !== 'closed' && thread.status !== 'spam' ? (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={saving}
                    aria-label={
                      thread.status === 'pending' ? t('threadChrome.resumeNow') : t('threadChrome.snooze')
                    }
                    className={`${HEADER_ICON}${thread.status === 'pending' ? ' text-accent' : ''}`}
                  >
                    <Clock size={14} />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {thread.status === 'pending' ? t('threadChrome.resumeNow') : t('threadChrome.snooze')}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="min-w-44">
              {thread.status === 'pending' ? (
                <DropdownMenuItem onClick={() => void onPatch({ status: 'open', snoozedUntil: null })}>
                  {t('threadChrome.resumeNow')}
                </DropdownMenuItem>
              ) : null}
              {SNOOZE_PRESETS.map((preset) => (
                <DropdownMenuItem
                  key={preset.key}
                  onClick={() => void onPatch({ status: 'pending', snoozedUntil: snoozeUntilIso(preset) })}
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
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
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
          <DropdownMenuContent align="end" className="min-w-44">
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
        {onToggleContact ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggleContact}
                aria-label={contactOpen ? t('threadChrome.hideDetails') : t('threadChrome.showDetails')}
                aria-pressed={contactOpen}
                className={`${HEADER_ICON}${contactOpen ? ' text-accent' : ''}`}
              >
                <PanelRight size={13} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {contactOpen ? t('threadChrome.hideDetails') : t('threadChrome.showDetails')}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  )
}
