import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  BellOff,
  Bot,
  ChevronDown,
  Copy,
  Loader2,
  MessageSquareWarning,
  StickyNote,
  ThumbsDown,
  ThumbsUp,
  UserRound,
  X,
  Zap,
} from 'lucide-react'
import ChatText from './ChatText'
import {
  decisionSourceLabelKey,
  decisionSourceRef,
  parseDecisionAddressee,
  parseDecisionSource,
} from '../../lib/decision-source'
import { forYouPath } from '../../lib/messages-paths'
import { openEntityPath } from '../../lib/open-entity'
import { useMembers } from '../../hooks/useMembers'
import { useTeams } from '../../hooks/useTeams'
import { moduleProposalFromOptions } from '../../lib/module-proposal'
import { ModuleProposalBlock } from './ModuleProposalBlock'
import { formatDecisionExcerpt } from '../../lib/decision-excerpt'
import {
  composeDefaultSignatureHtml,
  plainTextToSignatureHtml,
  previewOutboundSignatureHtml,
  withAgentDisclaimer,
} from '../../lib/default-signature'
import {
  getConnectionSignature,
  listEmailConnections,
  type SignatureSource,
} from '../../lib/email-api'
import { formatToolDecisionSummary } from '../../lib/tool-decision-copy'
import { isModuleSetupAction } from '../../lib/integration-setup-url'
import {
  decisionOptionLabelKey,
  isPrimaryDecisionOption,
  isRejectDecisionOption,
  parseDecisionOptions,
  type DecisionOption,
} from '../../lib/decision-options'
import { useDecisionResolve } from './useDecisionResolve'
import { DecisionTextAnswer } from './ProposalActions'
import { cn } from '../../lib/utils'
import { IntegrationHostLogo } from '../integrations/IntegrationHostLogo'
import { resolveProviderBrand } from '../../lib/integration-brand'
import { useCorrectionChat } from '../../lib/correction-chat'
import { apiPost } from '../../lib/api'
import { appRoutes } from '../../api/routes'
import {
  patchThread,
  type InboxEvent,
  type InboxMessage,
  type ReplySendAs,
  type ThreadId,
} from '../../lib/inbox-api'
import { rememberSendAs, rememberedSendAs, tenantDefaultSendAs } from '../../lib/reply-send-as'
import { useAuth } from '../../context/AuthContext'
import { listAgents } from '../../lib/agents-api'
import { translateDecisionText, translateMockAgentBody } from '../../lib/activity-labels'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { AI_TEXT_CLASS, AiMark } from '../ai/AiMark'
import { AiAvatar } from '../ui/AiAvatar'
import { toAiAvatarProps } from '../../lib/agent-avatar'
import { ChatMessageBubble } from './ChatBubble'

type Props = {
  message: InboxMessage
  threadId: ThreadId
  events: InboxEvent[]
  onResolved?: (info?: { closed?: boolean }) => void
  onEditDraft?: (draft: {
    body: string
    subject?: string
    decisionMessageId: string
    sendAs?: ReplySendAs
  }) => void
  /** Name of the agent bound to this thread, used for the correction action. */
  agentName?: string | null
  /** Agent id for loading the send-as signature preview. */
  agentId?: string | null
  /** ChannelAccount UUID for mailbox signature resolve on user send-as. */
  channelAccountId?: string | null
  agentAvatarKind?: string | null
  agentAvatarIcon?: string | null
  agentAvatarColor?: string | null
  agentAvatarImageUrl?: string | null
  /**
   * Show the compact agent-cloud pill (expand to read + take over) instead of
   * the full decision card. Used for open reply proposals.
   */
  compactReplyProposal?: boolean
  /** This draft is already loaded in the reply composer. */
  activeInComposer?: boolean
  /** The customer wrote again after this proposal; the draft answers an older message. */
  outdated?: boolean
}

/** Inbound message a reply proposal answers (server anchor), if the card carries one. */
export function proposalBasedOnMessageId(message: InboxMessage): string | null {
  const decision = message.payload?.decision as { based_on_message_id?: unknown } | undefined
  const id = decision?.based_on_message_id
  return typeof id === 'string' && id ? id : null
}

/** Why a reply proposal was set aside (server `resolution_reason`), if any. */
export function proposalResolutionReason(message: InboxMessage): string | null {
  const decision = message.payload?.decision as { resolution_reason?: unknown } | undefined
  const reason = decision?.resolution_reason
  return typeof reason === 'string' && reason ? reason : null
}

/** True for an open "No reply needed" card: the agent judged the mail automated. */
export function isOpenNoReplyCard(message: InboxMessage, events: InboxEvent[]): boolean {
  if (message.kind !== 'decision_request') return false
  if (isDecisionResolved(message, events)) return false
  const options = extractOptions(message)
  if (isReplyProposal(options)) return false
  return options.some((o) => o.action_type === 'close_thread')
}

/** Open proposal state of a decision card: undefined when the message is not a card. */
export function decisionCardOpen(message: InboxMessage, events: InboxEvent[]): boolean | undefined {
  if (message.kind !== 'decision_request') return undefined
  return !isDecisionResolved(message, events)
}

function isDecisionResolved(message: InboxMessage, events: InboxEvent[]): boolean {
  if (!message.decisionId) return false
  const status = (message.payload?.decision as { status?: unknown } | undefined)?.status
  if (typeof status === 'string' && status !== 'awaiting_human' && status !== 'pending') {
    return true
  }
  return events.some((event) => {
    // Only resolution events count; decision_created marks creation, not resolution.
    if (!event.eventType.startsWith('decision_') || event.eventType === 'decision_created') return false
    const payloadId = event.payload?.decision_id
    return typeof payloadId === 'string' && payloadId === message.decisionId
  })
}

function extractOptions(message: InboxMessage): DecisionOption[] {
  const decision = message.payload?.decision
  if (!decision || typeof decision !== 'object') return []
  return parseDecisionOptions((decision as { options?: unknown }).options)
}

/**
 * Integration suggestions (`suggest_integration` tool) carry the provider slug
 * in the connect option payload; surfacing the brand logo makes the card
 * instantly recognizable.
 */
function integrationProviderFromOptions(options: DecisionOption[]): string | null {
  for (const option of options) {
    if (!isModuleSetupAction(option.action_type)) continue
    const provider = option.payload?.provider
    if (typeof provider === 'string' && provider.trim()) return provider.trim()
  }
  return null
}

/**
 * Drop an INTERNAL_NOTE: sentinel (and anything after it when a customer body
 * precedes it). Note-only leaks keep the note text without the label so older
 * bad proposals stay readable and take-overable.
 */
export function sanitizeProposalDraft(text: string): string {
  const raw = (text || '').trim()
  if (!raw) return ''
  const re = /^[ \t>*_-]*INTERNAL_NOTE:\s*/im
  const match = re.exec(raw)
  if (!match || match.index === undefined) return raw
  const before = raw.slice(0, match.index).trim()
  if (before) return before
  return raw.slice(match.index + match[0].length).trim()
}

function draftBodyFromOptions(options: DecisionOption[], fallback: string): string {
  const send = options.find((o) => o.id === 'send' || o.action_type === 'send_reply' || o.action_type === 'send_email')
  const payload = send?.payload
  if (payload) {
    const body =
      (typeof payload.body_text === 'string' && payload.body_text) ||
      (typeof payload.body === 'string' && payload.body) ||
      ''
    if (body.trim()) return sanitizeProposalDraft(body)
  }
  return sanitizeProposalDraft(fallback)
}

/** Chat bubbles of a reply suggestion (`payload.messages`); empty for one-message drafts. */
function draftBubblesFromOptions(options: DecisionOption[]): string[] {
  const send = options.find((o) => o.id === 'send' || o.action_type === 'send_reply' || o.action_type === 'send_email')
  const raw = send?.payload?.messages
  if (!Array.isArray(raw)) return []
  const bubbles = raw.filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
  return bubbles.length > 1 ? bubbles : []
}

function BubbleDrafts({
  bubbles,
  editable,
  onChange,
}: {
  bubbles: string[]
  editable: boolean
  onChange: (next: string[]) => void
}) {
  const { t } = useTranslation('communication')
  return (
    <div className="space-y-1.5">
      {bubbles.map((bubble, index) => (
        <div
          key={index}
          className="group relative max-w-[90%] rounded-xl rounded-tl-md border border-border/60 bg-bg-surface px-3 py-2"
        >
          {editable ? (
            <textarea
              value={bubble}
              rows={Math.min(6, Math.max(1, bubble.split('\n').length))}
              aria-label={t('decisionCard.bubbleLabel', { index: index + 1 })}
              onChange={(e) => onChange(bubbles.map((b, i) => (i === index ? e.target.value : b)))}
              className="w-full resize-none bg-transparent pr-5 text-sm leading-relaxed text-text-primary outline-none"
            />
          ) : (
            <ChatText content={bubble} className="text-sm leading-relaxed text-text-primary" />
          )}
          {editable && bubbles.length > 1 ? (
            <button
              type="button"
              onClick={() => onChange(bubbles.filter((_, i) => i !== index))}
              aria-label={t('decisionCard.removeBubble')}
              className="absolute right-1.5 top-1.5 rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:bg-bg-hover hover:text-text-primary focus:opacity-100 group-hover:opacity-100"
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}


/** Team-facing remarks the agent produced alongside the draft (never emailed). */
function internalNoteFromOptions(options: DecisionOption[]): string {
  for (const option of options) {
    const note = option.payload?.internal_note
    if (typeof note === 'string' && note.trim()) return note.trim()
  }
  return ''
}

/** True when this card's primary action is sending a reply to the customer. */
function isReplyProposal(options: DecisionOption[]): boolean {
  return options.some(
    (option) =>
      option.id === 'send' ||
      option.action_type === 'send_reply' ||
      option.action_type === 'send_email' ||
      option.action_type === 'draft',
  )
}

/**
 * The reply an agent proposed on this conversation, ready to drop into the
 * composer. Returns null for resolved cards and for non-reply decisions, so
 * the caller can pick the newest open proposal without duplicating the option
 * parsing rules.
 */
export function replyProposalFromMessage(
  message: InboxMessage,
  events: InboxEvent[],
): { decisionMessageId: string; body: string; subject?: string } | null {
  if (message.kind !== 'decision_request') return null
  if (isDecisionResolved(message, events)) return null
  const options = extractOptions(message)
  if (!isReplyProposal(options)) return null
  const body = draftBodyFromOptions(options, message.bodyText?.trim() || message.bodyPreview || '')
  if (!body.trim()) return null
  const send = options.find(
    (o) => o.id === 'send' || o.action_type === 'send_reply' || o.action_type === 'send_email',
  )
  const subject = typeof send?.payload?.subject === 'string' ? send.payload.subject : undefined
  return { decisionMessageId: String(message.id), body, subject }
}

export default function DecisionRequestMessage({
  message,
  threadId,
  events,
  onResolved,
  onEditDraft,
  agentName,
  agentId,
  channelAccountId = null,
  activeInComposer = false,
  agentAvatarKind,
  agentAvatarIcon,
  agentAvatarColor,
  agentAvatarImageUrl,
  compactReplyProposal = false,
  outdated = false,
}: Props) {
  const { t, i18n } = useTranslation('communication')
  const { token, user } = useAuth()
  const [sentiment, setSentiment] = useState<'up' | 'down' | null>(null)
  const [compactOpen, setCompactOpen] = useState(false)
  const { startCorrection, starting: correctionStarting } = useCorrectionChat()
  const [agentSignatureHtml, setAgentSignatureHtml] = useState('')
  const [agentDisplayName, setAgentDisplayName] = useState('')

  const decisionSubjectId = message.decisionId ? String(message.decisionId) : String(message.id)

  async function voteOnDecision(value: 'up' | 'down') {
    if (sentiment === value) return
    const previous = sentiment
    setSentiment(value)
    try {
      await apiPost(appRoutes.learning.feedback, {
        subject_type: 'decision',
        subject_id: decisionSubjectId,
        sentiment: value,
      })
    } catch {
      setSentiment(previous)
      toast.error(t('decisionCard.feedbackError'))
    }
  }
  const resolved = isDecisionResolved(message, events)
  const {
    busy,
    setBusy,
    error,
    setError,
    resolve,
    chooseOption,
    textOptionId,
    responseText,
    setResponseText,
    submitText,
    cancelText,
    teach,
    learned,
    learnBusy,
    ruleSuggestion,
    setRuleSuggestion,
    ruleBusy,
    activateRule,
  } = useDecisionResolve({
    threadId,
    cardMessageId: message.id,
    decisionId: message.decisionId ? String(message.decisionId) : null,
    resolved,
    onResolved,
  })
  const options = useMemo(() => extractOptions(message), [message])
  const decisionMeta = (message.payload?.decision as Record<string, unknown> | undefined) ?? undefined
  const chatQuestion =
    typeof decisionMeta?.question === 'string' ? decisionMeta.question.trim() : ''
  const multiSelect = decisionMeta?.selection === 'multiple'
  const [picked, setPicked] = useState<string[]>([])
  const approveOptionId =
    options.find((o) => o.learn)?.id ??
    options.find((o) => isPrimaryDecisionOption(o) && o.action_type && o.action_type !== 'reject')?.id ??
    'approve'
  const isChatAsk =
    !isReplyProposal(options) &&
    !options.some((o) =>
      ['close_thread', 'create_queue_item', 'accept_platform_change', 'send_reply', 'send_email'].includes(
        o.action_type || '',
      ),
    ) &&
    (Boolean(chatQuestion) ||
      options.some(
        (o) =>
          Boolean(o.learn) ||
          (Boolean(o.action_type) && !['reject', 'defer', 'escalate'].includes(o.action_type || '')),
      ))
  const integrationProvider = useMemo(() => integrationProviderFromOptions(options), [options])
  const integrationBrand = useMemo(
    () => (integrationProvider ? resolveProviderBrand(integrationProvider) : null),
    [integrationProvider],
  )
  const toolCopy = useMemo(
    () =>
      formatToolDecisionSummary(
        message.bodyText?.trim() || message.bodyPreview || '',
        message.subject,
      ),
    [message.bodyText, message.bodyPreview, message.subject],
  )
  const summary = translateDecisionText(
    toolCopy?.summary ||
      message.bodyText?.trim() ||
      message.bodyPreview ||
      message.subject ||
      t('decisionCard.decisionNeeded'),
    t,
  )
  const excerpt = formatDecisionExcerpt(summary)
  // Where the question came from (queue item, run, project, platform change).
  const decisionSource = useMemo(
    () =>
      parseDecisionSource(
        (message.payload?.decision as { source?: unknown } | undefined)?.source,
      ),
    [message.payload],
  )
  const addressee = parseDecisionAddressee(
    (message.payload?.decision as { addressee?: unknown } | undefined)?.addressee,
  )
  const { members } = useMembers()
  const { teams } = useTeams()
  const addresseeName = useMemo(() => {
    if (!addressee) return null
    if (addressee.kind === 'user') {
      const person = members.find((m) => m.uuid === addressee.id)
      return person ? person.name || person.email : null
    }
    const team = teams.find((tm) => tm.id === addressee.id)
    if (!team) return null
    return team.kind === 'people' ? t('nav:teamPage.system.people') : team.name
  }, [addressee, members, teams, t])
  const draftBody = useMemo(() => {
    if (toolCopy) return toolCopy.summary
    return translateMockAgentBody(
      translateDecisionText(draftBodyFromOptions(options, summary), t),
      t,
    )
  }, [toolCopy, options, summary, t])
  const suggestedBubbles = useMemo(
    () => (toolCopy ? [] : draftBubblesFromOptions(options)),
    [toolCopy, options],
  )
  const [bubbles, setBubbles] = useState<string[]>(suggestedBubbles)
  useEffect(() => setBubbles(suggestedBubbles), [suggestedBubbles])
  const editedBubbles = bubbles.map((b) => b.trim()).filter(Boolean)
  const displaySubject = useMemo(() => {
    const raw = toolCopy?.title || message.subject
    return raw ? translateDecisionText(raw, t) : null
  }, [toolCopy, message.subject, t])
  const isSuggestion = options.some((o) => o.action_type === 'send_reply' || o.action_type === 'send_email' || o.id === 'send')
  // The composer holds this draft; the timeline only marks that it happened.
  const asCompactProposal = compactReplyProposal && !resolved && isReplyProposal(options)
  // Automated/no-reply mail: the agent proposes an action instead of a reply.
  const isActionSuggestion = !isSuggestion && options.some((o) => o.action_type === 'close_thread')
  // Conversation-born work: the agent proposes adding an item to a project
  // queue. Action-suggestion cards can also carry a queue option; only a card
  // whose primary action is the queue add renders as a queue proposal.
  const isQueueProposal =
    !isSuggestion &&
    !isActionSuggestion &&
    options.some((o) => o.action_type === 'create_queue_item')
  const internalNote = useMemo(() => internalNoteFromOptions(options), [options])
  const learnFrom = useMemo(() => options.find((o) => o.learn)?.learn ?? null, [options])
  const moduleProposal = useMemo(() => moduleProposalFromOptions(options), [options])

  // Sender identity for the approved reply: the operator's last choice wins,
  // otherwise this agent's default, then the tenant default.
  const [sendAs, setSendAs] = useState<ReplySendAs>(() => rememberedSendAs() ?? 'user')
  const [agentDefaultSendAs, setAgentDefaultSendAs] = useState<ReplySendAs | null>(null)
  useEffect(() => {
    if (rememberedSendAs()) return
    let cancelled = false
    void (async () => {
      if (agentDefaultSendAs) {
        if (!cancelled) setSendAs(agentDefaultSendAs)
        return
      }
      if (!token) return
      const tenant = await tenantDefaultSendAs(token)
      if (!cancelled) setSendAs(tenant)
    })()
    return () => {
      cancelled = true
    }
  }, [token, agentDefaultSendAs])

  // Resolve agent id from prop or decision payload, then load signature + default send-as.
  const resolvedAgentId = useMemo(() => {
    if (agentId) return agentId
    const fromPayload = message.payload?.agent_id
    return typeof fromPayload === 'string' ? fromPayload : null
  }, [agentId, message.payload?.agent_id])

  const [mailboxSignatureHtml, setMailboxSignatureHtml] = useState('')
  const [signatureSource, setSignatureSource] = useState<SignatureSource>('sender')
  useEffect(() => {
    if (!token || !channelAccountId) {
      setMailboxSignatureHtml('')
      setSignatureSource('sender')
      return
    }
    let cancelled = false
    void listEmailConnections(token)
      .then((rows) => {
        const match = rows.find((row) => row.uuid === channelAccountId)
        if (!match || cancelled) return null
        return getConnectionSignature(token, match.id)
      })
      .then((cfg) => {
        if (cancelled || !cfg) return
        setMailboxSignatureHtml(cfg.signatureHtml)
        setSignatureSource(cfg.signatureSource)
      })
      .catch(() => {
        if (!cancelled) {
          setMailboxSignatureHtml('')
          setSignatureSource('sender')
        }
      })
    return () => {
      cancelled = true
    }
  }, [token, channelAccountId])

  useEffect(() => {
    if (!resolvedAgentId) {
      setAgentSignatureHtml('')
      setAgentDisplayName('')
      setAgentDefaultSendAs(null)
      return
    }
    let cancelled = false
    void listAgents()
      .then((rows) => {
        if (cancelled) return
        const match = rows.find((row) => String(row.id) === String(resolvedAgentId))
        setAgentSignatureHtml(
          typeof match?.email_signature_html === 'string' && match.email_signature_html.trim()
            ? match.email_signature_html
            : typeof match?.email_signature_text === 'string'
              ? plainTextToSignatureHtml(match.email_signature_text)
              : '',
        )
        setAgentDisplayName(typeof match?.name === 'string' ? match.name : '')
        const agentSendAs = match?.reply_send_as === 'user' || match?.reply_send_as === 'agent'
          ? match.reply_send_as
          : 'agent'
        setAgentDefaultSendAs(agentSendAs)
      })
      .catch(() => {
        if (!cancelled) {
          setAgentSignatureHtml('')
          setAgentDisplayName('')
          setAgentDefaultSendAs(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [resolvedAgentId])

  const userIdentity = {
    name: user?.name || user?.email || '',
    email: user?.email ?? null,
    jobTitle: user?.jobTitle ?? null,
    company: user?.tenant?.name,
    language: i18n.language,
  }
  const userSignatureHtml =
    sendAs === 'user'
      ? previewOutboundSignatureHtml({
          source: channelAccountId ? signatureSource : 'sender',
          mailboxHtml: mailboxSignatureHtml,
          personalHtml: user?.emailSignatureHtml,
          identity: userIdentity,
        })
      : ''
  const customSignatureHtml =
    sendAs === 'user'
      ? (channelAccountId && signatureSource === 'mailbox' && mailboxSignatureHtml.trim()
          ? mailboxSignatureHtml.trim()
          : (user?.emailSignatureHtml ?? '').trim())
      : agentSignatureHtml.trim()
  const baseSignatureHtml =
    sendAs === 'user'
      ? userSignatureHtml
      : customSignatureHtml ||
        composeDefaultSignatureHtml({
          name: agentDisplayName || agentName || t('decisionCard.sendAs.agentFallback'),
          company: user?.tenant?.name,
          language: i18n.language,
        })
  const signatureHtml =
    sendAs === 'agent' ? withAgentDisclaimer(baseSignatureHtml, i18n.language) : baseSignatureHtml
  const signatureIsDefault = !customSignatureHtml
  const signatureSettingsPath =
    sendAs === 'user'
      ? channelAccountId
        ? `/settings/channels/${channelAccountId}?edit=signature`
        : '/settings/profile'
      : resolvedAgentId
        ? `/agents/${resolvedAgentId}`
        : '/agents'

  function chooseSendAs(value: ReplySendAs) {
    setSendAs(value)
    rememberSendAs(value)
  }

  async function closeThreadInline() {
    if (!token) return
    setBusy(true)
    setError(null)
    try {
      await patchThread(token, threadId, { status: 'closed' })
      toast.success(t('decisionCard.toastClosed'))
      onResolved?.({ closed: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('decisionCard.closeError'))
    } finally {
      setBusy(false)
    }
  }

  function onOptionClick(option: DecisionOption) {
    return chooseOption(option, {
      onEdit: (edit) =>
        onEditDraft?.({
          // In the composer a blank line separates bubbles again.
          body: editedBubbles.length ? editedBubbles.join('\n\n') : draftBody,
          subject: typeof edit.payload?.subject === 'string' ? edit.payload.subject : undefined,
          decisionMessageId: String(message.id),
          sendAs,
        }),
      onSend: (send) =>
        resolve('approve', {
          optionId: send.id,
          body: draftBody,
          successLabel: t('decisionCard.toastSent'),
          sendAs,
          messages: editedBubbles.length ? editedBubbles : undefined,
        }),
    })
  }

  const agentAvatar = (
    <AiAvatar
      {...toAiAvatarProps(
        {
          name: agentName || agentDisplayName,
          agentId,
          agentAvatarKind,
          agentAvatarIcon,
          agentAvatarColor,
          agentAvatarImageUrl,
        },
        'Agent',
      )}
      size={28}
      decorative
    />
  )
  if (asCompactProposal && !ruleSuggestion) {
    const takeOver = () => {
      const sendOpt = options.find(
        (o) => o.id === 'send' || o.action_type === 'send_reply' || o.action_type === 'send_email',
      )
      onEditDraft?.({
        body: editedBubbles.length ? editedBubbles.join('\n\n') : draftBody,
        subject:
          typeof sendOpt?.payload?.subject === 'string' ? sendOpt.payload.subject : undefined,
        decisionMessageId: String(message.id),
        sendAs,
      })
    }
    return (
      <ChatMessageBubble
        side="left"
        avatar={agentAvatar}
        variant="external"
        body={
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setCompactOpen((open) => !open)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none transition-colors hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/40"
                aria-expanded={compactOpen}
              >
                <AiMark size={12} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate-fade text-xs text-text-muted">
                  {t('decision.compactProposal')}
                </span>
                <ChevronDown
                  size={14}
                  className={cn(
                    'shrink-0 text-text-muted transition-transform',
                    compactOpen && 'rotate-180',
                  )}
                />
              </button>
              {onEditDraft ? (
                <Button
                  type="button"
                  size="sm"
                  variant={activeInComposer ? 'ghost' : 'secondary'}
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={takeOver}
                >
                  {activeInComposer
                    ? t('decision.draftInComposer')
                    : t('decision.takeOverDraft')}
                </Button>
              ) : null}
            </div>
            {compactOpen ? (
              <div className="rounded-md border border-border/60 bg-bg-surface/80 px-2.5 py-2">
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-text-secondary">
                  {draftBody}
                </p>
              </div>
            ) : null}
          </div>
        }
      />
    )
  }

  if (resolved && !ruleSuggestion) {
    const status = (message.payload?.decision as { status?: unknown } | undefined)?.status
    const reason = proposalResolutionReason(message)
    const deferredLabelKey: Record<string, string> = {
      superseded_by_inbound: 'decisionCard.draftSupersededByInbound',
      superseded_by_external_reply: 'decisionCard.draftSupersededByExternalReply',
      sibling_thread: 'decisionCard.draftSiblingThread',
      handled_externally: 'decisionCard.draftHandledExternally',
      human_replied: 'decisionCard.draftHumanReplied',
    }
    const resolvedLabel = !isReplyProposal(options)
      ? t('decisionCard.titleDecision')
      : status === 'approved'
        ? t('decisionCard.draftSent')
        : status === 'rejected'
          ? t('decisionCard.draftRejected')
          : reason && deferredLabelKey[reason]
            ? t(deferredLabelKey[reason])
            : t('decisionCard.earlierDraft')
    const siblingId = (
      message.payload?.decision as { superseded_by_signal_id?: unknown } | undefined
    )?.superseded_by_signal_id
    const openSibling =
      typeof siblingId === 'string' && siblingId
        ? forYouPath(siblingId)
        : null
    return (
      <ChatMessageBubble
        side="left"
        avatar={agentAvatar}
        variant="external"
        body={
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate-fade text-xs text-text-muted">
              {resolvedLabel}
              {excerpt ? ` — ${excerpt}` : ''}
            </span>
            {openSibling ? (
              <Link
                to={openSibling}
                className="shrink-0 text-xs font-medium text-accent hover:underline"
                data-testid="draft-open-active-thread"
              >
                {t('decisionCard.openActiveThread', { defaultValue: 'Open active' })}
              </Link>
            ) : null}
            <span className="shrink-0 rounded-lg bg-bg-hover px-2.5 py-0.5 text-xs font-medium text-text-secondary">
              {t('decisionCard.resolved')}
            </span>
          </div>
        }
      />
    )
  }

  return (
    <ChatMessageBubble
      side="left"
      avatar={agentAvatar}
      variant={resolved ? 'external' : 'agent'}
      body={
        <>
        {!isChatAsk ? (
          <div className="mb-1 flex items-center gap-2">
            {isActionSuggestion ? (
              <BellOff className={cn('h-3.5 w-3.5', resolved ? 'text-text-muted' : AI_TEXT_CLASS)} aria-hidden />
            ) : (
              <AiMark size={14} className={resolved ? 'text-text-muted' : undefined} />
            )}
            <span
              className={cn(
                'text-xs font-semibold ',
                resolved ? 'text-text-muted' : AI_TEXT_CLASS,
              )}
            >
              {isQueueProposal
                ? t('decisionCard.titleQueueProposal')
                : isActionSuggestion
                  ? t('decisionCard.titleNoReply')
                  : isSuggestion
                    ? t('decisionCard.titleSuggestedReply')
                    : t('decision.waitForOk')}
            </span>
            {resolved ? (
              <span className="rounded-lg bg-bg-hover px-2.5 py-0.5 text-xs font-medium text-text-secondary">
                {t('decisionCard.resolved')}
              </span>
            ) : null}
          </div>
        ) : resolved ? (
          <div className="mb-1">
            <span className="rounded-lg bg-bg-hover px-2.5 py-0.5 text-xs font-medium text-text-secondary">
              {t('decisionCard.resolved')}
            </span>
          </div>
        ) : null}
        {!resolved && outdated && isSuggestion ? (
          <p
            className="mb-1.5 rounded-md border border-status-warning/40 bg-status-warning/10 px-2 py-1 text-xs text-text-secondary"
            data-testid="decision-outdated"
          >
            {t('decisionCard.customerWroteAgain')}
          </p>
        ) : null}
        {message.decisionId && !isChatAsk ? (
          <details className="mb-1.5 group/tech">
            <summary className="cursor-pointer list-none text-2xs font-medium text-text-muted/80 hover:text-text-muted [&::-webkit-details-marker]:hidden">
              {t('decisionCard.technical', { defaultValue: 'Technical' })}
            </summary>
            {/* Origin and addressee are context, not the question: folded here
                so the card reads as one calm ask. */}
            {decisionSource ? (
              <p className="mt-1 text-xs text-text-muted">
                {t('decisionCard.source.prefix', { defaultValue: 'From' })}{' '}
                <Link
                  to={openEntityPath(decisionSourceRef(decisionSource))}
                  className="font-medium text-accent hover:underline"
                >
                  {t(decisionSourceLabelKey(decisionSource), {
                    defaultValue: decisionSource.type.replace('_', ' '),
                  })}
                </Link>
              </p>
            ) : null}
            {!resolved && addresseeName ? (
              <p className="mt-1 text-xs text-text-muted" data-testid="decision-addressee">
                {t('decisionCard.askedTo', { name: addresseeName })}
              </p>
            ) : null}
            <div className="mt-1 flex items-center gap-1.5">
              <span className="truncate-fade font-mono text-2xs text-text-muted">
                {String(message.decisionId)}
              </span>
              <button
                type="button"
                aria-label={t('decisionCard.copyId')}
                title={t('decisionCard.copyId')}
                onClick={() => {
                  void navigator.clipboard.writeText(String(message.decisionId)).then(
                    () => toast.success(t('decisionCard.idCopied')),
                    () => toast.error(t('decisionCard.copyIdFailed')),
                  )
                }}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted/60 transition-colors hover:bg-bg-hover/60 hover:text-text-body"
              >
                <Copy size={11} />
              </button>
            </div>
          </details>
        ) : null}
        {isActionSuggestion ? (
          <>
            <p className="text-sm text-text-primary">{t('decisionCard.automatedExplainer')}</p>
            {excerpt ? (
              <p className="mt-1.5 text-sm text-text-secondary">{excerpt}</p>
            ) : null}
          </>
        ) : (
          <>
            {displaySubject &&
            !(
              isChatAsk &&
              (displaySubject === draftBody ||
                displaySubject === chatQuestion ||
                draftBody === chatQuestion)
            ) ? (
              <h3 className="flex items-center gap-2 text-sm font-medium text-text-heading">
                {integrationBrand ? (
                  <IntegrationHostLogo
                    logoUrl={integrationBrand.logoUrl}
                    logoDarkUrl={integrationBrand.logoDarkUrl}
                    initials={integrationBrand.initials}
                    color={integrationBrand.color}
                    name={integrationBrand.name}
                    hostSlug={integrationBrand.hostSlug}
                    size="sm"
                    className="rounded-md"
                  />
                ) : null}
                {displaySubject}
              </h3>
            ) : null}
            <div
              className={cn(
                'mt-2 overflow-hidden',
                isChatAsk
                  ? ''
                  : 'rounded-lg border border-border/60 bg-bg-elevated',
              )}
            >
              <div className={cn(isChatAsk ? 'py-0.5' : 'px-3 py-2')}>
                {suggestedBubbles.length ? (
                  <BubbleDrafts
                    bubbles={bubbles}
                    editable={!resolved && isSuggestion && !busy}
                    onChange={setBubbles}
                  />
                ) : (
                  <p className="whitespace-pre-wrap text-sm text-text-primary">
                    {chatQuestion || draftBody}
                  </p>
                )}
              </div>
              {!resolved && isSuggestion ? (
                <div className="border-t border-border/40 px-3 py-2">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="text-2xs font-medium text-text-muted">
                        {t('decisionCard.sendAs.signaturePreview')}
                      </span>
                      <div className="flex items-center gap-1">
                        <span className="text-2xs text-text-muted">{t('decisionCard.sendAs.label')}</span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => chooseSendAs('user')}
                          className={cn(
                            'flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium transition-colors',
                            sendAs === 'user'
                              ? 'border-border-light bg-bg-hover text-text-heading'
                              : 'border-border/60 text-text-muted hover:bg-bg-hover hover:text-text-body',
                          )}
                        >
                          <UserRound size={11} aria-hidden />
                          {t('decisionCard.sendAs.you')}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => chooseSendAs('agent')}
                          className={cn(
                            'flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium transition-colors',
                            sendAs === 'agent'
                              ? 'border-ai/40 bg-ai/10 text-text-primary'
                              : 'border-border/60 text-text-muted hover:bg-bg-hover hover:text-text-body',
                          )}
                        >
                          <Bot size={11} aria-hidden />
                          {agentName || t('decisionCard.sendAs.agentFallback')}
                        </button>
                      </div>
                    </div>
                    <Link
                      to={signatureSettingsPath}
                      className="md-app-link"
                    >
                      {signatureIsDefault
                        ? t('decisionCard.sendAs.customizeSignature')
                        : t('decisionCard.sendAs.editSignature')}
                    </Link>
                  </div>
                  <div
                    className="signature-preview prose prose-sm max-w-none text-xs [&_a]:underline"
                    dangerouslySetInnerHTML={{ __html: signatureHtml }}
                  />
                </div>
              ) : null}
            </div>
            {moduleProposal ? <ModuleProposalBlock proposal={moduleProposal} /> : null}
            {internalNote ? (
              <div className="mt-3 border-l-2 border-border/70 pl-3">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-text-muted">
                  <StickyNote size={12} className="shrink-0 text-text-muted" aria-hidden />
                  <span>{t('decisionCard.internalNote.title')}</span>
                  <span className="font-normal text-text-muted/80">
                    · {t('decisionCard.internalNote.notSent')}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-text-secondary">
                  {internalNote}
                </p>
              </div>
            ) : null}
          </>
        )}
        {!resolved ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {options.length > 0 ? (
              <>
                {options.map((option) => {
                  const primary = isPrimaryDecisionOption(option)
                  const quiet = option.action_type === 'defer' && isActionSuggestion
                  const activeText = option.input_type === 'text' && textOptionId === option.id
                  const labelKey = decisionOptionLabelKey(option)
                  const selected = multiSelect && picked.includes(option.id)
                  return (
                    <Button
                      key={option.id}
                      type="button"
                      size="sm"
                      variant={
                        selected
                          ? 'ai'
                          : primary
                            ? 'ai'
                            : quiet
                              ? 'ghost'
                              : activeText
                                ? 'outline'
                                : 'secondary'
                      }
                      disabled={busy}
                      aria-pressed={multiSelect && !isRejectDecisionOption(option) ? selected : undefined}
                      onClick={() => {
                        if (multiSelect && !isRejectDecisionOption(option)) {
                          setPicked((prev) =>
                            prev.includes(option.id)
                              ? prev.filter((id) => id !== option.id)
                              : [...prev, option.id],
                          )
                          return
                        }
                        void onOptionClick(option)
                      }}
                    >
                      {labelKey ? t(`decisionCard.options.${labelKey}`) : option.label}
                    </Button>
                  )
                })}
                {multiSelect ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ai"
                    disabled={busy || picked.length === 0}
                    onClick={() =>
                      void resolve('approve', {
                        optionId: picked[0],
                        optionIds: picked,
                        successLabel: t('proposal.confirmed'),
                      })
                    }
                  >
                    {t('proposal.confirm')}
                  </Button>
                ) : null}
                {isSuggestion ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    className="text-text-muted"
                    onClick={() => void closeThreadInline()}
                  >
                    {t('decisionCard.options.closeThread')}
                  </Button>
                ) : null}
              </>
            ) : (
              <>
                <Button type="button" size="sm" variant="ai" disabled={busy} onClick={() => void resolve('approve')}>
                  {t('decisionCard.options.approve')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void resolve('defer')}
                >
                  {t('decisionCard.options.defer')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void resolve('reject')}
                >
                  {t('decisionCard.options.reject')}
                </Button>
              </>
            )}
          </div>
        ) : null}
        {!resolved && learnFrom && message.decisionId ? (
          <div
            className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted"
            data-testid="decision-learn"
          >
            <span className="font-medium text-text-secondary">{t('decisionCard.learn.label')}</span>
            {learned ? (
              <span className="text-text-secondary">{t(`decisionCard.learn.done.${learned}`)}</span>
            ) : (
              <>
                <button
                  type="button"
                  disabled={learnBusy || busy}
                  className="text-accent hover:underline disabled:opacity-50"
                  onClick={() => void teach('allow', { approveOptionId })}
                >
                  {t('decisionCard.learn.allow')}
                </button>
                <button
                  type="button"
                  disabled={learnBusy || busy}
                  className="text-accent hover:underline disabled:opacity-50"
                  onClick={() => void teach('ask')}
                >
                  {t('decisionCard.learn.ask')}
                </button>
                <button
                  type="button"
                  disabled={learnBusy || busy}
                  className="text-accent hover:underline disabled:opacity-50"
                  onClick={() => void teach('deny')}
                >
                  {t('decisionCard.learn.deny')}
                </button>
              </>
            )}
          </div>
        ) : null}
        {!resolved && textOptionId ? (
          <DecisionTextAnswer
            className="mt-3"
            value={responseText}
            onChange={setResponseText}
            placeholder={options.find((o) => o.id === textOptionId)?.input_placeholder}
            busy={busy}
            onSubmit={() => void submitText()}
            onCancel={cancelText}
          />
        ) : null}
        {ruleSuggestion ? (
          <div className="mt-3 rounded-lg border border-ai/25 bg-ai/5 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Zap className={cn('h-3.5 w-3.5', AI_TEXT_CLASS)} aria-hidden />
              <p className="text-sm font-medium text-text-primary">
                {t(
                  ruleSuggestion.action === 'auto_task'
                    ? 'decisionCard.rulePrompt.autoTask'
                    : 'decisionCard.rulePrompt.autoClose',
                  { sender: ruleSuggestion.label || ruleSuggestion.matchValue },
                )}
              </p>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              {t('decisionCard.rulePrompt.explainer', { count: ruleSuggestion.observations })}
            </p>
            <div className="mt-2 flex gap-2">
              <Button type="button" size="sm" disabled={ruleBusy} onClick={() => void activateRule()}>
                {t('decisionCard.rulePrompt.confirm')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={ruleBusy}
                className="text-text-muted"
                onClick={() => setRuleSuggestion(null)}
              >
                {t('decisionCard.rulePrompt.dismiss')}
              </Button>
            </div>
          </div>
        ) : null}
        {error ? <p className="mt-2 text-xs text-status-error">{error}</p> : null}
        {/* Learning loop: thumbs feed decision feedback; the correct action
            opens a grounded chat with the responsible agent. Hide on leftover
            resolved cards so dismissed drafts do not keep asking for a vote. */}
        {!resolved ? (
        <div className="mt-2.5 flex items-center gap-0.5 border-t border-border/40 pt-2">
          <button
            type="button"
            aria-label={t('decisionCard.feedbackGood')}
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded transition-colors',
              sentiment === 'up'
                ? 'text-ai-ink bg-ai/10'
                : 'text-text-muted/60 hover:text-text-body hover:bg-bg-hover/60',
            )}
            onClick={() => void voteOnDecision('up')}
          >
            <ThumbsUp size={11} />
          </button>
          <button
            type="button"
            aria-label={t('decisionCard.feedbackPoor')}
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded transition-colors',
              sentiment === 'down'
                ? 'text-ai-ink bg-ai/10'
                : 'text-text-muted/60 hover:text-text-body hover:bg-bg-hover/60',
            )}
            onClick={() => void voteOnDecision('down')}
          >
            <ThumbsDown size={11} />
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t('decisionCard.correctInterpretation')}
                disabled={correctionStarting}
                className="ml-1 flex h-5 w-5 items-center justify-center rounded text-text-muted/60 transition-colors hover:bg-bg-hover/60 hover:text-text-body disabled:opacity-50"
                onClick={() =>
                  void startCorrection({
                    threadId: String(threadId),
                    agentId:
                      typeof message.payload?.agent_id === 'string' ? message.payload.agent_id : null,
                    agentName,
                    subjectType: 'decision',
                    subjectId: decisionSubjectId,
                    summary: draftBody || summary,
                  })
                }
              >
                {correctionStarting ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <MessageSquareWarning size={11} />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('decisionCard.correctInterpretation')}</TooltipContent>
          </Tooltip>
        </div>
        ) : null}
        </>
      }
    />
  )
}
