import { AlertCircle, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import {
  createInboxRule,
  listInboxMembers,
  patchThread,
  resolveThreadDecision,
  type ThreadDetail as ThreadDetailType,
  type PatchThreadInput,
  type InboxMember,
  type ThreadId,
  type MessageAttachment,
} from '../../lib/inbox-api'
import { parseDecisionOptions, pickSoftDecisionTarget } from '../../lib/decision-options'
import { getContactThreads, updateContact } from '../../lib/contacts-api'
import {
  humanizeContactName,
  isPlaceholderContactAddress,
} from '../../lib/contact-label'
import { fileTicket, listCategories, stageLabel, type Ticket } from '../../lib/tickets-api'
import { normalizeHashtag } from '../../lib/hashtag'
import { TicketStageMoveCancelled, loadOpenTickets, resolveOpenTickets } from '../../lib/close-thread-signals'
import { useCollectStageFields } from './TicketStageGate'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { isAiHandlingVerb, type ParsedComposerVerb } from '../../lib/composer-verbs'
import type { AiHandlingMode } from '../../lib/ai-handling'
import { listSignalAssignees, patchSignalThread, type AssigneeCandidates } from '../../lib/signals-api'
import {
  decisionCardOpen,
  isOpenNoReplyCard,
  proposalBasedOnMessageId,
  replyProposalFromMessage,
} from './DecisionRequestMessage'
import RelatedConversationBanner from './RelatedConversationBanner'
import { HandledExternallyDialog } from './HandledExternallyForm'
import ReplyComposer from './ReplyComposer'
import ThreadHeader from './ThreadHeader'
import ThreadTimeline, { buildTimelineRows, type ThreadTimelineHandle } from './ThreadTimeline'
import type { ChatTagMap } from '../../lib/chatText'
import { useCommunicationNav } from '../../hooks/useCommunicationNav'
import { Button } from '../ui/button'
import { useConfirm } from '../ui/confirm-dialog'
import { InboxThreadSkeleton } from '../ui/skeleton'
import { TooltipProvider } from '../ui/tooltip'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { inboundQuoteText, suggestedReplyAllRecipients } from '../../lib/thread-intent'
import { useMailboxConnections } from '../../hooks/useMailboxConnections'
import {
  isInternalThread,
  resolveComposerSurface,
  type ComposerMode,
} from '../../lib/message-composer'
import { useSignalStream } from '../../hooks/useSignalStream'
import AgentTurnLive from './AgentTurnLive'
import { AiAvatar } from '../ui/AiAvatar'
import { toAiAvatarProps } from '../../lib/agent-avatar'
import { textOnlyTurn, turnHasContent, turnSaved } from '../../lib/agentActivity'
import {
  bokitoListMessages,
  closeAgentSession,
  discardAgentSession,
  startAgentSession,
  type ChatMessage,
} from '../../lib/signals-api'
import { useAiChatStream } from '../../lib/use-agent-session-chat'
import { applyAgentLive } from '../../hooks/useAgentPresence'
import { stripMentionMarkup, type MentionItem } from '../../lib/mentions'
import { talkToAssistantPath } from '../../lib/talk-to-assistant'
import { toast } from 'sonner'

const autoSentThreads = new Set<string>()

type Props = {
  detail: ThreadDetailType | null
  loading: boolean
  /**
   * Non-null when the most recent fetch of the selected thread failed. Used
   * to show explicit feedback in the empty area instead of silently falling
   * back to the "Select a thread" placeholder, which made it look like
   * nothing happened.
   */
  error: string | null
  /**
   * The thread the user has selected via the URL. Used (together with
   * `error`) to show the failure message including the threadId so users
   * can identify which thread failed to load.
   */
  threadId: ThreadId | null
  saving: boolean
  onPatch: (input: PatchThreadInput) => Promise<void>
  onReply: (
    bodyText: string,
    action: 'send' | 'send_and_close' | 'send_and_pending',
    format?: 'email' | 'plain',
    attachments?: MessageAttachment[],
    snoozeMinutes?: number,
    extras?: { cc?: string; bcc?: string; channelAccountId?: string },
  ) => Promise<void>
  onNote: (bodyText: string, attachments?: MessageAttachment[]) => Promise<void>
  /** Forward this email thread as a new outbound email (opens compose). */
  onForward?: () => void
  /** Edit an internal note in place. */
  onUpdateNote?: (messageId: string, bodyText: string) => Promise<void>
  /** Delete an internal note from the timeline. */
  onDeleteNote?: (messageId: string) => Promise<void>
  /** Mark the open thread as unread again (return-to-queue workflow). */
  onMarkUnread?: () => void | Promise<void>
  /** Pass `true` for a quiet refetch (no loading spinner / no blank thread). */
  onRefresh: (quiet?: boolean) => void
  /** True when older history exists above the current message window. */
  hasOlder?: boolean
  loadingOlder?: boolean
  onLoadOlder?: () => void | Promise<void>
  onTogglePin?: () => void | Promise<void>
  /** Conversation AI handling (picker in the header; take over / hand back). */
  onChangeAiHandling?: (
    mode: AiHandlingMode | null,
    opts?: { assignToMe?: boolean; reason?: string },
  ) => void | Promise<void>
  aiHandlingSaving?: boolean
  /** Workspace has at least one mailbox that can send (Bokito / Gmail / Outlook). */
  canSendEmail?: boolean
  /** Mailboxes exist but none can send yet (finish setup on Channels). */
  mailboxNeedsSetup?: boolean
  onDelete?: () => void | Promise<void>
  deleting?: boolean
  /** Mobile stacked navigation: return to the thread list (hidden on md+). */
  onBack?: () => void
  onToggleContact?: () => void
  contactOpen?: boolean
  onDecisionResolved?: (info?: { closed?: boolean }) => void
  /**
   * Composer behavior: `customer` threads get the reply/note composer,
   * `agent` (internal) threads get a note-only composer with an
   * "Ask assistant" action.
   */
  mode?: 'customer' | 'agent'
  /** Opens the look-again planner (owned by the page; also reachable from the panel). */
  onWhatsNext?: () => void
  /** Trailing unread inbound messages briefly flash when the thread opens. */
  unreadHighlightIds?: string[]
}

export default function ThreadDetail({ detail, loading, error, threadId, saving, onPatch, onReply, onNote, onForward, onUpdateNote, onDeleteNote, onMarkUnread, onRefresh, hasOlder = false, loadingOlder = false, onLoadOlder, onTogglePin, onChangeAiHandling, aiHandlingSaving = false, onDelete, deleting = false, onBack, onToggleContact, contactOpen, onDecisionResolved, mode = 'customer', onWhatsNext, canSendEmail = false, mailboxNeedsSetup = false, unreadHighlightIds = [] }: Props) {
  const { t, i18n } = useTranslation('communication')
  const confirm = useConfirm()
  const { token, user } = useAuth()
  const collectStageFields = useCollectStageFields()
  const location = useLocation()
  const navigate = useNavigate()
  const { connections } = useMailboxConnections()
  const gatewayStream = useSignalStream(threadId ? String(threadId) : null)
  const timelineRef = useRef<ThreadTimelineHandle>(null)
  const previousMessageCountRef = useRef<number>(0)
  const landedThreadRef = useRef<string | null>(null)
  const landTimersRef = useRef<number[]>([])
  // Anchor-to-bottom: the timeline stays pinned to the newest row until the
  // user scrolls up. Virtuoso reports that through `onAtBottomChange`.
  const anchorToBottomRef = useRef<boolean>(true)
  const [membersById, setMembersById] = useState<Record<number, InboxMember>>({})
  const [unseenNew, setUnseenNew] = useState(0)
  const [searchParams, setSearchParams] = useSearchParams()
  // Card targeted by a `?message=` deep link; highlighted for a few seconds.
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null)
  const [handledExternallyOpen, setHandledExternallyOpen] = useState(false)
  const [composerDraft, setComposerDraft] = useState<{
    body: string
    subject?: string
    key: string
    /** Set when the draft came from a suggestion card; sending resolves that decision. */
    decisionMessageId?: string
    /** Sender identity chosen on the suggestion card (user | agent). */
    sendAs?: 'user' | 'agent'
    /** Inbound message the proposal answers (server anchor). */
    basedOnMessageId?: string
  } | null>(null)
  // Composer surface the operator is on. Sticky on `ask` while an AI turn
  // runs, so the next keystroke goes to the AI, not the customer.
  const [composerMode, setComposerMode] = useState<ComposerMode>('reply')
  // Agent chosen with @ or Ask, before the first send creates the meta conversation.
  const [askAgentId, setAskAgentId] = useState<string | null>(null)
  // Close-the-loop prompt when typed Signals are still Open (F-49).
  const [closeSignalsPrompt, setCloseSignalsPrompt] = useState<{
    tickets: Ticket[]
    afterResolve?: () => Promise<void>
  } | null>(null)
  const [closeSignalsBusy, setCloseSignalsBusy] = useState(false)
  // Transcript of the running meta session, owned here so a send in the
  // composer and the inline session card stay in sync.
  const [sessionMessages, setSessionMessages] = useState<ChatMessage[] | null>(null)
  const {
    stream: sessionStream,
    agentStreaming,
    send: sendAgentSessionMessage,
    stop: stopAgentSessionStream,
  } = useAiChatStream(token)
  const agentStreamingRef = useRef(false)
  agentStreamingRef.current = agentStreaming
  const applyComposerDraft = useCallback(
    (draft: NonNullable<typeof composerDraft>) => {
      // Do not yank the Ask tab mid-stream when a suggestion card appears.
      if (agentStreamingRef.current) return
      setComposerDraft(draft)
    },
    [],
  )
  // Newest message the customer sent: anchors drafts and tells whether an
  // open proposal still answers the latest message.
  const latestInboundMessageId = useMemo(() => {
    if (!detail) return null
    for (let i = detail.messages.length - 1; i >= 0; i -= 1) {
      const message = detail.messages[i]
      if (message.direction !== 'inbound') continue
      if (message.kind && message.kind !== 'user_message') continue
      if (message.authorUserId != null) continue
      return String(message.id)
    }
    return null
  }, [detail])

  // Open proposals anchored to an older inbound message than the newest one:
  // shown with "the customer wrote again" and never auto-filled.
  const outdatedDecisionMessageIds = useMemo(() => {
    if (!detail || !latestInboundMessageId) return []
    const ids: string[] = []
    for (const message of detail.messages) {
      if (!replyProposalFromMessage(message, detail.events)) continue
      const basedOn = proposalBasedOnMessageId(message)
      if (basedOn && basedOn !== latestInboundMessageId) ids.push(String(message.id))
    }
    return ids
  }, [detail, latestInboundMessageId])

  const isProposalOpen = useCallback(
    (decisionMessageId: string): boolean | undefined => {
      if (!detail) return undefined
      const message = detail.messages.find((m) => String(m.id) === decisionMessageId)
      if (!message) return undefined
      return decisionCardOpen(message, detail.events)
    },
    [detail],
  )

  const appliedProposalRef = useRef<string | null>(null)
  useEffect(() => {
    appliedProposalRef.current = null
  }, [threadId])
  useEffect(() => {
    if (!detail) return
    const outdated = new Set(outdatedDecisionMessageIds)
    for (let i = detail.messages.length - 1; i >= 0; i -= 1) {
      const proposal = replyProposalFromMessage(detail.messages[i], detail.events)
      if (!proposal) continue
      if (outdated.has(proposal.decisionMessageId)) continue
      if (appliedProposalRef.current === proposal.decisionMessageId) return
      if (agentStreamingRef.current) return
      appliedProposalRef.current = proposal.decisionMessageId
      applyComposerDraft({
        body: proposal.body,
        subject: proposal.subject,
        key: `${proposal.decisionMessageId}-auto`,
        decisionMessageId: proposal.decisionMessageId,
        basedOnMessageId: proposalBasedOnMessageId(detail.messages[i]) ?? undefined,
      })
      setComposerMode('reply')
      return
    }
  }, [detail, applyComposerDraft, outdatedDecisionMessageIds])

  // The proposal in the composer was resolved or set aside elsewhere (another
  // operator, a new inbound, a colleague's mailbox reply): drop the prefill.
  useEffect(() => {
    if (!detail || !composerDraft?.decisionMessageId) return
    if (isProposalOpen(composerDraft.decisionMessageId) === false) {
      setComposerDraft(null)
    }
  }, [detail, composerDraft, isProposalOpen])

  // People, agents and teams are @-mentionable; those without access to this
  // channel stay listed but greyed out. An @agent opens that agent's session;
  // an @team note goes to the team (see thread_dispatch on the server).
  const [assignees, setAssignees] = useState<AssigneeCandidates | null>(null)
  const assigneesThreadId = detail ? String(detail.thread.id) : null
  useEffect(() => {
    if (!token || !assigneesThreadId) return
    let cancelled = false
    listSignalAssignees(token, assigneesThreadId)
      .then((rows) => {
        if (!cancelled) setAssignees(rows)
      })
      .catch(() => {
        if (!cancelled) {
          toast.error(t('threadChrome.agentsLoadError'), {
            id: 'thread-agents-load',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [token, assigneesThreadId, t])
  const mentionExtras: MentionItem[] = useMemo(() => {
    if (!assignees) return []
    const reason = t('threadChrome.noChannelAccess')
    return [
      ...assignees.people.map(
        (p): MentionItem => ({
          type: 'user',
          id: String(p.id),
          name: p.name,
          email: p.email,
          avatarUrl: p.avatarUrl,
          presence: p.presence,
          disabled: !p.canHandle,
          disabledReason: p.canHandle ? undefined : reason,
        }),
      ),
      ...assignees.agents.map(
        (a): MentionItem => ({
          type: 'agent',
          id: a.id,
          name: a.name,
          disabled: !a.canHandle,
          disabledReason: a.canHandle ? undefined : reason,
          activity: a.status,
          avatarKind: a.avatarKind,
          avatarIcon: a.avatarIcon,
          avatarColor: a.avatarColor,
          avatarImageUrl: a.avatarImageUrl,
        }),
      ),
      ...assignees.teams.map(
        (team): MentionItem => ({
          type: 'team',
          id: team.id,
          name: team.kind === 'custom' ? team.name : t(`teamPage.system.${team.kind}`, { ns: 'nav' }),
          presence: team.presence,
          avatarKind: team.avatarKind,
          avatarIcon: team.avatarIcon,
          avatarColor: team.avatarColor,
          avatarImageUrl: team.avatarImageUrl,
        }),
      ),
    ]
  }, [assignees, t])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    listInboxMembers(token)
      .then((members) => {
        if (cancelled) return
        const map: Record<number, InboxMember> = {}
        for (const m of members) {
          map[m.id] = m
        }
        setMembersById(map)
      })
      .catch(() => {
        if (!cancelled) {
          toast.error(t('threadChrome.teamLoadError'), {
            id: 'thread-members-load',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [token, t])

  const isAssistantThread = (detail?.thread.channel ?? '') === 'assistant'

  // While an assistant turn streams, splice optimistic operator bubbles into
  // the timeline so Send never blanks the thread waiting on a hard refresh.
  const timelineDetail = useMemo(() => {
    if (!detail || !isAssistantThread) return detail
    const optimistic = sessionStream.optimisticUsers
    if (!optimistic.length) return detail
    // Assistant chats store the operator as inbound; match body text so the
    // optimistic bubble does not sit next to the persisted copy.
    const existingBodies = new Set(
      detail.messages.map((m) => (m.bodyText || '').trim()).filter(Boolean),
    )
    const extras = optimistic
      .filter((m) => m.content.trim() && !existingBodies.has(m.content.trim()))
      .map(
        (m) =>
          ({
            id: m.id,
            threadId: detail.thread.id,
            connectionId: null,
            kind: 'user_message',
            direction: 'outbound',
            fromAddress: '',
            toAddresses: '',
            subject: '',
            bodyPreview: m.content.slice(0, 200),
            bodyText: m.content,
            bodyHtml: null,
            graphMessageId: '',
            inReplyTo: null,
            authorUserId: user?.id ?? null,
            isRead: true,
            sendStatus: null,
            attachments: null,
            receivedAt: m.created_at,
            createdAt: m.created_at,
          }) as ThreadDetailType['messages'][number],
      )
    if (!extras.length) return detail
    return { ...detail, messages: [...detail.messages, ...extras] }
  }, [detail, isAssistantThread, sessionStream.optimisticUsers, user?.id])

  const rows = useMemo(
    () => buildTimelineRows(timelineDetail, t, i18n.language),
    [timelineDetail, t, i18n.language],
  )

  const { nav: workspaceNav } = useCommunicationNav()
  const chatTags = useMemo((): ChatTagMap => {
    const map: ChatTagMap = {}
    // Workspace rail first so #klacht is accent even when this thread has no ticket.
    for (const row of workspaceNav.tags) {
      const key = row.name.trim().toLowerCase()
      if (key) map[key] = 'tag'
    }
    for (const row of workspaceNav.ticketTags) {
      const key = row.name.trim().toLowerCase()
      if (key) map[key] = 'action_tag'
    }
    const thread = detail?.thread
    if (thread) {
      for (const name of thread.tags ?? []) {
        const key = name.trim().toLowerCase()
        if (key && !map[key]) map[key] = 'tag'
      }
      const action = thread.ticket?.name?.trim().toLowerCase()
      if (action) map[action] = 'action_tag'
    }
    return map
  }, [detail?.thread, workspaceNav.tags, workspaceNav.ticketTags])

  const latestMessageRowId = useMemo(() => {
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i]
      if (row?.kind === 'message') return row.id
    }
    return null
  }, [rows])

  const messageLayout: 'chat' | 'email' =
    detail && resolveComposerSurface(detail.thread).channel === 'email' ? 'email' : 'chat'

  const scrollToLatestMessage = useCallback((behavior: ScrollBehavior = 'auto') => {
    timelineRef.current?.scrollToBottom(behavior === 'smooth' ? 'smooth' : 'auto')
  }, [])

  const pinToLatest = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      anchorToBottomRef.current = true
      scrollToLatestMessage(behavior)
    },
    [scrollToLatestMessage],
  )

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    scrollToLatestMessage(behavior)
  }, [scrollToLatestMessage])

  const pinToBottom = pinToLatest

  const loadedThreadId = detail?.thread.id ?? null
  const messageCount = detail?.messages.length ?? 0

  // Deep link from a notification or push: `?message=` highlights that card.
  // ThreadTimeline scrolls to focusedMessageId itself.
  useEffect(() => {
    const requested = searchParams.get('message')
    if (!requested || loading || rows.length === 0) return
    if (threadId == null || String(loadedThreadId) !== String(threadId)) return

    setFocusedMessageId(requested)
    anchorToBottomRef.current = false

    const clear = window.setTimeout(() => {
      setFocusedMessageId(null)
      setSearchParams(
        (params) => {
          const next = new URLSearchParams(params)
          next.delete('message')
          return next
        },
        { replace: true },
      )
    }, 3000)

    return () => window.clearTimeout(clear)
  }, [searchParams, setSearchParams, loading, rows.length, threadId, loadedThreadId])

  // Land once per open. Retry timers live on a ref so a later rows.length
  // update cannot cancel them (that left the list underscrolled).
  useLayoutEffect(() => {
    for (const id of landTimersRef.current) window.clearTimeout(id)
    landTimersRef.current = []
    landedThreadRef.current = null
  }, [threadId])

  useLayoutEffect(() => {
    if (loading || threadId == null || String(loadedThreadId) !== String(threadId) || rows.length === 0) {
      if (loadedThreadId == null) anchorToBottomRef.current = false
      return
    }

    const key = String(threadId)
    if (landedThreadRef.current === key) return
    landedThreadRef.current = key
    previousMessageCountRef.current = messageCount
    setUnseenNew(0)

    const apply = () => {
      const landing = timelineRef.current?.land('auto')
      if (landing) anchorToBottomRef.current = landing.pinToBottom
    }
    apply()
    const raf = window.requestAnimationFrame(apply)
    // One short retry for Virtuoso measuring item heights. Longer retries
    // fight the operator if they already started reading upward.
    landTimersRef.current = [80, 220].map((ms) => window.setTimeout(apply, ms))
    return () => {
      window.cancelAnimationFrame(raf)
      for (const id of landTimersRef.current) window.clearTimeout(id)
    }
  }, [loading, threadId, loadedThreadId, rows.length, messageLayout, messageCount])

  // Scroll on message-count growth when already near the bottom.
  useEffect(() => {
    if (loadedThreadId == null) return
    const prev = previousMessageCountRef.current
    previousMessageCountRef.current = messageCount
    if (messageCount <= prev) return
    if (anchorToBottomRef.current) {
      setUnseenNew(0)
      scrollToBottom('smooth')
    } else {
      setUnseenNew((n) => n + (messageCount - prev))
    }
  }, [messageCount, loadedThreadId, scrollToBottom])

  // Day pills live inside ThreadTimeline.
  useEffect(() => {
    // no-op: kept so thread switches clear any leftover chrome state
  }, [threadId])

  const composerSurface = useMemo(
    () =>
      detail
        ? resolveComposerSurface(detail.thread, {
            visitor: t('contactPanel.widgetVisitor'),
          })
        : null,
    [detail, t],
  )

  // CC list of the customer's most recent email; the composer offers it as a
  // reply-all seed when the operator opens the CC/BCC fields.
  const suggestedCc = useMemo(() => {
    if (!detail || detail.thread.channel !== 'email') return null
    const mailboxEmails = connections.map((row) => row.mailboxEmail)
    for (let i = detail.messages.length - 1; i >= 0; i--) {
      const m = detail.messages[i]
      if (m.direction !== 'inbound') continue
      const extras = suggestedReplyAllRecipients({
        cc: m.cc,
        toAddresses: m.toAddresses,
        exclude: [
          ...mailboxEmails,
          detail.thread.contactEmail,
        ],
      })
      if (extras) return extras
    }
    return null
  }, [detail, connections])

  const lastInboundText = useMemo(() => {
    if (!detail) return ''
    for (let i = detail.messages.length - 1; i >= 0; i--) {
      const message = detail.messages[i]
      if (message.direction === 'inbound') {
        const quoted = inboundQuoteText(message)
        if (quoted) return quoted
      }
    }
    return ''
  }, [detail])

  // Email thread whose mailbox was removed: history stays readable, but
  // outbound replies are impossible and must not pretend to work.
  const mailboxDisconnected = Boolean(
    detail &&
      composerSurface?.channel === 'email' &&
      detail.thread.channel === 'email' &&
      !canSendEmail,
  )

  useEffect(() => {
    setComposerDraft(null)
  }, [threadId])

  const myMemberId = useMemo(() => {
    const email = user?.email?.toLowerCase()
    if (!email) return null
    const me = Object.values(membersById).find((m) => m.email?.toLowerCase() === email)
    return me?.id ?? null
  }, [membersById, user?.email])

  const contactIsTeammate = useMemo(() => {
    const email = detail?.thread.contactEmail?.trim().toLowerCase()
    if (!email) return false
    return Object.values(membersById).some((m) => m.email?.trim().toLowerCase() === email)
  }, [detail?.thread.contactEmail, membersById])

  const [previousCount, setPreviousCount] = useState(0)
  const [closingSender, setClosingSender] = useState(false)
  const [blockingContact, setBlockingContact] = useState(false)
  // An open ticket or a category waiting for a confirm: feeds the count on the
  // panel toggle while the right panel is closed. Internal threads carry none.
  const threadTicket = detail && !isInternalThread(detail.thread) ? detail.thread.ticket : null
  const openSignalCount = threadTicket && threadTicket.status !== 'done' ? 1 : 0

  useEffect(() => {
    if (!token || !detail?.thread.contactId) {
      setPreviousCount(0)
      return
    }
    const currentId = String(detail.thread.id)
    const contactId = detail.thread.contactId
    let cancelled = false
    void getContactThreads(token, contactId)
      .then((rows) => {
        if (!cancelled) {
          setPreviousCount(rows.filter((row) => String(row.id) !== currentId).length)
        }
      })
      .catch(() => {
        if (!cancelled) setPreviousCount(0)
      })
    return () => {
      cancelled = true
    }
  }, [token, detail?.thread.contactId, detail?.thread.id])

  const handleAlwaysCloseSender = useCallback(async () => {
    if (!token || !detail) return
    const sender = detail.thread.contactEmail.trim()
    if (!sender || isPlaceholderContactAddress(sender)) return
    if (!(await confirm({ description: t('threadChrome.alwaysCloseConfirm', { sender }) }))) return
    setClosingSender(true)
    try {
      await createInboxRule(token, {
        matchType: 'sender',
        matchValue: sender,
        action: 'auto_close',
        label: t('threadChrome.alwaysCloseLabel', { sender }),
      })
      toast.success(t('threadChrome.alwaysCloseCreated', { sender }))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('threadChrome.alwaysCloseError')))
    } finally {
      setClosingSender(false)
    }
  }, [token, detail, t])

  const handleBlockContact = useCallback(async () => {
    if (!token || !detail?.thread.contactId || blockingContact) return
    const name =
      humanizeContactName(
        detail.thread.contactName,
        detail.thread.contactEmail,
        t('contactPanel.widgetVisitor'),
      ) ||
      (!isPlaceholderContactAddress(detail.thread.contactEmail) && detail.thread.contactEmail) ||
      t('contactPanel.thisContact')
    if (!(await confirm({ description: t('contactPanel.blockConfirm', { name }), confirmLabel: t('actions.block', { ns: 'common' }), destructive: true }))) return
    setBlockingContact(true)
    try {
      await updateContact(token, detail.thread.contactId, { status: 'blocked' })
      toast.success(t('threadChrome.blockContactDone', { name }))
      await onRefresh?.()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('threadChrome.blockContactError')))
    } finally {
      setBlockingContact(false)
    }
  }, [token, detail, blockingContact, t, onRefresh])

  const threadIdString = detail ? String(detail.thread.id) : null

  const activeSession = useMemo(
    () => (detail?.sessions ?? []).find((s) => s.state === 'active') ?? null,
    [detail?.sessions],
  )
  const activeSessionId = activeSession?.id ?? null
  const sessionLive = useSignalStream(activeSessionId)

  // Land on the surface default when opening a thread. Manual handling forces
  // reply. An active meta conversation keeps Ask. Switching to Ask or @-mentioning
  // an agent must not snap back to Reply just because the thread refreshed.
  const handlingEffective = detail?.thread?.aiHandling?.effective ?? null
  const prevThreadIdRef = useRef<string | null>(null)
  useEffect(() => {
    setAskAgentId(null)
  }, [threadId])
  useEffect(() => {
    const thread = detail?.thread
    if (!thread) {
      setComposerMode('reply')
      return
    }
    if (handlingEffective === 'manual') {
      setComposerMode('reply')
      return
    }
    if (activeSessionId) {
      setComposerMode('ask')
      return
    }
    // Compare the loaded thread, not the route: right after navigation
    // `detail` still holds the previous thread and would pick its mode.
    const threadChanged = prevThreadIdRef.current !== String(thread.id)
    prevThreadIdRef.current = String(thread.id)
    if (threadChanged) {
      // An automated mail the agent judged "no reply needed" has nobody to
      // write to: start on a note instead of a reply to the no-reply sender.
      const noReplyOpen = Boolean(
        detail && detail.messages.some((m) => isOpenNoReplyCard(m, detail.events)),
      )
      const surface = resolveComposerSurface(thread)
      setComposerMode(
        noReplyOpen && surface.modes.includes('note') ? 'note' : surface.defaultMode,
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- detail.messages only matter on thread change
  }, [threadId, activeSessionId, handlingEffective, detail?.thread])

  const loadSessionMessages = useCallback(
    async (sessionId: string | null) => {
      if (!token || !sessionId) {
        setSessionMessages(null)
        return
      }
      try {
        const rows = await bokitoListMessages(token, sessionId)
        setSessionMessages(rows.filter((m) => m.role === 'user' || m.role === 'assistant'))
      } catch {
        setSessionMessages(null)
      }
    },
    [token],
  )

  useEffect(() => {
    void loadSessionMessages(activeSessionId)
  }, [loadSessionMessages, activeSessionId])

  const handleComposerVerb = useCallback(
    async (verb: ParsedComposerVerb): Promise<boolean> => {
      if (!token || !threadIdString) return false
      if (verb.verb === 'ticket') {
        const categories = await listCategories().catch(() => [])
        const q = normalizeHashtag(verb.arg)
        if (!q) {
          toast.message(
            categories.map((row) => `#${row.name}`).join(', ') || t('tickets.setUp', { ns: 'nav' }),
          )
          return true
        }
        const match =
          categories.find((row) => row.name === q) ?? categories.find((row) => row.name.includes(q))
        if (!match) {
          toast.error(t('tickets.unknownCategory', { ns: 'nav', name: q }))
          return true
        }
        if (match.project_choices.length > 0) {
          toast.message(t('tickets.chooseProjectInPanel', { ns: 'nav', name: match.name }))
          return true
        }
        await fileTicket(threadIdString, match.id)
        toast.success(`#${match.name}`)
        return true
      }
      if (verb.verb === 'assign') {
        const q = verb.arg.trim().toLowerCase()
        const members = Object.values(membersById)
        const me = members.find((m) => m.email?.toLowerCase() === user?.email?.toLowerCase())
        let target = !q || q === 'me' || q === 'mij' ? me : undefined
        if (!target && q) {
          target = members.find(
            (m) =>
              m.name?.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q),
          )
        }
        if (!target) {
          toast.error(t('actions.bulkFailed', { ns: 'communication', defaultValue: 'Could not assign.' }))
          return true
        }
        await patchSignalThread(token, threadIdString, { assignedToUserId: target.id })
        toast.success(target.name || target.email || String(target.id))
        return true
      }
      if (verb.verb === 'approve') {
        toast.message(
          t('composer.verbApproveHint', {
            defaultValue: 'Open the decision card in the thread to approve.',
          }),
        )
        return true
      }
      if (isAiHandlingVerb(verb.verb)) {
        if (!onChangeAiHandling) return false
        await onChangeAiHandling(verb.verb, verb.arg ? { reason: verb.arg } : undefined)
        return true
      }
      return false
    },
    [token, threadIdString, membersById, user?.email, t, onChangeAiHandling],
  )

  const askAgentName = useMemo(() => {
    if (!askAgentId) return null
    const hit = mentionExtras.find((item) => item.type === 'agent' && item.id === askAgentId)
    return hit?.name ?? null
  }, [askAgentId, mentionExtras])

  const handleMentionInserted = useCallback((item: MentionItem) => {
    if (item.type === 'user' || item.type === 'team') {
      setComposerMode((prev) => (prev === 'reply' ? 'note' : prev))
      return
    }
    if (item.type !== 'agent') return
    setAskAgentId(item.id)
    setComposerMode('ask')
  }, [])

  const handleAgentMessage = useCallback(
    async (bodyText: string, attachments?: MessageAttachment[]): Promise<boolean> => {
      if (!token || !threadIdString) return false
      const text = stripMentionMarkup(bodyText).trim()
      if (!text && !attachments?.length) return false
      // Soft "Ja"/"Nee" in Ask resolves the sole binary open proposal — same as buttons.
      // Multi/text cards may stay open; several binary Ja/Nee cards stay button-only.
      if (text && !attachments?.length && detail) {
        const openCards: { messageId: string; options: ReturnType<typeof parseDecisionOptions> }[] = []
        for (const m of detail.messages) {
          if (m.kind === 'decision_request' && decisionCardOpen(m, detail.events) === true) {
            const raw = (m.payload?.decision as { options?: unknown } | undefined)?.options
            openCards.push({ messageId: String(m.id), options: parseDecisionOptions(raw) })
            continue
          }
          const proposal = m.proposal
          if (
            proposal &&
            proposal.cardMessageId &&
            (proposal.status === 'awaiting_human' || proposal.status === 'pending')
          ) {
            openCards.push({
              messageId: proposal.cardMessageId,
              options: parseDecisionOptions(proposal.options),
            })
          }
        }
        const target = pickSoftDecisionTarget(text, openCards)
        if (target) {
          try {
            await resolveThreadDecision(
              token,
              threadIdString,
              target.messageId,
              target.soft.kind === 'approve' ? 'approve' : 'reject',
              { optionId: target.soft.optionId },
            )
            onRefresh(true)
            window.setTimeout(() => pinToBottom('smooth'), 120)
            return true
          } catch {
            // Fall through to a normal Ask turn.
          }
        }
      }
      const isAssistant = (detail?.thread.channel ?? '') === 'assistant'
      let sessionId = isAssistant ? threadIdString : activeSessionId
      const wantedAgentId = askAgentId ?? detail?.thread.agentId ?? null
      const needsNewSession =
        !isAssistant &&
        (!sessionId || Boolean(askAgentId && activeSession?.agentId && activeSession.agentId !== askAgentId))
      if (needsNewSession) {
        try {
          const started = await startAgentSession(token, threadIdString, wantedAgentId)
          sessionId = started?.id ?? null
        } catch {
          toast.error(t('agentSession.startError'))
          return false
        }
        if (!sessionId) return false
        onRefresh(true)
      }
      if (!sessionId) return false
      try {
        const sendPromise = sendAgentSessionMessage(sessionId, text || ' ', {
          attachments,
          onFinished: async () => {
            if (!isAssistant) await loadSessionMessages(sessionId)
            // Quiet: keep bubbles on screen; never flash the thread skeleton.
            onRefresh(true)
            window.setTimeout(() => pinToBottom('smooth'), 120)
          },
        })
        // Show the operator's own message right away, not only after the reply.
        pinToBottom('smooth')
        return (await sendPromise) !== false
      } catch (err) {
        const msg = err instanceof Error ? err.message : ''
        if (msg === 'agent_busy') {
          // Clear a ghost lock from a dropped stream, then the operator can retry.
          void stopAgentSessionStream().finally(() => {
            toast.error(t('aiChat.busyError', { defaultValue: 'The AI is still replying. Wait or press Stop.' }), {
              action: {
                label: t('aiChat.stop', { defaultValue: 'Stop' }),
                onClick: () => void stopAgentSessionStream(),
              },
            })
          })
        } else {
          toast.error(t('aiChat.sendError', { defaultValue: 'Could not send to the AI.' }))
        }
        if (!isAssistant) await loadSessionMessages(sessionId)
        onRefresh(true)
        return false
      }
    },
    [
      token,
      threadIdString,
      activeSessionId,
      activeSession?.agentId,
      askAgentId,
      detail,
      sendAgentSessionMessage,
      stopAgentSessionStream,
      loadSessionMessages,
      onRefresh,
      pinToBottom,
      t,
    ],
  )

  useEffect(() => {
    const draft =
      typeof (location.state as { autoSend?: unknown } | null)?.autoSend === 'string'
        ? (location.state as { autoSend: string }).autoSend.trim()
        : ''
    if (!draft || !detail || !threadIdString) return
    if (String(detail.thread.id) !== String(threadIdString)) return
    if ((detail.thread.channel ?? '') !== 'assistant') return
    if (autoSentThreads.has(threadIdString)) return
    autoSentThreads.add(threadIdString)
    navigate(`${location.pathname}${location.search}`, { replace: true, state: {} })
    void handleAgentMessage(draft)
  }, [
    detail,
    threadIdString,
    location.state,
    location.pathname,
    location.search,
    navigate,
    handleAgentMessage,
  ])

  const handleStopAgent = useCallback(() => {
    void stopAgentSessionStream()
  }, [stopAgentSessionStream])

  const handleComposerModeChange = useCallback((mode: ComposerMode) => {
    setComposerMode(mode)
    if (mode !== 'ask') setAskAgentId(null)
  }, [])

  // Hand the live turn off to its saved bubbles: once they are in the list
  // (matched by turn id), drop the live view so nothing shows twice.
  const liveTurn = gatewayStream.turn
  const resetLiveTurn = gatewayStream.reset
  const liveTurnSaved = turnSaved(liveTurn, detail?.messages ?? [])
  useEffect(() => {
    if (liveTurn.ended && liveTurnSaved) resetLiveTurn()
  }, [liveTurn.ended, liveTurnSaved, resetLiveTurn])

  const threadLiveTurn = useMemo(() => {
    // Gateway turn (thinking + tools + speech) is the rich path when connected.
    if (!liveTurnSaved && turnHasContent(liveTurn)) return liveTurn
    // SSE fallback while the agent is working — show a live bubble even before
    // the first token, so the operator sees that work started.
    if (isAssistantThread && agentStreaming) {
      return textOnlyTurn(sessionStream.text || sessionStream.thinking || '')
    }
    return null
  }, [
    liveTurn,
    liveTurnSaved,
    isAssistantThread,
    agentStreaming,
    sessionStream.text,
    sessionStream.thinking,
  ])

  // Pulse avatar corners as soon as this thread sees a live turn / Ask stream.
  // The API also broadcasts agent.status; this covers the same browser before
  // that event lands (and keeps the open-thread agent marked working).
  const liveAgentId =
    askAgentId ?? activeSession?.agentId ?? detail?.thread.agentId ?? null
  const agentTurnBusy = Boolean(
    agentStreaming || (threadLiveTurn && (threadLiveTurn.active || !threadLiveTurn.ended)),
  )
  useEffect(() => {
    if (!liveAgentId || !agentTurnBusy) return
    applyAgentLive(liveAgentId, {
      status: 'working',
      summary: null,
      threadId: detail?.thread.id != null ? String(detail.thread.id) : null,
      activityId: null,
      lastActiveAt: Date.now(),
      source: 'ws',
    })
  }, [liveAgentId, agentTurnBusy, detail?.thread.id])

  const requestCloseThread = useCallback(
    async (afterClose?: () => Promise<void>) => {
      if (!detail || isInternalThread(detail.thread)) {
        await onPatch({ status: 'closed' })
        if (afterClose) await afterClose()
        return
      }
      const openTickets = await loadOpenTickets(String(detail.thread.id))
      if (openTickets.length === 0) {
        await onPatch({ status: 'closed' })
        if (afterClose) await afterClose()
        return
      }
      setCloseSignalsPrompt({
        tickets: openTickets,
        afterResolve: afterClose,
      })
    },
    [detail, onPatch],
  )

  const confirmCloseWithSignals = useCallback(
    async (mode: 'resolve' | 'leave') => {
      if (!closeSignalsPrompt) return
      setCloseSignalsBusy(true)
      try {
        if (mode === 'resolve') {
          await resolveOpenTickets(closeSignalsPrompt.tickets, collectStageFields)
        }
        await onPatch({ status: 'closed' })
        if (closeSignalsPrompt.afterResolve) await closeSignalsPrompt.afterResolve()
        setCloseSignalsPrompt(null)
      } catch (err) {
        if (err instanceof TicketStageMoveCancelled) return
        toast.error(formatApiErrorMessage(err, t('threadChrome.closeWithTicketError')))
      } finally {
        setCloseSignalsBusy(false)
      }
    },
    [closeSignalsPrompt, collectStageFields, onPatch, t],
  )

  const handleReply = useCallback(
    async (
      bodyText: string,
      action: 'send' | 'send_and_close' | 'send_and_pending',
      attachments?: MessageAttachment[],
      snoozeMinutes?: number,
      extras?: { cc?: string; bcc?: string; channelAccountId?: string },
    ) => {
      const pendingDecisionId = composerDraft?.decisionMessageId
      if (pendingDecisionId && token && detail) {
        await resolveThreadDecision(token, detail.thread.id, pendingDecisionId, 'approve', {
          optionId: 'send',
          body: bodyText,
          subject: composerDraft?.subject,
          sendAs: composerDraft?.sendAs,
        })
        setComposerDraft(null)
        onDecisionResolved?.()
        if (action === 'send_and_close') {
          await requestCloseThread()
        } else if (action === 'send_and_pending') {
          await onPatch({
            status: 'pending',
            snoozedUntil:
              snoozeMinutes && snoozeMinutes > 0
                ? new Date(Date.now() + snoozeMinutes * 60_000).toISOString()
                : null,
          })
        }
        window.setTimeout(() => scrollToBottom('smooth'), 80)
        return
      }
      if (action === 'send_and_close') {
        // Send first, then prompt about open Signals before flipping status.
        const format = composerSurface?.includeSignature ? 'email' : 'plain'
        await onReply(bodyText, 'send', format, attachments, snoozeMinutes, extras)
        await requestCloseThread()
        if (token && threadIdString && activeSession) {
          try {
            await closeAgentSession(token, threadIdString, activeSession.id)
            setComposerMode('reply')
            onRefresh()
          } catch {
            // The reply is out; a stuck session is not worth failing the send.
          }
        }
        window.setTimeout(() => scrollToBottom('smooth'), 80)
        return
      }
      const format = composerSurface?.includeSignature ? 'email' : 'plain'
      await onReply(bodyText, action, format, attachments, snoozeMinutes, extras)
      // The customer answer is the outcome of the meta conversation, so the
      // session checks out with it instead of lingering open.
      if (token && threadIdString && activeSession) {
        try {
          await closeAgentSession(token, threadIdString, activeSession.id)
          setComposerMode('reply')
          onRefresh()
        } catch {
          // The reply is out; a stuck session is not worth failing the send.
        }
      }
      window.setTimeout(() => scrollToBottom('smooth'), 80)
    },
    [
      onReply,
      scrollToBottom,
      composerSurface,
      composerDraft,
      token,
      detail,
      onDecisionResolved,
      onPatch,
      requestCloseThread,
      threadIdString,
      activeSession,
      onRefresh,
    ],
  )

  // Plain internal note. @agent mentions no longer invoke an agent here: the
  // agent composer mode owns that conversation.
  const handleNote = useCallback(
    async (bodyText: string, attachments?: MessageAttachment[]) => {
      await onNote(bodyText, attachments)
      window.setTimeout(() => scrollToBottom('smooth'), 80)
    },
    [onNote, scrollToBottom],
  )

  const detailMatchesRoute =
    detail != null && threadId != null && String(detail.thread.id) === String(threadId)

  if (loading || (threadId != null && detail != null && !detailMatchesRoute)) {
    return <InboxThreadSkeleton />
  }

  // The detail fetch failed. Surface the actual error to the user instead
  // of silently showing the "Select a thread" placeholder, which hides
  // backend issues (e.g. runtime errors that previously slipped
  // through unnoticed).
  if (error && threadId != null) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
        <AlertCircle size={28} className="text-status-error" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-text-heading">
            {t('threadChrome.loadFailed', { id: threadId })}
          </p>
          <p className="text-xs text-text-muted max-w-md break-words">{error}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => onRefresh()} className="gap-1.5">
          <RefreshCw size={13} />
          {t('threadChrome.tryAgain')}
        </Button>
      </div>
    )
  }

  if (!detail) {
    // On small screens the list already fills the viewport when nothing is
    // selected, so the placeholder pane only exists from md up.
    return (
      <div className={`${threadId == null ? 'hidden md:flex' : 'flex'} flex-1 items-center justify-center px-6`}>
        <div className="max-w-sm text-center">
          <p className="text-sm font-medium text-text-heading">{t('threadChrome.selectThreadTitle')}</p>
          <p className="mt-1 text-xs text-text-muted">{t('threadChrome.selectThreadHint')}</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <Link
              to="/communication/new"
              className="rounded-md border border-border/60 px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
            >
              {t('threadChrome.startNewChat')}
            </Link>
            <Link
              to="/settings/setup"
              className="rounded-md border border-border/60 px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
            >
              {t('threadChrome.openSetupGuide')}
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const { thread } = detail

  return (
    <TooltipProvider delayDuration={150}>
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      <ThreadHeader
        thread={thread}
        csat={detail.csat}
        saving={saving}
        loading={loading}
        previousCount={previousCount}
        onPatch={onPatch}
        onRequestClose={() => void requestCloseThread()}
        closeBusy={closeSignalsBusy}
        onBack={onBack}
        onToggleContact={onToggleContact}
        contactOpen={contactOpen}
        onChangeAiHandling={onChangeAiHandling}
        aiHandlingSaving={aiHandlingSaving}
        onForward={onForward}
        onMarkUnread={onMarkUnread}
        onTogglePin={onTogglePin}
        onDelete={onDelete}
        deleting={deleting}
        onAlwaysCloseSender={handleAlwaysCloseSender}
        closingSender={closingSender}
        onBlockContact={handleBlockContact}
        blockingContact={blockingContact}
        onWhatsNext={onWhatsNext}
        panelCount={openSignalCount + (thread.followUpAt ? 1 : 0)}
      />

      <div className="relative flex min-h-0 flex-1 flex-col">
        {unseenNew > 0 ? (
          <button
            type="button"
            onClick={() => {
              setUnseenNew(0)
              pinToBottom('smooth')
            }}
            className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-lg border border-accent/30 bg-accent px-3 py-1 text-xs font-medium text-accent-fg"
          >
            {t('threadChrome.newMessages', { count: unseenNew })}
          </button>
        ) : null}
        <ThreadTimeline
          ref={timelineRef}
          rows={rows}
          threadId={thread.id}
          channel={thread.channel}
          latestMessageRowId={latestMessageRowId}
          language={i18n.language}
          messageLayout={messageLayout}
          membersById={membersById}
          contactName={thread.contactName}
          contactEmail={thread.contactEmail}
          contactPhone={thread.contactPhone}
          agentName={thread.agentName}
          agentId={thread.agentId}
          agentAvatarKind={thread.agentAvatarKind}
          agentAvatarIcon={thread.agentAvatarIcon}
          agentAvatarColor={thread.agentAvatarColor}
          agentAvatarImageUrl={thread.agentAvatarImageUrl}
          chatTags={chatTags}
          events={detail.events}
          noteActions={
            onUpdateNote && onDeleteNote
              ? { onEdit: onUpdateNote, onDelete: onDeleteNote }
              : undefined
          }
          focusedMessageId={focusedMessageId}
          unreadHighlightIds={unreadHighlightIds}
          hasOlder={hasOlder}
          loadingOlder={loadingOlder}
          onLoadOlder={onLoadOlder}
          activeSessionId={activeSessionId}
          sessionMessages={sessionMessages}
          sessionStream={sessionStream}
          agentStreaming={agentStreaming}
          sessionTurn={sessionLive.turn}
          onRefresh={onRefresh}
          onUseSessionAsReply={(body) => {
            applyComposerDraft({ body, key: `session-${Date.now()}` })
            toast.success(t('aiChat.replyCopied', { defaultValue: t('agentSession.replyCopied') }))
          }}
          onDecisionResolved={onDecisionResolved}
          onEditDraft={(draft) => {
            const card = detail.messages.find((m) => String(m.id) === draft.decisionMessageId)
            applyComposerDraft({
              body: draft.body,
              subject: draft.subject,
              key: `${draft.decisionMessageId}-${Date.now()}`,
              decisionMessageId: draft.decisionMessageId,
              sendAs: draft.sendAs,
              basedOnMessageId: card ? (proposalBasedOnMessageId(card) ?? undefined) : undefined,
            })
          }}
          compactDecisionMessageIds={
            composerDraft?.decisionMessageId ? [composerDraft.decisionMessageId] : []
          }
          outdatedDecisionMessageIds={outdatedDecisionMessageIds}
          onAtBottomChange={(atBottom) => {
            anchorToBottomRef.current = atBottom
          }}
          liveTrace={
            threadLiveTurn ? (
              <AgentTurnLive
                turn={threadLiveTurn}
                avatar={
                  thread.agentId ? (
                    <AiAvatar {...toAiAvatarProps(thread)} size={28} decorative />
                  ) : undefined
                }
              />
            ) : null
          }
          emptyState={
            <div className="flex h-full flex-col items-center justify-center text-center text-xs text-text-muted">
              <p>{t('threadChrome.emptyTitle')}</p>
              <p className="mt-1 text-xs opacity-70">
                {thread.channel === 'email'
                  ? t('threadChrome.emptyEmail')
                  : t('threadChrome.emptyChat')}
              </p>
              <Link
                to={talkToAssistantPath(t('threadChrome.emptyAskPrefill'))}
                className="mt-2 inline-block text-xs font-medium text-accent hover:underline"
              >
                {t('threadChrome.emptyAsk')}
              </Link>
            </div>
          }
        />
      </div>

      {composerSurface ? (
        <RelatedConversationBanner
          rows={detail.relatedConversations}
          contactName={thread.contactName}
        />
      ) : null}
      {composerSurface ? (
        <ReplyComposer
          surface={composerSurface}
          onReply={handleReply}
          onNote={handleNote}
          onAgentMessage={handleAgentMessage}
          onStopAgent={handleStopAgent}
          agentStreaming={agentStreaming}
          mode={composerMode}
          onModeChange={handleComposerModeChange}
          onVerb={handleComposerVerb}
          agentModeName={activeSession?.agentName ?? askAgentName ?? thread.agentName ?? null}
          onMentionInserted={handleMentionInserted}
          saving={saving || agentStreaming}
          lastInboundText={lastInboundText}
          channelAccountId={thread.channelAccountId ?? null}
          replyDisabledNotice={
            mailboxDisconnected ? (
              <span className="flex flex-wrap items-center gap-2">
                <AlertCircle size={13} className="shrink-0 text-status-warning" />
                <span>
                  {mailboxNeedsSetup
                    ? t('composer.mailboxNeedsSetup')
                    : t('composer.mailboxDisconnected')}
                </span>
                <Link
                  to="/settings/channels"
                  className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:bg-accent-hover"
                >
                  {mailboxNeedsSetup
                    ? t('composer.finishMailboxSetup')
                    : t('composer.reconnectMailbox')}
                </Link>
              </span>
            ) : thread.status === 'closed' || thread.status === 'spam' ? (
              <span className="flex flex-wrap items-center gap-2">
                <AlertCircle size={13} className="shrink-0 text-status-warning" />
                <span>{thread.status === 'spam' ? t('composer.spamBlocked') : t('shortcuts.replyBlocked')}</span>
                <button
                  type="button"
                  className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:bg-accent-hover"
                  onClick={() => void onPatch({ status: 'open' })}
                >
                  {t('threadChrome.reopen')}
                </button>
              </span>
            ) : undefined
          }
          draftBody={composerDraft?.body ?? null}
          draftKey={composerDraft?.key ?? null}
          persistKey={String(thread.id)}
          latestInboundMessageId={latestInboundMessageId}
          isProposalOpen={isProposalOpen}
          proposal={
            composerDraft?.decisionMessageId
              ? {
                  decisionMessageId: composerDraft.decisionMessageId,
                  basedOnMessageId: composerDraft.basedOnMessageId ?? null,
                  onDismiss: async () => {
                    if (!token || !composerDraft.decisionMessageId) return
                    await resolveThreadDecision(
                      token,
                      thread.id,
                      composerDraft.decisionMessageId,
                      'reject',
                      { optionId: 'reject' },
                    )
                    setComposerDraft(null)
                    appliedProposalRef.current = null
                    onDecisionResolved?.()
                  },
                }
              : null
          }
          suggestedCc={suggestedCc}
          mentionExtras={mentionExtras}
          onHandledExternally={
            mode === 'customer' && thread.status !== 'closed' && thread.status !== 'spam'
              ? () => setHandledExternallyOpen(true)
              : undefined
          }
        />
      ) : null}
      <HandledExternallyDialog
        open={handledExternallyOpen}
        onOpenChange={setHandledExternallyOpen}
        threadId={thread.id}
        onDone={() => {
          setComposerDraft(null)
          appliedProposalRef.current = null
          onRefresh()
        }}
      />
      <Dialog
        open={closeSignalsPrompt != null}
        onOpenChange={(open) => {
          if (!open && !closeSignalsBusy) setCloseSignalsPrompt(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('threadChrome.closeWithTicketTitle')}</DialogTitle>
            <DialogDescription>
              {t('threadChrome.closeWithTicketBody', {
                count: closeSignalsPrompt?.tickets.length ?? 0,
                names:
                  (closeSignalsPrompt?.tickets ?? [])
                    .map((row) => `#${row.name}`)
                    .filter(Boolean)
                    .slice(0, 3)
                    .join(', ') || t('threadChrome.closeWithTicketFallback'),
              })}
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-40 space-y-1 overflow-y-auto text-sm text-text-secondary">
            {(closeSignalsPrompt?.tickets ?? []).map((row) => (
              <li key={row.signal_id} className="truncate-fade rounded-md border border-border/50 px-2.5 py-1.5">
                #{row.name}
                {row.stage ? ` · ${stageLabel(row.stage, t)}` : ''}
              </li>
            ))}
          </ul>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={closeSignalsBusy}
              onClick={() => setCloseSignalsPrompt(null)}
            >
              {t('threadChrome.closeWithTicketCancel')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={closeSignalsBusy}
              onClick={() => void confirmCloseWithSignals('leave')}
            >
              {t('threadChrome.closeWithTicketLeaveOpen')}
            </Button>
            <Button
              type="button"
              disabled={closeSignalsBusy}
              onClick={() => void confirmCloseWithSignals('resolve')}
            >
              {t('threadChrome.closeWithTicketResolve')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  </TooltipProvider>
  )
}
