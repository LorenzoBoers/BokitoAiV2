import { AlertCircle, PenLine, RefreshCw, Trash2 } from 'lucide-react'
import { Callout } from '../ui/callout'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import {
  CLOSE_EMAIL_ON_SEND_EVENT,
  fetchCloseEmailOnSend,
  readCachedCloseEmailOnSend,
} from '../../lib/email-close-pref'
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
  type InboxMessage,
} from '../../lib/inbox-api'
import {
  clearStoredMailDraft,
  MAIL_DRAFT_CHANGED_EVENT,
  readStoredMailDraft,
  type StoredMailDraft,
} from '../../lib/mail-draft-store'
import { buildMailDraftIntent, type MailDraftIntent, type MailDraftMode } from '../../lib/mail-reply'
import { CHAT_COLUMN_CLASS } from '../../lib/chat-layout'
import MailComposer, { type MailSendPayload } from './MailComposer'
import { getContactThreadPage, updateContact } from '../../lib/contacts-api'
import {
  humanizeContactName,
  isPlaceholderContactAddress,
} from '../../lib/contact-label'
import { fileTicket, listCategories, stageLabel, type Ticket } from '../../lib/tickets-api'
import { normalizeHashtag } from '../../lib/hashtag'
import { TicketStageMoveCancelled, closeConversationCollecting, loadOpenTickets } from '../../lib/close-thread-signals'
import FileInFolderDialog from './FileInFolderDialog'
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
import {
  findNavRowPath,
  listSignalAssignees,
  listThreadAgentCandidates,
  setThreadSchedule,
  type AssigneeCandidates,
  type LabelColor,
  type ThreadAgentCandidate,
} from '../../lib/signals-api'
import {
  decisionCardOpen,
  proposalBasedOnMessageId,
  replyProposalFromMessage,
} from './DecisionRequestMessage'
import RelatedConversationBanner from './RelatedConversationBanner'
import ReplyComposer from './ReplyComposer'
import ThreadHeader from './ThreadHeader'
import ThreadTimeline, {
  buildTimelineRows,
  liveRunContinues,
  type ThreadTimelineHandle,
} from './ThreadTimeline'
import type { ChatTagMap } from '../../lib/chatText'
import { useCommunicationNav } from '../../hooks/useCommunicationNav'
import { Button } from '../ui/button'
import { TagPill } from '../ui/TagPill'
import { StageProgressIcon } from '../flows/StageProgressIcon'
import { useConfirm } from '../ui/confirm-dialog'
import { InboxThreadSkeleton } from '../ui/skeleton'
import { TooltipProvider } from '../ui/tooltip'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { inboundQuoteText, suggestedReplyAllRecipients } from '../../lib/thread-intent'
import { useMailboxConnections } from '../../hooks/useMailboxConnections'
import {
  isInternalThread,
  resolveComposerSurface,
  threadFace,
  type ComposerMode,
} from '../../lib/message-composer'
import { useThreadLog } from '../../hooks/useThreadLog'
import { parseActiveTurn, type ThreadActiveTurn } from '../../lib/inbox-api'
import { visibleFloor } from '../../lib/participant-stack'
import AgentTurnLive from './AgentTurnLive'
import { ClaimIdleAgentSeat, LiveAgentSeatProvider, SyncLiveAgentFocus } from './LiveAgentSeat'
import { answeredDecisionIds } from './ThreadTimeline'
import { preferLiveAgentAvatar, toAiAvatarProps } from '../../lib/agent-avatar'
import { composerLanding } from '../../lib/composer-reply-focus'
import { stripMentionMarkup, type MentionItem } from '../../lib/mentions'
import { useAgents } from '../../hooks/useAgents'
import {
  liveTurnOrbMotion,
  textOnlyTurn,
  turnHasContent,
  type LiveTurn,
} from '../../lib/agentActivity'
import { publishBotOrbPulse, useAgentOrbDrive } from '../../hooks/useBotOrbPulse'
import { useDebugDom } from '../../lib/debug-dom'
import { useThreadUx } from '../../lib/thread-ux'
import { closingOrbPulse } from '../../lib/bot-orb-motion'
import {
  bokitoListMessages,
  closeAgentSession,
  discardAgentSession,
  prepareThreadAsk,
  type ChatMessage,
  type ThreadSession,
} from '../../lib/signals-api'
import { collapseRecentUserEchoes, sessionTimelineMessages, withAskListKey } from '../../lib/session-timeline'
import { useAiChatStream } from '../../lib/use-agent-session-chat'
import { applyAgentLive, type AgentLiveSnapshot } from '../../hooks/useAgentPresence'
import { useLiveEntity } from '../../lib/live-store'
import { takeChatContinue } from '../../lib/chat-auto-continue'
import { talkToAssistantPath } from '../../lib/talk-to-assistant'
import { toast } from 'sonner'

/** Threads whose opener has already been continued or auto-sent this session. */
const autoSentThreads = new Set<string>()


const LIVE_SETTLE_SAFETY_MS = 6_000

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
  onPatch: (input: PatchThreadInput) => Promise<boolean | void>
  onReply: (
    bodyText: string,
    action: 'send' | 'send_and_close' | 'send_and_pending',
    format?: 'email' | 'plain',
    attachments?: MessageAttachment[],
    snoozeMinutes?: number,
    extras?: {
      cc?: string
      bcc?: string
      channelAccountId?: string
      /** Mail-native composer: explicit recipients + reply/forward context. */
      to?: string
      mode?: MailDraftMode
      sourceMessageId?: string
      subject?: string
      quotedHtml?: string
      /** Routing choice after the reply (ask policy); omit = channel default. */
      handback?: boolean
      /** Keep open even when the channel closes after a human reply. */
      keepOpen?: boolean
    },
  ) => Promise<void>
  /** Retry a failed outbound bubble from the timeline. */
  onRetrySend?: (messageId: string) => void | Promise<void>
  onNote: (
    bodyText: string,
    attachments?: MessageAttachment[],
    opts?: { asChat?: boolean },
  ) => Promise<void>
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
  onDecisionResolved?: (info?: { closed?: boolean; answer?: { text: string; decisionId: string } }) => void
  /**
   * Composer behavior: `customer` threads get the reply/note composer,
   * `agent` (internal) threads get a note-only composer with an
   * "Ask assistant" action.
   */
  mode?: 'customer' | 'agent'
  /** Opens the planner (owned by the page; also reachable from the panel). */
  onPlan?: () => void
  /** Trailing unread inbound messages briefly flash when the thread opens. */
  unreadHighlightIds?: string[]
  /** `floating`: the chat-stack window draws its own compact header. */
  chrome?: 'page' | 'floating'
}

export default function ThreadDetail({ detail: detailProp, loading, error, threadId, saving, onPatch, onReply, onRetrySend, onNote, onForward, onUpdateNote, onDeleteNote, onMarkUnread, onRefresh, hasOlder = false, loadingOlder = false, onLoadOlder, onTogglePin, onChangeAiHandling, aiHandlingSaving = false, onDelete, deleting = false, onBack, onToggleContact, contactOpen, onDecisionResolved, mode = 'customer', onPlan, canSendEmail = false, mailboxNeedsSetup = false, unreadHighlightIds = [], chrome = 'page' }: Props) {
  const detail =
    detailProp && threadId && String(detailProp.thread.id) === String(threadId) ? detailProp : null
  const { t, i18n } = useTranslation('communication')
  const confirm = useConfirm()
  const { token, user } = useAuth()
  const [closeEmailOnSend, setCloseEmailOnSend] = useState(() => readCachedCloseEmailOnSend())
  useEffect(() => {
    if (!token) return
    let cancelled = false
    void fetchCloseEmailOnSend(token).then((enabled) => {
      if (!cancelled) setCloseEmailOnSend(enabled)
    })
    const onChange = (event: Event) => {
      const enabled = (event as CustomEvent<boolean>).detail
      if (typeof enabled === 'boolean') setCloseEmailOnSend(enabled)
    }
    window.addEventListener(CLOSE_EMAIL_ON_SEND_EVENT, onChange)
    return () => {
      cancelled = true
      window.removeEventListener(CLOSE_EMAIL_ON_SEND_EVENT, onChange)
    }
  }, [token])
  const { agents } = useAgents()
  const collectStageFields = useCollectStageFields()
  const location = useLocation()
  const navigate = useNavigate()
  const { connections } = useMailboxConnections()
  const refetchQuiet = useCallback(() => onRefresh(true), [onRefresh])
  const threadLog = useThreadLog(threadId ? String(threadId) : null, refetchQuiet)
  const [liveActiveTurn, setLiveActiveTurn] = useState<ThreadActiveTurn>(null)
  useEffect(() => {
    // Detail refresh is source of truth after Ask clears the run=false floor chip.
    setLiveActiveTurn(detail?.activeTurn ?? null)
  }, [detail?.activeTurn, threadId])
  const logFloor = threadLog.floor
  const logFloorSeen = threadLog.floorSeen
  useEffect(() => {
    if (!logFloorSeen) return
    setLiveActiveTurn(parseActiveTurn(logFloor))
  }, [logFloor, logFloorSeen])
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
  // Mail-native composer: set when Reply / Reply all / Forward is clicked on
  // an email bubble (or the Reply tab on an email thread).
  const [mailDraft, setMailDraft] = useState<MailDraftIntent | null>(null)
  // Body the operator was editing in the small composer when the mail client opened.
  const [mailSeedBody, setMailSeedBody] = useState<string | null>(null)
  // Unsent mail draft persisted by the mail composer; shown as a chip above
  // the standard composer so the operator can pick the mail back up.
  const [storedMailDraft, setStoredMailDraft] = useState<StoredMailDraft | null>(null)
  // Close-the-loop prompt when typed Signals are still Open (F-49).
  const [closeSignalsPrompt, setCloseSignalsPrompt] = useState<{
    tickets: Ticket[]
    afterResolve?: () => Promise<void>
    projectId?: string
  } | null>(null)
  const [fileMode, setFileMode] = useState<'file' | 'close' | null>(null)
  const [closeSignalsBusy, setCloseSignalsBusy] = useState(false)
  // Ask-session transcripts keyed by session id. Kept for closed sessions too
  // so checkout does not wipe the exchange from the host timeline.
  const [sessionTranscripts, setSessionTranscripts] = useState<Record<string, ChatMessage[]>>({})
  const {
    stream: sessionStream,
    agentStreaming,
    send: sendAgentSessionMessage,
    stop: stopAgentSessionStream,
  } = useAiChatStream(token, threadId ? String(threadId) : null)
  const agentStreamingRef = useRef(false)
  agentStreamingRef.current = agentStreaming
  const applyComposerDraft = useCallback(
    (draft: NonNullable<typeof composerDraft>) => {
      // Do not yank the Ask tab mid-stream when a suggestion card appears.
      if (agentStreamingRef.current) return
      // The draft lands in the standard composer; close the mail surface.
      setMailDraft(null)
      setMailSeedBody(null)
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

  // Open reply proposals that still answer the newest inbound land in the
  // mini composer (on thread open and when a live turn finishes). Email
  // focus promotes that body into the mail client.
  const appliedProposalRef = useRef<string | null>(null)
  const seededProposalIdsRef = useRef<Set<string> | null>(null)
  useEffect(() => {
    appliedProposalRef.current = null
    seededProposalIdsRef.current = null
  }, [threadId])
  useEffect(() => {
    if (!detail) return
    const outdated = new Set(outdatedDecisionMessageIds)
    const openIds: string[] = []
    for (const message of detail.messages) {
      const proposal = replyProposalFromMessage(message, detail.events)
      if (!proposal) continue
      if (outdated.has(proposal.decisionMessageId)) continue
      openIds.push(proposal.decisionMessageId)
    }
    const seedNewest = (keySuffix: string) => {
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
          key: `${proposal.decisionMessageId}-${keySuffix}`,
          decisionMessageId: proposal.decisionMessageId,
          basedOnMessageId: proposalBasedOnMessageId(detail.messages[i]) ?? undefined,
        })
        setComposerMode('reply')
        return
      }
    }
    if (seededProposalIdsRef.current === null) {
      seededProposalIdsRef.current = new Set(openIds)
      seedNewest('open')
      return
    }
    for (let i = detail.messages.length - 1; i >= 0; i -= 1) {
      const proposal = replyProposalFromMessage(detail.messages[i], detail.events)
      if (!proposal) continue
      if (outdated.has(proposal.decisionMessageId)) continue
      if (seededProposalIdsRef.current.has(proposal.decisionMessageId)) continue
      seededProposalIdsRef.current.add(proposal.decisionMessageId)
      seedNewest('auto')
      return
    }
  }, [detail, applyComposerDraft, outdatedDecisionMessageIds])

  const compactDecisionMessageIds = useMemo(() => {
    if (!detail) return []
    const outdated = new Set(outdatedDecisionMessageIds)
    const ids: string[] = []
    for (const message of detail.messages) {
      const proposal = replyProposalFromMessage(message, detail.events)
      if (!proposal) continue
      if (outdated.has(proposal.decisionMessageId)) continue
      ids.push(proposal.decisionMessageId)
    }
    return ids
  }, [detail, outdatedDecisionMessageIds])

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
  const [agentCandidates, setAgentCandidates] = useState<ThreadAgentCandidate[]>([])
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
    listThreadAgentCandidates(token, assigneesThreadId)
      .then((rows) => {
        if (!cancelled) setAgentCandidates(rows)
      })
      .catch(() => {
        if (!cancelled) setAgentCandidates([])
      })
    return () => {
      cancelled = true
    }
  }, [token, assigneesThreadId, t])
  const mentionExtras: MentionItem[] = useMemo(() => {
    if (!assignees) return []
    const reason = t('threadChrome.noChannelAccess')
    const agentRank = new Map(agentCandidates.map((row, index) => [row.id, index]))
    const rankedAgents = [...assignees.agents].sort((a, b) => {
      const left = agentRank.has(a.id) ? (agentRank.get(a.id) as number) : 1_000
      const right = agentRank.has(b.id) ? (agentRank.get(b.id) as number) : 1_000
      return left - right
    })
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
      ...rankedAgents.map(
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
          avatarShape: a.avatarShape,
          avatarImageUrl: a.avatarImageUrl,
        }),
      ),
      ...assignees.teams.map(
        (team): MentionItem => ({
          type: 'team',
          id: team.id,
          name:
            team.kind === 'custom'
              ? team.name
              : t(`teamPage.system.${team.kind}`, { ns: 'nav', defaultValue: team.name }),
          presence: team.presence,
          avatarKind: team.avatarKind,
          avatarIcon: team.avatarIcon,
          avatarColor: team.avatarColor,
          avatarImageUrl: team.avatarImageUrl,
        }),
      ),
    ]
  }, [assignees, agentCandidates, t])

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
  const talksDirectlyToAgent = Boolean(detail && isInternalThread(detail.thread))

  // A session the operator just started, until the thread detail refresh
  // carries it. Without this the first Ask has no session to stream into:
  // no live bubble, and the whole answer appears at once afterwards.
  const [pendingSession, setPendingSession] = useState<ThreadSession | null>(null)
  const [pendingDecisionAnswers, setPendingDecisionAnswers] = useState<
    { id: string; decisionId: string; text: string; createdAt: string }[]
  >([])
  useEffect(() => {
    setPendingSession(null)
    setPendingDecisionAnswers([])
    setSessionTranscripts({})
  }, [threadId])
  const activeSession = useMemo(() => {
    const fromDetail = (detail?.sessions ?? []).find((s) => s.state === 'active') ?? null
    if (fromDetail) return fromDetail
    if (
      pendingSession &&
      !(detail?.sessions ?? []).some((s) => s.id === pendingSession.id && s.state === 'closed')
    ) {
      return pendingSession
    }
    return null
  }, [detail?.sessions, pendingSession])
  const activeSessionId = activeSession?.id ?? null
  useEffect(() => {
    if (!pendingSession) return
    if ((detail?.sessions ?? []).some((s) => s.id === pendingSession.id)) setPendingSession(null)
  }, [detail?.sessions, pendingSession])
  // All Ask sessions on this thread (active + closed), oldest first. Pending
  // covers the first send before the detail refresh carries the session.
  const timelineSessions = useMemo(() => {
    const byId = new Map<string, ThreadSession>()
    for (const row of detail?.sessions ?? []) byId.set(row.id, row)
    if (
      pendingSession &&
      !byId.has(pendingSession.id) &&
      !(detail?.sessions ?? []).some((s) => s.id === pendingSession.id && s.state === 'closed')
    ) {
      byId.set(pendingSession.id, pendingSession)
    }
    return [...byId.values()].sort(
      (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
    )
  }, [detail?.sessions, pendingSession])
  // Inline session turns stay on the host timeline after checkout — same
  // bubbles as while the session was live. Optimistic operator bubbles only
  // attach to the active session.
  const sessionInboxMessages = useMemo(() => {
    if (talksDirectlyToAgent) return []
    return timelineSessions.flatMap((session) =>
      sessionTimelineMessages(
        session,
        sessionTranscripts[session.id] ?? null,
        session.id === activeSessionId ? sessionStream.optimisticUsers : [],
        user?.id ?? null,
      ),
    )
  }, [
    talksDirectlyToAgent,
    timelineSessions,
    sessionTranscripts,
    activeSessionId,
    sessionStream.optimisticUsers,
    user?.id,
  ])
  const sessionLog = useThreadLog(activeSessionId)
  const dismissSessionTurns = useCallback(() => {
    for (const turn of sessionLog.turns) sessionLog.dismiss(turn.streamId)
  }, [sessionLog])

  useEffect(() => {
    if (!detail || pendingDecisionAnswers.length === 0) return
    const answered = answeredDecisionIds(detail.messages)
    const bodies = new Set(detail.messages.map((m) => (m.bodyText || '').trim()).filter(Boolean))
    setPendingDecisionAnswers((prev) =>
      prev.filter((row) => !answered.has(row.decisionId) && !bodies.has(row.text.trim())),
    )
  }, [detail, pendingDecisionAnswers.length])

  const handleDecisionAnswer = useCallback(
    (answer: { text: string; decisionId: string } | null) => {
      if (!answer?.text || !answer.decisionId) {
        setPendingDecisionAnswers([])
        return
      }
      setPendingDecisionAnswers((prev) => [
        ...prev.filter((row) => row.decisionId !== answer.decisionId),
        {
          id: `pending-decision-${answer.decisionId}`,
          decisionId: answer.decisionId,
          text: answer.text,
          createdAt: new Date().toISOString(),
        },
      ])
    },
    [],
  )

  // While an assistant turn streams, splice optimistic operator bubbles into
  // the timeline so Send never blanks the thread waiting on a hard refresh.
  const timelineDetail = useMemo(() => {
    if (!detail) return detail
    const existingBodies = new Set(
      detail.messages
        .flatMap((m) => [(m.bodyText || '').trim(), (m.bodyPreview || '').trim()])
        .filter(Boolean),
    )
    const answered = answeredDecisionIds(detail.messages)
    const decisionExtras = pendingDecisionAnswers
      .filter((row) => row.text.trim() && !answered.has(row.decisionId) && !existingBodies.has(row.text.trim()))
      .map(
        (row) =>
          ({
            id: row.id,
            threadId: detail.thread.id,
            connectionId: null,
            kind: 'user_message',
            direction: 'outbound',
            fromAddress: '',
            toAddresses: '',
            subject: '',
            bodyPreview: row.text.slice(0, 200),
            bodyText: row.text,
            bodyHtml: null,
            graphMessageId: '',
            inReplyTo: null,
            authorUserId: user?.id ?? null,
            isRead: true,
            sendStatus: null,
            attachments: null,
            receivedAt: row.createdAt,
            createdAt: row.createdAt,
            decisionResponse: true,
            decisionResponseDecisionId: row.decisionId,
          }) as ThreadDetailType['messages'][number],
      )
    if (!talksDirectlyToAgent) {
      const sessionRows = sessionInboxMessages.length ? sessionInboxMessages : []
      if (!sessionRows.length && !decisionExtras.length) {
        return { ...detail, messages: collapseRecentUserEchoes(detail.messages).map(withAskListKey) }
      }
      return {
        ...detail,
        messages: collapseRecentUserEchoes([...detail.messages, ...sessionRows, ...decisionExtras]).map(withAskListKey),
      }
    }
    const optimistic = sessionStream.optimisticUsers
    const extras = optimistic
      .filter((m) => m.content.trim() && !existingBodies.has(m.content.trim()))
      .map(
        (m) =>
          ({
            id: m.id,
            listKey: m.id,
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
    if (!extras.length && !decisionExtras.length) {
      return { ...detail, messages: collapseRecentUserEchoes(detail.messages).map(withAskListKey) }
    }
    return {
      ...detail,
      messages: collapseRecentUserEchoes([...detail.messages, ...extras, ...decisionExtras]).map(withAskListKey),
    }
  }, [
    detail,
    talksDirectlyToAgent,
    sessionInboxMessages,
    sessionStream.optimisticUsers,
    pendingDecisionAnswers,
    user?.id,
  ])

  // The live overlay owns the turn until playback catches up. Hide every
  // saved row of that turn so the finished text does not pop in beside it.
  // A live turn hands off to its saved bubbles once they are in the list and
  // the reveal has caught up (or the safety timer fired).
  const savedTurnIds = useMemo(() => {
    const ids = new Set<string>()
    for (const message of [...(detail?.messages ?? []), ...sessionInboxMessages]) {
      if (message.turnId) ids.add(message.turnId)
    }
    return ids
  }, [detail?.messages, sessionInboxMessages])
  const [settledTurnIds, setSettledTurnIds] = useState<Set<string>>(() => new Set())
  const handleLivePlaybackDone = useCallback((streamId: string) => {
    setSettledTurnIds((prev) => (prev.has(streamId) ? prev : new Set(prev).add(streamId)))
  }, [])
  const logTurns = useMemo(
    () => [...threadLog.turns, ...sessionLog.turns].filter(turnHasContent),
    [threadLog.turns, sessionLog.turns],
  )
  const shownLiveTurns = useMemo(
    () => logTurns.filter((turn) => !(turn.ended && savedTurnIds.has(turn.streamId) && settledTurnIds.has(turn.streamId))),
    [logTurns, savedTurnIds, settledTurnIds],
  )
  const dismissThreadTurn = threadLog.dismiss
  const dismissSessionTurn = sessionLog.dismiss
  useEffect(() => {
    for (const turn of logTurns) {
      if (turn.ended && savedTurnIds.has(turn.streamId) && settledTurnIds.has(turn.streamId)) {
        dismissThreadTurn(turn.streamId)
        dismissSessionTurn(turn.streamId)
      }
    }
  }, [logTurns, savedTurnIds, settledTurnIds, dismissThreadTurn, dismissSessionTurn])
  // Safety: the saved bubbles are in but the reveal never reported done.
  const stalledTurnIds = logTurns
    .filter((turn) => turn.ended && savedTurnIds.has(turn.streamId) && !settledTurnIds.has(turn.streamId))
    .map((turn) => turn.streamId)
    .join(',')
  useEffect(() => {
    if (!stalledTurnIds) return
    const timer = window.setTimeout(() => {
      setSettledTurnIds((prev) => {
        const next = new Set(prev)
        for (const id of stalledTurnIds.split(',')) next.add(id)
        return next
      })
    }, LIVE_SETTLE_SAFETY_MS)
    return () => window.clearTimeout(timer)
  }, [stalledTurnIds])

  const liveOverlayTurnIds = useMemo(
    () => new Set(shownLiveTurns.map((turn) => turn.streamId)),
    [shownLiveTurns],
  )

  // Only hide saved rows that the live overlay still owns for this turn.
  const visibleTimelineDetail = useMemo(() => {
    if (!timelineDetail) return timelineDetail
    const messages = timelineDetail.messages.filter(
      (message) => !(message.turnId && liveOverlayTurnIds.has(message.turnId)),
    )
    if (messages.length === timelineDetail.messages.length) return timelineDetail
    return { ...timelineDetail, messages }
  }, [timelineDetail, liveOverlayTurnIds])

  const rows = useMemo(
    () => buildTimelineRows(visibleTimelineDetail, t, i18n.language),
    [visibleTimelineDetail, t, i18n.language],
  )

  const { nav: workspaceNav } = useCommunicationNav()
  const threadProjectId = detail?.thread.projectId ?? null
  const folder = useMemo(() => {
    if (!threadProjectId) return null
    const chain = findNavRowPath(workspaceNav.projects, threadProjectId)
    if (!chain) return null
    const leaf = chain[chain.length - 1]
    return { id: leaf.id, name: leaf.name, path: chain.map((row) => row.name).join(' / ') }
  }, [threadProjectId, workspaceNav.projects])
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
      setUnseenNew(0)
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
      timelineRef.current?.pinToEnd()
    } else {
      setUnseenNew((n) => n + (messageCount - prev))
    }
  }, [messageCount, loadedThreadId])

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
    setMailDraft(null)
    setMailSeedBody(null)
  }, [threadId])

  // The mail composer autosaves and flushes its draft on unmount; re-read
  // whenever the mail surface closes (or the thread changes) so the draft
  // chip above the composer stays accurate. Soft-undo parks a draft via
  // localStorage without toggling mailDraft — listen for that too.
  useEffect(() => {
    if (mailDraft) return
    setStoredMailDraft(readStoredMailDraft(String(threadId)))
  }, [threadId, mailDraft])

  useEffect(() => {
    const onDraftChanged = (event: Event) => {
      const id = (event as CustomEvent<{ threadId?: string }>).detail?.threadId
      if (id != null && String(id) !== String(threadId)) return
      if (mailDraft) return
      setStoredMailDraft(readStoredMailDraft(String(threadId)))
    }
    window.addEventListener(MAIL_DRAFT_CHANGED_EVENT, onDraftChanged)
    return () => window.removeEventListener(MAIL_DRAFT_CHANGED_EVENT, onDraftChanged)
  }, [threadId, mailDraft])

  // Addresses of our own mailboxes: excluded from reply-all recipient lists
  // and used to decide whether a bubble shows the Reply all button.
  const mailOwnAddresses = useMemo(
    () => connections.map((row) => row.mailboxEmail).filter(Boolean),
    [connections],
  )

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
    void getContactThreadPage(token, contactId)
      .then((page) => {
        if (!cancelled) setPreviousCount(Math.max(0, page.total - 1))
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

  // Land on the surface default when opening a thread. Manual handling forces
  // reply. An active meta conversation keeps Ask. Switching to Ask or @-mentioning
  // an agent must not snap back to Reply just because the thread refreshed.
  const handlingEffective = detail?.thread?.aiHandling?.effective ?? null
  const prevThreadIdRef = useRef<string | null>(null)
  useEffect(() => {
    const thread = detail?.thread
    if (!thread) {
      setComposerMode('reply')
      return
    }
    if (handlingEffective === 'manual' && messageLayout !== 'email') {
      // Manual handling puts chat channels straight on Reply. Email threads
      // keep their surface default: outbound mail always goes through the
      // mail-native composer (Reply tab / bubble actions), never the chat input.
      setComposerMode('reply')
      return
    }
    // Email opens on mail (Reply), not Ask — an active meta session must not
    // yank the surface when the operator just opened the thread.
    if (activeSessionId && messageLayout !== 'email') {
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
      const surface = resolveComposerSurface(thread)
      const hasCustomerDraft = Boolean(
        detail &&
          detail.messages.some((m) => {
            const proposal = replyProposalFromMessage(m, detail.events)
            return Boolean(proposal && !outdatedDecisionMessageIds.includes(proposal.decisionMessageId))
          }),
      )
      if (hasCustomerDraft && surface.modes.includes('reply')) {
        setComposerMode('reply')
        return
      }
      const land = composerLanding(detail?.messages ?? [], {
        selfUserId: user?.id ?? null,
        allowReply: surface.modes.includes('reply'),
      })
      setComposerMode(surface.modes.includes(land) ? land : surface.defaultMode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- detail.messages only matter on thread change
  }, [threadId, activeSessionId, handlingEffective, detail?.thread, messageLayout])

  const loadSessionMessages = useCallback(
    async (sessionId: string | null) => {
      if (!token || !sessionId) return
      try {
        const rows = await bokitoListMessages(token, sessionId)
        const next = rows.filter((m) => m.role === 'user' || m.role === 'assistant')
        setSessionTranscripts((prev) => ({ ...prev, [sessionId]: next }))
      } catch {
        // Keep any prior transcript for this session rather than wiping the timeline.
      }
    },
    [token],
  )

  // Fetch every Ask transcript on the thread (closed ones too) so history
  // remains visible after the agent checks out.
  useEffect(() => {
    if (!token || talksDirectlyToAgent) return
    const ids = timelineSessions.map((s) => s.id)
    if (!ids.length) return
    let cancelled = false
    void (async () => {
      await Promise.all(
        ids.map(async (id) => {
          if (cancelled) return
          await loadSessionMessages(id)
        }),
      )
    })()
    return () => {
      cancelled = true
    }
  }, [token, talksDirectlyToAgent, timelineSessions, loadSessionMessages])

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
        await fileTicket(threadIdString, match.id)
        onRefresh()
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
        const assigned = await onPatch({ assignedToUserId: target.id })
        if (assigned === false) return true
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
    [token, threadIdString, membersById, user?.email, t, onChangeAiHandling, onPatch, onRefresh],
  )

  const handleAskTabFocus = useCallback(() => setComposerMode('ask'), [])

  // A tag only picks the tab: agents and the team answer in Ask; a colleague
  // on a customer thread gets a note. Routing itself happens on the server.
  const handleMentionInserted = useCallback(
    (item: MentionItem) => {
      if (item.type === 'agent' || item.type === 'team') {
        setComposerMode('ask')
        return
      }
      if (item.type !== 'user' || !detail) return
      const surface = resolveComposerSurface(detail.thread)
      setComposerMode(surface.modes.includes('reply') && surface.modes.includes('note') ? 'note' : 'ask')
    },
    [detail],
  )

  const handleAgentMessage = useCallback(
    async (
      bodyText: string,
      attachments?: MessageAttachment[],
      opts?: { continuePending?: boolean; speakFirst?: boolean },
    ): Promise<boolean> => {
      if (!token || !threadIdString) return false
      const continuePending = Boolean(opts?.continuePending)
      const speakFirst = Boolean(opts?.speakFirst)
      // The text keeps its @chips: the server routes on them (nobody tagged
      // means the whole team, and the server picks who answers).
      const text = bodyText.trim()
      if (!continuePending && !speakFirst && !stripMentionMarkup(text).trim() && !attachments?.length) return false
      let prepared: Awaited<ReturnType<typeof prepareThreadAsk>>
      try {
        prepared = await prepareThreadAsk(token, threadIdString, {
          text,
          continuePending,
          hasAttachments: Boolean(attachments?.length),
        })
      } catch (err) {
        const detail = err instanceof Error ? err.message.trim() : ''
        toast.error(detail || t('agentSession.startError'))
        return false
      }
      if (!prepared) return false
      if (prepared.kind === 'decision') {
        onRefresh(true)
        window.setTimeout(() => pinToBottom('smooth'), 120)
        return true
      }
      const sessionId = prepared.sessionId
      if (!prepared.talksDirect && prepared.session) {
        setPendingSession(prepared.session)
        setSessionTranscripts((prev) => ({ ...prev, [prepared.sessionId]: [] }))
        onRefresh(true)
      }
      if (!sessionId) return false
      try {
        const sendPromise = sendAgentSessionMessage(sessionId, speakFirst ? '' : text || ' ', {
          attachments,
          continuePending,
          speakFirst,
          onFinished: async () => {
            if (!prepared.talksDirect) await loadSessionMessages(sessionId)
            // Quiet: keep bubbles on screen; never flash the thread skeleton.
            onRefresh(true)
            window.setTimeout(() => timelineRef.current?.pinToEnd(), 120)
          },
        })
        // Sending resumes the tail. The row arrives after this frame; the
        // second snap catches it, and the live cloud follows on its own.
        pinToLatest('smooth')
        window.setTimeout(() => timelineRef.current?.pinToEnd(), 140)
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
        if (!prepared.talksDirect) await loadSessionMessages(sessionId)
        onRefresh(true)
        return false
      }
    },
    [
      token,
      threadIdString,
      sendAgentSessionMessage,
      stopAgentSessionStream,
      loadSessionMessages,
      onRefresh,
      pinToLatest,
      t,
    ],
  )

  useEffect(() => {
    if (!detail || !threadIdString) return
    if (String(detail.thread.id) !== String(threadIdString)) return
    if ((detail.thread.channel ?? '') !== 'assistant') return
    if (autoSentThreads.has(threadIdString)) return

    const state = (location.state as {
      autoSend?: unknown
      continuePending?: unknown
      speakFirst?: unknown
    } | null) ?? null
    const stateContinue = state?.continuePending === true
    const stateSpeak = state?.speakFirst === true
    const stateDraft =
      typeof state?.autoSend === 'string' ? state.autoSend.trim() : ''
    // sessionStorage survives Communication remounts that wipe location.state.
    const stashed = takeChatContinue(threadIdString)
    const speakFirst = stateSpeak || stashed?.mode === 'speak'
    const continuePending = !speakFirst && (stateContinue || stashed?.mode === 'continue')
    const draft =
      stateDraft || (stashed?.mode === 'send' ? stashed.text : '') || ''
    const stashAttachments =
      stashed?.mode === 'send' && Array.isArray(stashed.attachments)
        ? (stashed.attachments as MessageAttachment[])
        : undefined
    if (!continuePending && !speakFirst && !draft && !stashAttachments?.length) return

    autoSentThreads.add(threadIdString)
    // Clear navigation state only after we know we will attempt the kick-off.
    if (stateContinue || stateDraft || stateSpeak) {
      navigate(`${location.pathname}${location.search}`, { replace: true, state: {} })
    }
    void handleAgentMessage(draft, stashAttachments, { continuePending, speakFirst }).then((ok) => {
      if (!ok) {
        // Allow a retry if the stream never started (busy / no session).
        autoSentThreads.delete(threadIdString)
      }
    })
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
    // The Ask turn lives on the child session log; aborting the HTTP SSE
    // alone leaves it on screen until the server's end event arrives.
    dismissSessionTurns()
  }, [stopAgentSessionStream, dismissSessionTurns])

  // Reply / Reply all / Forward on an email bubble opens the mail-native
  // composer, prefilled with recipients, subject and the quoted source mail.
  const handleMailAction = useCallback(
    (message: InboxMessage, draftMode: MailDraftMode) => {
      if (!detail) return
      if (mailboxDisconnected) {
        // No sending mailbox: the standard composer shows the reconnect notice.
        setComposerMode('reply')
        return
      }
      setComposerMode('reply')
      setMailSeedBody(null)
      setMailDraft(
        buildMailDraftIntent(message, draftMode, {
          ownAddresses: mailOwnAddresses,
          contactEmail: detail.thread.contactEmail,
          threadSubject: detail.thread.emailSubject,
          language: i18n.language,
          senderName:
            message.direction === 'inbound' ? detail.thread.contactName || null : user?.name || null,
        }),
      )
    },
    [detail, mailboxDisconnected, mailOwnAddresses, i18n.language, user?.name],
  )

  // Reopens the mail composer with the unsent draft. The intent (recipients,
  // quoted history) is rebuilt fresh from the source mail when it is still
  // loaded; the composer then restores the typed fields from the store.
  const resumeStoredMailDraft = useCallback(() => {
    if (!detail || !storedMailDraft) return
    if (mailboxDisconnected) {
      setComposerMode('reply')
      return
    }
    setComposerMode('reply')
    // Thread drafts only hold reply intents; 'new' lives on the compose page.
    const draftMode: MailDraftMode =
      storedMailDraft.mode === 'new' ? 'reply' : storedMailDraft.mode
    const source = detail.messages.find(
      (m) => String(m.id) === storedMailDraft.sourceMessageId,
    )
    setMailSeedBody(null)
    if (source) {
      setMailDraft(
        buildMailDraftIntent(source, draftMode, {
          ownAddresses: mailOwnAddresses,
          contactEmail: detail.thread.contactEmail,
          threadSubject: detail.thread.emailSubject,
          language: i18n.language,
          senderName:
            source.direction === 'inbound' ? detail.thread.contactName || null : user?.name || null,
        }),
      )
      return
    }
    // Source mail outside the loaded window: resume without quoted history.
    setMailDraft({
      mode: draftMode,
      sourceMessageId: storedMailDraft.sourceMessageId,
      to: storedMailDraft.to,
      cc: storedMailDraft.cc,
      subject: storedMailDraft.subject,
      quotedHtml: '',
      quotedPreview: '',
    })
  }, [detail, storedMailDraft, mailboxDisconnected, mailOwnAddresses, i18n.language, user?.name])

  const discardStoredMailDraft = useCallback(() => {
    clearStoredMailDraft(String(threadId))
    setStoredMailDraft(null)
  }, [threadId])

  // Mail drafts belong on the mail surface — never sit behind Ask. Resume once
  // when the thread opens on Reply; canceling the composer leaves the chip.
  const autoResumedMailDraftForRef = useRef<string | null>(null)
  useEffect(() => {
    autoResumedMailDraftForRef.current = null
  }, [threadId])
  useEffect(() => {
    if (messageLayout !== 'email' || mailboxDisconnected) return
    if (composerMode !== 'reply') return
    if (mailDraft || composerDraft) return
    if (!storedMailDraft) return
    if (autoResumedMailDraftForRef.current === String(threadId)) return
    autoResumedMailDraftForRef.current = String(threadId)
    resumeStoredMailDraft()
  }, [
    threadId,
    messageLayout,
    mailboxDisconnected,
    composerMode,
    mailDraft,
    composerDraft,
    storedMailDraft,
    resumeStoredMailDraft,
  ])

  const handleComposerModeChange = useCallback(
    (mode: ComposerMode) => {
      // The Reply tab on an email thread is a mail action: it opens the
      // mail-native composer on the newest customer mail instead of the chat
      // input, so recipients and quoting are always explicit. A pending AI
      // proposal draft stays in the standard composer (it resolves on send).
      if (mode === 'reply' && messageLayout === 'email' && detail && !mailboxDisconnected && !composerDraft) {
        // Stay on Reply under the mail view so closing it returns the compact field.
        setComposerMode('reply')
        // An unsent mail draft wins: the Reply tab picks it back up.
        if (storedMailDraft) {
          resumeStoredMailDraft()
          return
        }
        const source = [...detail.messages]
          .reverse()
          .find(
            (m) =>
              m.direction === 'inbound' && m.kind !== 'decision_request' && m.kind !== 'system_event',
          )
        if (source) {
          handleMailAction(source, 'reply')
          return
        }
        // Outbound-started thread without an inbound mail yet: mail goes
        // out through the mail composer too, just without quoted history.
        if (detail.thread.contactEmail) {
          setMailSeedBody(null)
          setMailDraft({
            mode: 'reply',
            sourceMessageId: '',
            to: detail.thread.contactEmail,
            cc: '',
            subject: detail.thread.emailSubject || '',
            quotedHtml: '',
            quotedPreview: '',
          })
          return
        }
      }
      setComposerMode(mode)
    },
    [
      messageLayout,
      detail,
      mailboxDisconnected,
      composerDraft,
      storedMailDraft,
      resumeStoredMailDraft,
      handleMailAction,
    ],
  )

  // Dismissing the mail view must not refocus straight back into it.
  const suppressMailPromoteRef = useRef(0)
  const dismissMailComposer = useCallback(() => {
    // Closing is a choice. Do not immediately grow the mail view back open
    // because a stored draft and Reply mode would satisfy the auto-resume effect.
    autoResumedMailDraftForRef.current = String(threadId)
    suppressMailPromoteRef.current = Date.now() + 300
    setMailDraft(null)
    setMailSeedBody(null)
    setComposerMode('reply')
  }, [threadId])

  // Focusing the small email composer opens the mail client (empty or with a
  // draft), with the same recipients and quote as Reply.
  const handlePromoteEmailEdit = useCallback(
    (body: string) => {
      if (Date.now() < suppressMailPromoteRef.current) return false
      if (!detail || messageLayout !== 'email' || mailboxDisconnected) return false
      const source = [...detail.messages]
        .reverse()
        .find(
          (m) =>
            m.direction === 'inbound' && m.kind !== 'decision_request' && m.kind !== 'system_event',
        )
      setMailSeedBody(body.trim() ? body : null)
      if (source) {
        setMailDraft(
          buildMailDraftIntent(source, 'reply', {
            ownAddresses: mailOwnAddresses,
            contactEmail: detail.thread.contactEmail,
            threadSubject: detail.thread.emailSubject,
            language: i18n.language,
            senderName: detail.thread.contactName || null,
          }),
        )
        return true
      }
      if (detail.thread.contactEmail) {
        setMailDraft({
          mode: 'reply',
          sourceMessageId: '',
          to: detail.thread.contactEmail,
          cc: '',
          subject: detail.thread.emailSubject || '',
          quotedHtml: '',
          quotedPreview: '',
        })
        return true
      }
      setMailSeedBody(null)
      return false
    },
    [detail, messageLayout, mailboxDisconnected, mailOwnAddresses, i18n.language],
  )

  // Send from the mail-native composer; afterwards the standard composer
  // returns and the sent mail lands in the timeline as an expandable bubble.
  const closeAfterMailSendRef = useRef<(() => Promise<void>) | null>(null)
  const handleMailSend = useCallback(
    async (payload: MailSendPayload) => {
      const close =
        closeEmailOnSend &&
        detail?.thread.channel === 'email' &&
        detail.thread.status !== 'closed' &&
        detail.thread.status !== 'spam'
      await onReply(payload.bodyText, 'send', 'email', payload.attachments, undefined, {
        cc: payload.cc,
        bcc: payload.bcc,
        channelAccountId: payload.channelAccountId,
        to: payload.to,
        // Threads only produce reply intents; 'new' lives on the compose page.
        mode: payload.mode === 'new' ? 'reply' : payload.mode,
        sourceMessageId: payload.sourceMessageId || undefined,
        subject: payload.subject,
        quotedHtml: payload.quotedHtml,
        // Close runs after send so open tickets can still be resolved.
        keepOpen: close ? true : undefined,
      })
      if (close) await closeAfterMailSendRef.current?.()
      // Outbound mail parks the open suggestion. Drop the small-composer
      // prefill so that draft does not reappear under the sent letter.
      setComposerDraft(null)
      setMailDraft(null)
      setMailSeedBody(null)
      window.setTimeout(() => scrollToBottom('smooth'), 80)
    },
    [onReply, scrollToBottom, closeEmailOnSend, detail],
  )

  const shownFloor = visibleFloor(liveActiveTurn ?? detail?.activeTurn)
  const floorAgentId = shownFloor?.ref_id != null ? String(shownFloor.ref_id) : null
  const liveAgentId =
    floorAgentId ??
    activeSession?.agentId ??
    detail?.thread.agentId ??
    null
  const agentLive = useLiveEntity<AgentLiveSnapshot>('agent_live', liveAgentId)
  const agentWorkingHere =
    agentLive?.status === 'working' && agentLive.threadId === threadIdString

  // Every open agent turn on this screen, in the order they started: the
  // thread's own agents and the inline session agent. The Ask SSE and the
  // floor only say a turn is open; until its first event they show an empty
  // thinking row. The live turns always render as the last rows.
  const threadLiveTurns = useMemo<LiveTurn[]>(() => {
    if (shownLiveTurns.length) return shownLiveTurns
    if (agentStreaming) return [textOnlyTurn('')]
    const floor = shownFloor
    if (floor?.kind === 'agent' && floor.ref_id && floor.status !== 'queued') {
      return [textOnlyTurn('')]
    }
    return []
  }, [shownLiveTurns, agentStreaming, shownFloor])
  const threadLiveTurn = threadLiveTurns.length ? threadLiveTurns[threadLiveTurns.length - 1] : null
  useThreadUx({
    token,
    signalId: threadIdString,
    turns: threadLiveTurns,
    streaming: Boolean(agentStreaming),
  })
  useDebugDom({
    token,
    signalId: threadIdString,
    feature: 'communication',
  })
  const liveOrbAgentId =
    threadLiveTurn?.author?.id ??
    floorAgentId ??
    activeSession?.agentId ??
    detail?.thread.agentId ??
    null
  const [operatorTyping, setOperatorTyping] = useState(false)
  const liveOrbDrive = useAgentOrbDrive(
    liveOrbAgentId,
    threadLiveTurn ? liveTurnOrbMotion(threadLiveTurn) : operatorTyping ? 'listening' : 'idle',
  )
  const closedTurnIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const turn of logTurns) {
      if (!turn.ended || !turn.streamId || closedTurnIdsRef.current.has(turn.streamId)) continue
      closedTurnIdsRef.current.add(turn.streamId)
      const drive = closingOrbPulse(turn.closing, turn.streamId)
      const agentId = turn.author?.id ?? liveOrbAgentId
      if (drive && agentId) publishBotOrbPulse(agentId, drive)
    }
  }, [logTurns, liveOrbAgentId])
  // Turns whose words the reader already saw — plus turns that just settled
  // out of the live overlay. Saved bubbles for those must land still; a second
  // enter + height remount is what the DOM logs show as the end-of-turn jump.
  const [spokeTurnIds, setSpokeTurnIds] = useState<Set<string>>(() => new Set())
  const handleLiveSpeech = useCallback((streamId: string) => {
    setSpokeTurnIds((prev) => (prev.has(streamId) ? prev : new Set(prev).add(streamId)))
  }, [])
  // Merge in the same render as settle so the first paint of saved bubbles
  // already skips enter (a latched enter cannot turn off later).
  const quietTurnIds = useMemo(() => {
    if (settledTurnIds.size === 0) return spokeTurnIds
    const next = new Set(spokeTurnIds)
    for (const id of settledTurnIds) next.add(id)
    return next
  }, [spokeTurnIds, settledTurnIds])
  // Whether the live turn joins the last saved agent bubble's run (no avatar
  // or author line, flattened top corner), as the saved bubble will.
  const liveContinuesRun = useMemo(
    () => liveRunContinues(rows, liveOrbAgentId ?? detail?.thread.agentId ?? null),
    [rows, liveOrbAgentId, detail?.thread.agentId],
  )

  // User's turn: park idle live orb on the latest agent bubble until the user
  // replies or leaves. Mid-turn / rejoin-while-busy uses threadLiveTurn instead.
  const idleSeat = useMemo(() => {
    if (threadLiveTurn) return null
    const agentId = liveOrbAgentId
    if (!agentId || !detail?.messages?.length) return null
    const last = detail.messages[detail.messages.length - 1]!
    const isAgent =
      last.kind === 'agent_message' ||
      Boolean(last.payload?.agent_id) ||
      Boolean(last.hasActivity)
    if (!isAgent) return null
    const aid =
      typeof last.payload?.agent_id === 'string' && last.payload.agent_id
        ? last.payload.agent_id
        : detail.thread.agentId
    if (!aid || String(aid) !== String(agentId)) return null
    return {
      messageId: String(last.id),
      activityAt: last.receivedAt || last.createdAt || null,
    }
  }, [threadLiveTurn, liveOrbAgentId, detail?.messages, detail?.thread.agentId])
  const idleSeatMessageId = idleSeat?.messageId ?? null
  const releaseIdleSeat = useMemo(() => {
    if (threadLiveTurn || idleSeatMessageId || !detail?.messages?.length) return false
    const last = detail.messages[detail.messages.length - 1]!
    const isAgent =
      last.kind === 'agent_message' ||
      Boolean(last.payload?.agent_id) ||
      Boolean(last.hasActivity)
    return !isAgent
  }, [threadLiveTurn, idleSeatMessageId, detail?.messages])

  // Pulse avatar corners as soon as this thread sees a live turn / Ask stream.
  // The API also broadcasts agent.status; this covers the same browser before
  // that event lands (and keeps the open-thread agent marked working).
  // Only an *active* live turn keeps Stop up — a sealed/ended overlay must not
  // leave Stop / “Nadenken” after the operator cancels (ended=false alone used
  // to stick when gateway never sent `end`).
  const sseBusy = Boolean(agentStreaming || (threadLiveTurn && threadLiveTurn.active))
  const agentTurnBusy = sseBusy || agentWorkingHere
  // Track optimistic working we pushed from this tab's Ask SSE so we can clear
  // it when the stream ends (gateway standby can lag / miss after catch-up
  // reload — left Stop / rail Bezig stuck under a finished reply).
  const pushedAskWorkingRef = useRef(false)
  useEffect(() => {
    if (!liveAgentId) return
    if (agentStreaming) {
      pushedAskWorkingRef.current = true
      applyAgentLive(liveAgentId, {
        status: 'working',
        summary: null,
        threadId: detail?.thread.id != null ? String(detail.thread.id) : null,
        activityId: null,
        lastActiveAt: Date.now(),
        source: 'ws',
      })
      return
    }
    if (!pushedAskWorkingRef.current) return
    pushedAskWorkingRef.current = false
    applyAgentLive(liveAgentId, {
      status: 'standby',
      summary: null,
      threadId: null,
      activityId: null,
      lastActiveAt: Date.now(),
      source: 'ws',
    })
  }, [liveAgentId, agentStreaming, detail?.thread.id])

  // Catch-up / remount: gateway may leave agent_live=working after the turn
  // already persisted. If SSE is idle and the latest bubble is that agent's
  // finished reply, drop the ghost Stop / rail Bezig (U05).
  // Also clear when the floor chip is gone — Extra leave / failed Ask left
  // agent_live=working on this threadId while active_turn was already `{}`,
  // so Stop/Nadenken stuck with no stream (ghost Stop).
  useEffect(() => {
    if (sseBusy || !agentWorkingHere || !liveAgentId) return
    const floor = liveActiveTurn ?? detail?.activeTurn
    const floorHeld = Boolean(floor?.ref_id && floor?.nonce)
    if (!floorHeld) {
      applyAgentLive(liveAgentId, {
        status: 'standby',
        summary: null,
        threadId: null,
        activityId: null,
        lastActiveAt: Date.now(),
        source: 'ws',
      })
      return
    }
    if (!detail?.messages?.length) return
    const last = detail.messages[detail.messages.length - 1]!
    const lastAgentId =
      typeof last.payload?.agent_id === 'string' && last.payload.agent_id
        ? last.payload.agent_id
        : last.kind === 'agent_message'
          ? detail.thread.agentId
          : null
    if (!lastAgentId || String(lastAgentId) !== String(liveAgentId)) return
    applyAgentLive(liveAgentId, {
      status: 'standby',
      summary: null,
      threadId: null,
      activityId: null,
      lastActiveAt: Date.now(),
      source: 'ws',
    })
  }, [
    sseBusy,
    agentWorkingHere,
    liveAgentId,
    liveActiveTurn,
    detail?.activeTurn,
    detail?.messages,
    detail?.thread.agentId,
  ])

  const requestCloseThread = useCallback(
    async (afterClose?: () => Promise<void>, projectId?: string) => {
      const closed = { status: 'closed' as const, ...(projectId ? { projectId } : {}) }
      if (!detail || isInternalThread(detail.thread)) {
        await onPatch(closed)
        if (afterClose) await afterClose()
        return
      }
      const openTickets = await loadOpenTickets(String(detail.thread.id))
      if (openTickets.length === 0) {
        await onPatch(closed)
        if (afterClose) await afterClose()
        return
      }
      setCloseSignalsPrompt({
        tickets: openTickets,
        afterResolve: afterClose,
        projectId,
      })
    },
    [detail, onPatch],
  )
  closeAfterMailSendRef.current = () => requestCloseThread()

  const confirmCloseWithSignals = useCallback(async () => {
    if (!closeSignalsPrompt) return
    setCloseSignalsBusy(true)
    try {
      if (token && detail) {
        await closeConversationCollecting(token, String(detail.thread.id), {
          resolve: true,
          collect: collectStageFields,
          projectId: closeSignalsPrompt.projectId,
        })
      }
      await onPatch({
        status: 'closed',
        ...(closeSignalsPrompt.projectId ? { projectId: closeSignalsPrompt.projectId } : {}),
      })
      if (closeSignalsPrompt.afterResolve) await closeSignalsPrompt.afterResolve()
      setCloseSignalsPrompt(null)
    } catch (err) {
      if (err instanceof TicketStageMoveCancelled) return
      toast.error(formatApiErrorMessage(err, t('threadChrome.closeWithTicketError')))
    } finally {
      setCloseSignalsBusy(false)
    }
  }, [closeSignalsPrompt, collectStageFields, detail, onPatch, t, token])

  const handleReply = useCallback(
    async (
      bodyText: string,
      action: 'send' | 'send_and_close' | 'send_and_pending',
      attachments?: MessageAttachment[],
      snoozeMinutes?: number,
      extras?: {
        cc?: string
        bcc?: string
        channelAccountId?: string
        to?: string
        handback?: boolean
        keepOpen?: boolean
      },
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
        } else if (action === 'send_and_pending' && snoozeMinutes && snoozeMinutes > 0 && !detail.thread.schedule) {
          await setThreadSchedule(token, String(detail.thread.id), {
            at: new Date(Date.now() + snoozeMinutes * 60_000).toISOString(),
          })
        }
        window.setTimeout(() => scrollToBottom('smooth'), 80)
        return
      }
      if (action === 'send_and_close') {
        // Send first, then prompt about open Signals before flipping status.
        const format = composerSurface?.includeSignature ? 'email' : 'plain'
        // Optimistic bubble lands immediately; pin the timeline to it.
        window.setTimeout(() => scrollToBottom('smooth'), 16)
        // keepOpen: the close happens here (after the open-Signals prompt),
        // not through the channel's close-after-reply policy.
        await onReply(bodyText, 'send', format, attachments, snoozeMinutes, {
          ...extras,
          keepOpen: true,
        })
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
      window.setTimeout(() => scrollToBottom('smooth'), 16)
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

  // Note tab, or @teammate chat (asChat) — agents go through Ask, not notes.
  const handleNote = useCallback(
    async (
      bodyText: string,
      attachments?: MessageAttachment[],
      opts?: { asChat?: boolean },
    ) => {
      await onNote(bodyText, attachments, opts)
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
          </div>
        </div>
      </div>
    )
  }

  const { thread } = detail

  // A streamed turn names its own author. The floor may already belong to the
  // next speaker, so it only names an empty thinking row.
  const liveAuthor = threadLiveTurn?.author ?? null
  const liveSeatAgentId =
    liveAuthor?.id ?? floorAgentId ?? (threadLiveTurn ? activeSession?.agentId : null) ?? null
  const liveSeatAgent = liveSeatAgentId
    ? agents.find((row) => String(row.id) === String(liveSeatAgentId))
    : undefined
  const liveSeatName =
    liveSeatAgent?.name ||
    liveAuthor?.name ||
    (liveAuthor ? null : shownFloor?.name ?? activeSession?.agentName) ||
    null
  const liveAvatarSource = preferLiveAgentAvatar(liveSeatAgent, {
    name: liveSeatName,
    agentId: liveSeatAgentId,
    agentAvatarKind: thread.agentAvatarKind,
    agentAvatarIcon: thread.agentAvatarIcon,
    agentAvatarColor: thread.agentAvatarColor,
    agentAvatarShape: thread.agentAvatarShape,
    agentAvatarImageUrl: thread.agentAvatarImageUrl,
  })
  const liveAvatarMark = toAiAvatarProps(
    liveAvatarSource,
    t('agentSession.title'),
  )

  return (
    <TooltipProvider delayDuration={150}>
    <LiveAgentSeatProvider>
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      <ClaimIdleAgentSeat
        agentId={liveOrbAgentId}
        messageId={idleSeatMessageId}
        activityAt={idleSeat?.activityAt}
        release={releaseIdleSeat}
      />
      <SyncLiveAgentFocus
        agentId={threadLiveTurn ? liveOrbAgentId ?? liveSeatAgentId : liveOrbAgentId}
      />
      {chrome === 'floating' ? null : (
      <ThreadHeader
        thread={thread}
        csat={detail.csat}
        saving={saving}
        loading={loading}
        previousCount={previousCount}
        onPatch={onPatch}
        onRequestClose={() => void requestCloseThread()}
        onFileInFolder={() => setFileMode('file')}
        onCloseAndFile={() => setFileMode('close')}
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
        onPlan={onPlan}
        participants={detail.participants}
        activeTurn={shownFloor}
        panelCount={openSignalCount + (thread.nextAt || thread.schedule ? 1 : 0)}
        onExampleChanged={() => {
          void onRefresh()
        }}
        folder={folder}
      />
      )}

      {thread.aiHandling?.reason === 'handoff_requested' || thread.aiHandling?.reason === 'escalated' ? (
        <Callout tone="warning" className="mx-3 mt-2" role="status">
          {t('threadChrome.humanRequestedBanner')}
        </Callout>
      ) : null}

      <div
        className="relative flex min-h-0 flex-1 flex-col"
        onPointerDown={(event) => {
          if (!mailDraft) return
          const target = event.target
          if (target instanceof Element && target.closest('[data-mail-action]')) return
          dismissMailComposer()
        }}
      >
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
          contactId={thread.contactId}
          agentName={thread.agentName}
          agentId={thread.agentId}
          channelAccountId={thread.channelAccountId ?? null}
          agentAvatarKind={thread.agentAvatarKind}
          agentAvatarIcon={thread.agentAvatarIcon}
          agentAvatarColor={thread.agentAvatarColor}
          agentAvatarShape={thread.agentAvatarShape}
          agentAvatarImageUrl={thread.agentAvatarImageUrl}
          chatTags={chatTags}
          events={detail.events}
          noteActions={
            onUpdateNote && onDeleteNote
              ? { onEdit: onUpdateNote, onDelete: onDeleteNote }
              : undefined
          }
          onMailAction={messageLayout === 'email' ? handleMailAction : undefined}
          mailOwnAddresses={mailOwnAddresses}
          onRetrySend={onRetrySend}
          focusedMessageId={focusedMessageId}
          unreadHighlightIds={unreadHighlightIds}
          hasOlder={hasOlder}
          loadingOlder={loadingOlder}
          onLoadOlder={onLoadOlder}
          activeSessionId={activeSessionId}
          agentStreaming={agentTurnBusy}
          onRefresh={onRefresh}
          onDecisionResolved={onDecisionResolved}
          onAnswer={handleDecisionAnswer}
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
          compactDecisionMessageIds={compactDecisionMessageIds}
          composerDecisionMessageId={composerDraft?.decisionMessageId ?? null}
          outdatedDecisionMessageIds={outdatedDecisionMessageIds}
          onAtBottomChange={(atBottom) => {
            anchorToBottomRef.current = atBottom
            if (atBottom) setUnseenNew(0)
          }}
          quietTurnIds={quietTurnIds}
          liveTrace={
            threadLiveTurns.length ? (
              <div className="space-y-1.5">
                {threadLiveTurns.map((turn, index) => {
                  const primary = index === threadLiveTurns.length - 1
                  if (primary) {
                    return (
                      <AgentTurnLive
                        // The author comes from the turn, so the next floor
                        // holder never takes over this text.
                        key={turn.streamId ?? liveSeatAgentId ?? 'live'}
                        turn={turn}
                        continuesRun={index === 0 && liveContinuesRun}
                        onPlaybackDone={handleLivePlaybackDone}
                        onSpeechShown={handleLiveSpeech}
                        // Same source as the saved author line (TimelineItem), so the
                        // hand-off keeps the name.
                        agentName={liveSeatName}
                        agentId={liveSeatAgentId}
                        avatarMark={liveSeatAgentId ? liveAvatarMark : null}
                        orbMotion={liveOrbDrive.motion}
                        orbPulseId={liveOrbDrive.pulseId}
                        orbBaseMotion={liveOrbDrive.baseMotion}
                      />
                    )
                  }
                  const peerId = turn.author?.id ?? null
                  const peer = peerId ? agents.find((row) => String(row.id) === String(peerId)) : undefined
                  const peerName = peer?.name || turn.author?.name || null
                  const peerMark = peerId
                    ? toAiAvatarProps(
                        preferLiveAgentAvatar(peer, { name: peerName, agentId: peerId }),
                        t('agentSession.title'),
                      )
                    : null
                  return (
                    <AgentTurnLive
                      key={turn.streamId ?? `peer-${index}`}
                      turn={turn}
                      continuesRun={index === 0 && liveContinuesRun}
                      onPlaybackDone={handleLivePlaybackDone}
                      onSpeechShown={handleLiveSpeech}
                      agentName={peerName}
                      agentId={peerId}
                      avatarMark={peerMark}
                      orbMotion={liveTurnOrbMotion(turn)}
                    />
                  )
                })}
              </div>
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
          currentChannel={thread.channel}
        />
      ) : null}
      {composerSurface &&
      !mailDraft &&
      storedMailDraft &&
      messageLayout === 'email' &&
      !mailboxDisconnected &&
      composerMode === 'reply' &&
      !composerDraft ? (
        // Above the composer mode-tab fade (z-10) so Mailconcept stays readable.
        <div className="relative z-20 shrink-0 bg-bg px-4 pt-1">
          <div className={CHAT_COLUMN_CLASS}>
            <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-bg-elevated px-3 py-1.5 text-xs">
              <PenLine size={13} className="shrink-0 text-text-muted" />
              <button
                type="button"
                onClick={resumeStoredMailDraft}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                data-testid="mail-draft-chip"
              >
                <span className="shrink-0 font-medium text-text-heading">
                  {t('mailComposer.draftChip')}
                </span>
                <span className="truncate text-text-muted">
                  {storedMailDraft.subject || storedMailDraft.body}
                </span>
              </button>
              <button
                type="button"
                onClick={resumeStoredMailDraft}
                className="shrink-0 font-medium text-accent transition-colors hover:text-accent-hover"
              >
                {t('mailComposer.draftChipResume')}
              </button>
              <button
                type="button"
                onClick={discardStoredMailDraft}
                title={t('mailComposer.draftChipDiscard')}
                aria-label={t('mailComposer.draftChipDiscard')}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {composerSurface && mailDraft && messageLayout === 'email' && !mailboxDisconnected ? (
        <MailComposer
          intent={mailDraft}
          threadId={String(thread.id)}
          draftKey={String(thread.id)}
          channelAccountId={thread.channelAccountId ?? null}
          initialBody={mailSeedBody ?? undefined}
          preferSeedBody={mailSeedBody != null}
          saving={saving}
          onSend={handleMailSend}
          onCancel={dismissMailComposer}
        />
      ) : composerSurface ? (
        <ReplyComposer
          surface={composerSurface}
          onTypingChange={setOperatorTyping}
          onReply={handleReply}
          onNote={handleNote}
          onAgentMessage={handleAgentMessage}
          onStopAgent={handleStopAgent}
          agentStreaming={agentTurnBusy}
          mode={composerMode}
          onModeChange={handleComposerModeChange}
          onVerb={handleComposerVerb}
          agentModeName={activeSession?.agentName ?? threadFace(thread).name ?? null}
          onAskTabFocus={handleAskTabFocus}
          onMentionInserted={handleMentionInserted}
          saving={saving || agentStreaming}
          lastInboundText={lastInboundText}
          routingPolicy={
            thread.status === 'closed' && detail.routingPolicy
              ? { ...detail.routingPolicy, closeAfterHumanReply: false }
              : (detail.routingPolicy ?? null)
          }
          closeEmailOnSend={
            thread.status !== 'closed' && thread.status !== 'spam' && closeEmailOnSend
          }
          handbackChoice={
            detail.routingPolicy?.afterHumanReply === 'ask' &&
            thread.owner?.kind !== 'user' &&
            thread.aiHandling?.effective !== 'manual'
          }
          channelAccountId={thread.channelAccountId ?? null}
          contactId={thread.contactId}
          customerEmail={thread.contactEmail}
          customerPhone={thread.contactPhone}
          customerName={thread.contactName}
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
            ) : thread.status === 'spam' ? (
              <span className="flex flex-wrap items-center gap-2">
                <AlertCircle size={13} className="shrink-0 text-status-warning" />
                <span>{t('composer.spamBlocked')}</span>
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
          onPromoteEmailEdit={messageLayout === 'email' ? handlePromoteEmailEdit : undefined}
        />
      ) : null}
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
                    .map((row) => row.name)
                    .filter(Boolean)
                    .slice(0, 3)
                    .join(', ') || t('threadChrome.closeWithTicketFallback'),
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            {(closeSignalsPrompt?.tickets ?? []).map((row) => (
              <TagPill
                key={row.signal_id}
                names={row.name}
                tone="action"
                size="md"
                color={(row.color || '') as LabelColor}
                icon={row.icon}
                title={row.stage ? `${row.name} · ${stageLabel(row.stage, t)}` : row.name}
                trailing={
                  row.stage ? (
                    <span className="inline-flex items-center gap-1.5 pl-0.5">
                      <StageProgressIcon
                        kind={row.stage.kind}
                        fill={row.stage.progress}
                        size={12}
                        title={stageLabel(row.stage, t)}
                      />
                      <span>{stageLabel(row.stage, t)}</span>
                    </span>
                  ) : null
                }
              />
            ))}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={closeSignalsBusy}
              onClick={() => setCloseSignalsPrompt(null)}
            >
              {t('threadChrome.closeWithTicketCancel')}
            </Button>
            <Button type="button" disabled={closeSignalsBusy} onClick={() => void confirmCloseWithSignals()}>
              {t('threadChrome.closeWithTicketResolve')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <FileInFolderDialog
        open={fileMode != null}
        onOpenChange={(open) => {
          if (!open) setFileMode(null)
        }}
        title={fileMode === 'close' ? t('threadChrome.closeAndFile') : t('threadChrome.fileInFolder')}
        confirmLabel={fileMode === 'close' ? t('threadChrome.closeAndFile') : t('threadChrome.fileConfirm')}
        onConfirm={async (projectId) => {
          if (!projectId) return
          if (fileMode === 'close') {
            await requestCloseThread(undefined, projectId)
            return
          }
          await onPatch({ projectId })
        }}
      />
    </div>
    </LiveAgentSeatProvider>
  </TooltipProvider>
  )
}
