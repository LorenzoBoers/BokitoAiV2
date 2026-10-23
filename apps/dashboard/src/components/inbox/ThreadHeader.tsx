/**
 * Thread header chrome: who this conversation is with, its status, the AI
 * handling picker (Manual assigns to you; hand back when held), and actions.
 */
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Bot,
  BookMarked,
  CalendarClock,
  Flag,
  Forward,
  Hash,
  Link2,
  Mail,
  Minimize2,
  MoreHorizontal,
  OctagonAlert,
  PanelRightOpen,
  Pin,
  PinOff,
  ShieldBan,
  Star,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import type {
  InboxThread,
  PatchThreadInput,
  ThreadActiveTurn,
  ThreadDetail as ThreadDetailType,
  ThreadParticipant,
} from '../../lib/inbox-api'
import { ParticipantStrip } from './ParticipantStrip'
import { ThreadWhyPanel } from './ThreadWhyPanel'
import { setThreadExample } from '../../lib/signals-api'
import { ENTITY_ICONS } from '../../lib/entity-icons'
import { openEntityPath } from '../../lib/open-entity'
import { humanizeContactName, isGenericVisitorName, isPlaceholderContactAddress } from '../../lib/contact-label'
import { isInternalThread, threadCounterpartyName, threadFace, threadHubPath } from '../../lib/message-composer'
import { translateDecisionText } from '../../lib/activity-labels'
import { threadStatusLabel } from '../../lib/status-labels'
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
import { Tooltip, TooltipContent, TooltipLabel, TooltipTrigger } from '../ui/tooltip'
import AssigneeSelector from './AssigneeSelector'
import AiHandlingPicker from '../ai/AiHandlingPicker'
import { AI_HANDLING_CHANNELS, type AiHandlingMode } from '../../lib/ai-handling'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import { PRIORITY_META } from './ConversationWorkSection'
import { Button } from '../ui/button'
import { requestMinimizeToStack } from '../../lib/chat-stack'
import { cn } from '../../lib/utils'

const HEADER_ICON = THREAD_HEADER_ICON_CLASS
const FolderIcon = ENTITY_ICONS.project

type Props = {
  thread: InboxThread
  csat?: ThreadDetailType['csat']
  saving: boolean
  loading: boolean
  /** Number of earlier conversations with this contact (links to the panel). */
  previousCount: number
  onPatch: (input: PatchThreadInput) => Promise<boolean | void>
  /** Close flow that first asks about still-open Signals. */
  onRequestClose: () => void | Promise<void>
  /** File this conversation in a project folder. */
  onFileInFolder?: () => void
  /** Close and file in one step. */
  onCloseAndFile?: () => void
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
  /** Opens the planner: a date or repeat for this thread. */
  onPlan?: () => void
  /** Items under "This conversation" in the panel; shown while the panel is closed. */
  panelCount?: number
  /** After toggling the few-shot example flag on a closed conversation. */
  onExampleChanged?: (isExample: boolean) => void
  /** The project folder this conversation is filed in; `path` is the ancestor chain. */
  folder?: { id: string; name: string; path: string } | null
  /** Humans and agents on this conversation (hub strip). */
  participants?: ThreadParticipant[]
  /** Who currently has the multi-agent floor. */
  activeTurn?: ThreadActiveTurn
}

/** " · [folder] Name" after the status: where this conversation is filed. */
function FolderLink({ folder, label }: { folder: { id: string; name: string; path: string }; label: string }) {
  return (
    <>
      {' · '}
      <Link
        to={openEntityPath({ type: 'project', id: folder.id })}
        className="inline-flex max-w-[12rem] items-center gap-1 align-bottom hover:text-accent hover:underline"
        title={`${label}: ${folder.path}`}
        data-testid="thread-folder-link"
      >
        <FolderIcon size={11} className="shrink-0" aria-hidden />
        <span className="truncate">{folder.name}</span>
      </Link>
    </>
  )
}

export default function ThreadHeader({
  thread,
  csat,
  saving,
  loading,
  previousCount,
  onPatch,
  onRequestClose,
  onFileInFolder,
  onCloseAndFile,
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
  onPlan,
  panelCount = 0,
  onExampleChanged,
  folder = null,
  participants = [],
  activeTurn = null,
}: Props) {
  const { t } = useTranslation('communication')
  const { t: tc } = useTranslation('common')
  const { token } = useAuth()
  const canRaise = useIsAdmin()
  const [exampleBusy, setExampleBusy] = useState(false)
  const internal = isInternalThread(thread)
  const handling = thread.aiHandling ?? null
  const showHandling =
    !internal && Boolean(onChangeAiHandling) && AI_HANDLING_CHANNELS.has((thread.channel ?? '').toLowerCase())
  const held = handling?.own === 'manual'
  const priority = thread.priority || 'normal'
  const priorityMeta = PRIORITY_META[priority] ?? PRIORITY_META.normal
  // The " · email" suffix is skipped when the name already is the address, to
  // avoid reading "x@y · x@y".
  const contactDisplayName =
    humanizeContactName(thread.contactName, thread.contactEmail, t('contactPanel.widgetVisitor')) ||
    (isPlaceholderContactAddress(thread.contactEmail) ? '' : thread.contactEmail)

  return (
    <div className={THREAD_HEADER_CLASS} data-thread-header>
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
        <h2 className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-text-heading">
          {priority !== 'normal' ? (
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${priorityMeta.dot}`}
              title={`${t('threadChrome.setPriority')}: ${t(priorityMeta.labelKey)}`}
            />
          ) : null}
          <span className="min-w-0 flex-1 truncate" title={translateDecisionText(thread.emailSubject, t)}>
            {translateDecisionText(thread.emailSubject, t)}
          </span>
        </h2>
        <p className="truncate-fade text-xs text-text-muted">
          {internal ? (
            <>
              {`${t('threadChrome.internalPrefix')} · ${threadCounterpartyName(thread)}`}
              <span className="text-text-muted">
                {' · '}
                {threadStatusLabel(thread.status, t)}
              </span>
              {folder ? <FolderLink folder={folder} label={t('threadChrome.filedIn')} /> : null}
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
              <span className="text-text-muted">
                {' · '}
                {threadStatusLabel(thread.status, t)}
              </span>
              {folder ? <FolderLink folder={folder} label={t('threadChrome.filedIn')} /> : null}
            </>
          )}
        </p>
        <ParticipantStrip
          participants={participants}
          owner={thread.owner}
          activeTurn={activeTurn}
          faceId={threadFace(thread).id}
          waitingLabel={t('threadChrome.waitingOnParticipant', {
            defaultValue: 'Waiting on {{name}}',
            name: '{{name}}',
          })}
        />
      </div>
      {csat ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs font-medium text-text-primary"
              aria-label={t('threadChrome.customerRatingScore', { score: csat.score })}
            >
              <Star size={14} className="fill-status-warning text-status-warning" />
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
        {showHandling ? <ThreadWhyPanel threadId={String(thread.id)} /> : null}
        {showHandling && onChangeAiHandling ? (
          <AiHandlingPicker
            handling={handling}
            scope="conversation"
            canRaise={canRaise}
            saving={aiHandlingSaving || loading}
            onChange={(mode) =>
              // Manual on a conversation is take-over: assign to the operator.
              void onChangeAiHandling(mode, mode === 'manual' ? { assignToMe: true } : undefined)
            }
            testId="thread-ai-handling"
            extraItems={
              held ? (
                <DropdownMenuItem className="gap-2 text-xs" onSelect={() => void onChangeAiHandling(null)}>
                  <Bot size={14} />
                  {tc('aiHandling.handBack')}
                </DropdownMenuItem>
              ) : null
            }
          />
        ) : null}
        <AssigneeSelector
          threadId={String(thread.id)}
          owner={thread.owner}
          currentAssigneeId={thread.assignedToUserId}
          disabled={saving}
          onAssign={(assignee) => {
            void onPatch(
              assignee.kind === 'team' && (assignee.id == null || assignee.id === '')
                ? { assignee: { kind: 'team', id: null }, assignedToUserId: 0 }
                : { assignee },
            )
          }}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="iconSm"
              aria-label={t('chatStack.minimizeToStack')}
              className={cn(HEADER_ICON, 'hidden md:inline-flex')}
              data-testid="thread-minimize"
              onClick={(event) => {
                const header = event.currentTarget.closest('[data-thread-header]')
                requestMinimizeToStack(
                  String(thread.id),
                  header ? header.getBoundingClientRect() : null,
                  translateDecisionText(thread.emailSubject, t) || contactDisplayName,
                )
              }}
            >
              <Minimize2 size={14} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('chatStack.minimizeToStack')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled={saving || closeBusy}
              onClick={() => {
                if (thread.status === 'closed' || thread.status === 'pending') {
                  void onPatch({ status: 'open' })
                  return
                }
                void onRequestClose()
              }}
              aria-label={
                thread.status === 'closed' || thread.status === 'pending'
                  ? t('threadChrome.reopen')
                  : t('threadChrome.close')
              }
              className={HEADER_ICON}
            >
              {thread.status === 'closed' || thread.status === 'pending' ? (
                <ArchiveRestore size={14} />
              ) : (
                <Archive size={14} />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {thread.status === 'closed' || thread.status === 'pending' ? (
              t('threadChrome.reopen')
            ) : (
              <TooltipLabel detail="E">{t('threadChrome.close')}</TooltipLabel>
            )}
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
                  <Flag size={14} />
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
            {onPlan && thread.status !== 'spam' ? (
              <DropdownMenuItem className="gap-2" onClick={() => onPlan()}>
                <CalendarClock size={14} />
                {t('threadChrome.plan')}
              </DropdownMenuItem>
            ) : null}
            {onFileInFolder ? (
              <DropdownMenuItem className="gap-2" onClick={() => onFileInFolder()}>
                <FolderIcon size={13} />
                {t('threadChrome.fileInFolder')}
              </DropdownMenuItem>
            ) : null}
            {onCloseAndFile && thread.status !== 'closed' && thread.status !== 'spam' ? (
              <DropdownMenuItem className="gap-2" onClick={() => onCloseAndFile()}>
                <Archive size={14} />
                {t('threadChrome.closeAndFile')}
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
              <Link2 size={14} />
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
              <Hash size={14} />
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
                <Hash size={14} />
                {t('threadChrome.copyExternalId')}
              </DropdownMenuItem>
            ) : null}
            {onForward ? (
              <DropdownMenuItem className="gap-2" disabled={loading} onClick={() => onForward()}>
                <Forward size={14} />
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
                <Archive size={14} />
                {t('threadChrome.alwaysCloseFromSender')}
              </DropdownMenuItem>
            ) : null}
            {!internal && onBlockContact && thread.contactId ? (
              <DropdownMenuItem
                className="gap-2 text-status-error"
                disabled={blockingContact}
                onClick={() => void onBlockContact()}
              >
                <ShieldBan size={14} />
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
                <OctagonAlert size={14} />
                {thread.status === 'spam' ? t('threadChrome.notSpam') : t('threadChrome.markSpam')}
              </DropdownMenuItem>
            ) : null}
            {onMarkUnread && !thread.hasUnread ? (
              <DropdownMenuItem className="gap-2" disabled={loading} onClick={() => void onMarkUnread()}>
                <Mail size={14} />
                {t('threadChrome.markUnread')}
              </DropdownMenuItem>
            ) : null}
            {onTogglePin ? (
              <DropdownMenuItem className="gap-2" disabled={loading} onClick={() => void onTogglePin()}>
                {thread.isPinned ? <PinOff size={14} /> : <Pin size={14} />}
                {thread.isPinned ? t('threadChrome.unpinThread') : t('threadChrome.pinThread')}
              </DropdownMenuItem>
            ) : null}
            {!internal && thread.status === 'closed' && token ? (
              <DropdownMenuItem
                className="gap-2"
                disabled={exampleBusy || loading}
                onClick={() => {
                  void (async () => {
                    setExampleBusy(true)
                    try {
                      const next = await setThreadExample(token, String(thread.id), !thread.isExample)
                      onExampleChanged?.(next)
                      toast.success(
                        next
                          ? t('threadChrome.exampleOn', { defaultValue: 'Used as an example for the next reply' })
                          : t('threadChrome.exampleOff', { defaultValue: 'Removed as an example' }),
                      )
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : t('actions.patchError'))
                    } finally {
                      setExampleBusy(false)
                    }
                  })()
                }}
              >
                <BookMarked size={14} />
                {thread.isExample
                  ? t('threadChrome.removeExample', { defaultValue: 'Stop using as example' })
                  : t('threadChrome.useAsExample', { defaultValue: 'Use as example' })}
              </DropdownMenuItem>
            ) : null}
            {onDelete ? (
              <DropdownMenuItem
                disabled={deleting}
                className="gap-2 text-status-error"
                onClick={() => void onDelete()}
              >
                <Trash2 size={14} />
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
                <PanelRightOpen size={14} />
                {panelCount > 0 ? (
                  <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-text-heading px-1 text-2xs font-medium leading-none text-bg tabular-nums">
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
