import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  BellOff,
  Bot,
  Copy,
  Loader2,
  MessageSquareWarning,
  StickyNote,
  ThumbsDown,
  ThumbsUp,
  UserRound,
  Zap,
} from 'lucide-react'
import {
  decisionSourceLabelKey,
  decisionSourcePath,
  parseDecisionSource,
} from '../../lib/decision-source'
import { moduleProposalFromOptions } from '../../lib/module-proposal'
import { ModuleProposalBlock } from './ModuleProposalBlock'
import { formatDecisionExcerpt } from '../../lib/decision-excerpt'
import { composeDefaultSignatureHtml, plainTextToSignatureHtml, withAgentDisclaimer } from '../../lib/default-signature'
import { formatToolDecisionSummary } from '../../lib/tool-decision-copy'
import { isModuleSetupAction, setupIntegrationHref } from '../../lib/integration-setup-url'
import { cn } from '../../lib/utils'
import { IntegrationHostLogo } from '../integrations/IntegrationHostLogo'
import { resolveProviderBrand } from '../../lib/integration-brand'
import { useCorrectionChat } from '../../lib/correction-chat'
import { apiPost } from '../../lib/api'
import { appRoutes } from '../../api/routes'
import {
  patchThread,
  resolveThreadDecision,
  updateInboxRule,
  type InboxEvent,
  type InboxMessage,
  type InboxRuleSuggestion,
  type ReplySendAs,
  type ThreadId,
} from '../../lib/inbox-api'
import { rememberSendAs, rememberedSendAs, tenantDefaultSendAs } from '../../lib/reply-send-as'
import { snoozeUntilIso, SNOOZE_PRESETS } from '../../lib/snooze'
import { useAuth } from '../../context/AuthContext'
import { listAgents } from '../../lib/agents-api'
import { translateDecisionText, translateMockAgentBody } from '../../lib/activity-labels'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { AI_TEXT_CLASS, AiIconBox, AiMark } from '../ai/AiMark'
import { ChatMessageBubble } from './ChatBubble'

type DecisionOption = {
  id: string
  label: string
  action_type?: string
  payload?: Record<string, unknown>
  input_type?: 'text'
  input_placeholder?: string
}

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
  const options = (decision as { options?: unknown }).options
  if (!Array.isArray(options)) return []
  return options
    .map((row): DecisionOption | null => {
      if (!row || typeof row !== 'object') return null
      const raw = row as Record<string, unknown>
      const id = typeof raw.id === 'string' ? raw.id : ''
      if (!id) return null
      return {
        id,
        label: typeof raw.label === 'string' ? raw.label : id,
        action_type: typeof raw.action_type === 'string' ? raw.action_type : undefined,
        payload:
          raw.payload && typeof raw.payload === 'object'
            ? (raw.payload as Record<string, unknown>)
            : undefined,
        input_type: raw.input_type === 'text' ? 'text' : undefined,
        input_placeholder:
          typeof raw.input_placeholder === 'string' ? raw.input_placeholder : undefined,
      }
    })
    .filter((o): o is DecisionOption => o !== null)
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

function draftBodyFromOptions(options: DecisionOption[], fallback: string): string {
  const send = options.find((o) => o.id === 'send' || o.action_type === 'send_reply' || o.action_type === 'send_email')
  const payload = send?.payload
  if (payload) {
    const body =
      (typeof payload.body_text === 'string' && payload.body_text) ||
      (typeof payload.body === 'string' && payload.body) ||
      ''
    if (body.trim()) return body
  }
  return fallback
}


/** Team-facing remarks the agent produced alongside the draft (never emailed). */
function internalNoteFromOptions(options: DecisionOption[]): string {
  for (const option of options) {
    const note = option.payload?.internal_note
    if (typeof note === 'string' && note.trim()) return note.trim()
  }
  return ''
}

/**
 * Known option ids/action types get a translated button label so the card
 * follows the user's platform language; unknown (agent-authored) options
 * keep the label the agent wrote.
 */
function optionLabelKey(option: DecisionOption): string | null {
  // Queue proposals: approve reads as the action it performs.
  if (option.action_type === 'create_queue_item') {
    if (option.id === 'approve') return 'addToQueue'
    if (option.id === 'always_auto') return 'alwaysAllow'
  }
  const byId: Record<string, string> = {
    send: 'send',
    edit: 'edit',
    escalate: 'escalate',
    close: 'closeThread',
    create_task: 'createTask',
    keep_open: 'keepOpen',
    approve: 'approve',
    always_auto: 'alwaysAllow',
    reject: 'reject',
    later: 'later',
    defer: 'defer',
    enable: 'turnOn',
    connect: 'connectPackage',
  }
  if (byId[option.id]) return byId[option.id]
  // Remap known action_types only for canonical single-purpose options.
  // Agent-authored multi-choice cards often share action_type "escalate"
  // (human takeover) while carrying distinct labels — never overwrite those.
  const byAction: Record<string, string> = {
    send_reply: 'send',
    send_email: 'send',
    draft: 'edit',
    close_thread: 'closeThread',
    create_task: 'createTask',
    create_queue_item: 'addToQueue',
    approve: 'approve',
    defer: 'keepOpen',
    reject: 'reject',
    enable_module: 'turnOn',
    setup_integration: 'connectPackage',
    add_module_source: 'addSource',
  }
  if (option.action_type && byAction[option.action_type]) {
    // Keep a distinctive agent label when present (non-empty and not just the id).
    const label = (option.label || '').trim()
    if (label && label !== option.id) return null
    return byAction[option.action_type]
  }
  return null
}

export default function DecisionRequestMessage({
  message,
  threadId,
  events,
  onResolved,
  onEditDraft,
  agentName,
  agentId,
}: Props) {
  const { t, i18n } = useTranslation('communication')
  const { token, user } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [sentiment, setSentiment] = useState<'up' | 'down' | null>(null)
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
  const [error, setError] = useState<string | null>(null)
  const [textOptionId, setTextOptionId] = useState<string | null>(null)
  const [responseText, setResponseText] = useState('')
  const [ruleSuggestion, setRuleSuggestion] = useState<InboxRuleSuggestion | null>(null)
  const [ruleBusy, setRuleBusy] = useState(false)
  const resolved = isDecisionResolved(message, events)
  const options = useMemo(() => extractOptions(message), [message])
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
  const draftBody = useMemo(() => {
    if (toolCopy) return toolCopy.summary
    return translateMockAgentBody(
      translateDecisionText(draftBodyFromOptions(options, summary), t),
      t,
    )
  }, [toolCopy, options, summary, t])
  const displaySubject = useMemo(() => {
    const raw = toolCopy?.title || message.subject
    return raw ? translateDecisionText(raw, t) : null
  }, [toolCopy, message.subject, t])
  const isSuggestion = options.some((o) => o.action_type === 'send_reply' || o.action_type === 'send_email' || o.id === 'send')
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

  const customSignatureHtml =
    sendAs === 'user' ? (user?.emailSignatureHtml ?? '').trim() : agentSignatureHtml.trim()
  const baseSignatureHtml =
    customSignatureHtml ||
    composeDefaultSignatureHtml({
      name:
        sendAs === 'user'
          ? user?.name || user?.email || ''
          : agentDisplayName || agentName || t('decisionCard.sendAs.agentFallback'),
      email: sendAs === 'user' ? user?.email : null,
      jobTitle: sendAs === 'user' ? user?.jobTitle : null,
      company: user?.tenant?.name,
      language: i18n.language,
    })
  const signatureHtml =
    sendAs === 'agent' ? withAgentDisclaimer(baseSignatureHtml, i18n.language) : baseSignatureHtml
  const signatureIsDefault = !customSignatureHtml
  const signatureSettingsPath =
    sendAs === 'user'
      ? '/settings/profile'
      : resolvedAgentId
        ? `/agents/${resolvedAgentId}`
        : '/agents'

  function chooseSendAs(value: ReplySendAs) {
    setSendAs(value)
    rememberSendAs(value)
  }

  async function resolve(
    action: 'approve' | 'defer' | 'reject',
    optionId?: string,
    bodyOverride?: string,
    successLabel?: string,
    answerText?: string,
    sendAsOverride?: ReplySendAs,
    info?: { closed?: boolean },
  ) {
    if (!token || resolved) return
    setBusy(true)
    setError(null)
    try {
      const result = await resolveThreadDecision(token, threadId, message.id, action, {
        optionId,
        body: bodyOverride,
        responseText: answerText,
        sendAs: sendAsOverride,
      })
      const toastLabel =
        successLabel ??
        (action === 'approve'
          ? t('decisionCard.toastApproved')
          : action === 'defer'
            ? t('decisionCard.toastDeferredSnoozed')
            : t('decisionCard.toastRejected'))
      if (action === 'defer') {
        const tomorrow = SNOOZE_PRESETS.find((preset) => preset.key === 'tomorrow')
        await patchThread(token, threadId, {
          status: 'pending',
          snoozedUntil: tomorrow ? snoozeUntilIso(tomorrow) : null,
        })
      }
      toast.success(toastLabel, {
        action: result.taskId
          ? {
              label: t('decisionCard.openAgenda'),
              onClick: () => navigate('/agenda'),
            }
          : undefined,
      })
      // Learning loop: after repeated identical choices the platform proposes
      // a per-sender rule (or reports it already activated itself).
      const suggestion = result.ruleSuggestion
      if (suggestion?.autoPromoted) {
        toast.info(
          t('decisionCard.rulePrompt.autoPromoted', {
            sender: suggestion.label || suggestion.matchValue,
          }),
        )
      } else if (suggestion?.readyToActivate) {
        setRuleSuggestion(suggestion)
      }
      onResolved?.(
        info?.closed || optionId === 'close' || optionId === 'close_thread' ? { closed: true } : undefined,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : t('decisionCard.resolveError'))
    } finally {
      setBusy(false)
    }
  }

  async function activateRule() {
    if (!token || !ruleSuggestion) return
    setRuleBusy(true)
    try {
      await updateInboxRule(token, ruleSuggestion.id, { status: 'active' })
      toast.success(t('decisionCard.rulePrompt.activated'))
      setRuleSuggestion(null)
    } catch {
      toast.error(t('decisionCard.rulePrompt.error'))
    } finally {
      setRuleBusy(false)
    }
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

  async function onOptionClick(option: DecisionOption) {
    if (option.input_type === 'text') {
      setTextOptionId((current) => (current === option.id ? null : option.id))
      return
    }
    if (isModuleSetupAction(option.action_type)) {
      const provider =
        typeof option.payload?.provider === 'string' ? option.payload.provider.trim() : ''
      const moduleSlug =
        typeof option.payload?.module === 'string' ? option.payload.module.trim() : ''
      await resolve('approve', option.id)
      navigate(setupIntegrationHref({ module: moduleSlug, provider }))
      return
    }
    if (option.action_type === 'close_thread') {
      await resolve('approve', option.id, undefined, t('decisionCard.toastClosed'), undefined, undefined, {
        closed: true,
      })
      return
    }
    if (option.action_type === 'create_task') {
      await resolve('approve', option.id, undefined, t('decisionCard.toastTaskCreated'))
      return
    }
    if (option.action_type === 'create_queue_item') {
      await resolve('approve', option.id, undefined, t('decisionCard.toastQueueAdded'))
      return
    }
    if (option.id === 'edit' || option.action_type === 'draft') {
      onEditDraft?.({
        body: draftBody,
        subject: typeof option.payload?.subject === 'string' ? option.payload.subject : undefined,
        decisionMessageId: String(message.id),
        sendAs,
      })
      return
    }
    if (option.id === 'send' || option.action_type === 'send_reply' || option.action_type === 'send_email') {
      await resolve('approve', option.id, draftBody, t('decisionCard.toastSent'), undefined, sendAs)
      return
    }
    if (option.id === 'escalate' || option.action_type === 'escalate') {
      await resolve('reject', option.id, undefined, t('decisionCard.toastEscalated'))
      return
    }
    if (option.id === 'reject' || option.action_type === 'reject') {
      await resolve('reject', option.id, undefined, t('decisionCard.toastRejected'))
      return
    }
    if (option.id === 'later' || option.action_type === 'defer') {
      await resolve('defer', option.id)
      return
    }
    await resolve('approve', option.id)
  }

  const agentAvatar = <AiIconBox />

  if (resolved && !ruleSuggestion) {
    return (
      <ChatMessageBubble
        side="left"
        avatar={agentAvatar}
        variant="external"
        body={
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-text-muted">
              {t('decisionCard.earlierDraft')}
              {excerpt ? ` — ${excerpt}` : ''}
            </span>
            <span className="shrink-0 rounded-full bg-bg-hover px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
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
        <div className="mb-1 flex items-center gap-2">
          {isActionSuggestion ? (
            <BellOff className={cn('h-3.5 w-3.5', resolved ? 'text-text-muted' : AI_TEXT_CLASS)} aria-hidden />
          ) : (
            <AiMark size={14} className={resolved ? 'text-text-muted' : undefined} />
          )}
          <span
            className={cn(
              'text-xs font-semibold uppercase tracking-wide',
              resolved ? 'text-text-muted' : AI_TEXT_CLASS,
            )}
          >
            {isQueueProposal
              ? t('decisionCard.titleQueueProposal')
              : isActionSuggestion
                ? t('decisionCard.titleNoReply')
                : isSuggestion
                  ? t('decisionCard.titleSuggestedReply')
                  : t('decisionCard.titleDecision')}
          </span>
          {resolved ? (
            <span className="rounded-full bg-bg-hover px-2 py-0.5 text-[10px] font-medium text-text-secondary">
              {t('decisionCard.resolved')}
            </span>
          ) : null}
          {message.decisionId ? (
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
              className="ml-auto flex h-5 w-5 items-center justify-center rounded text-text-muted/60 transition-colors hover:bg-bg-hover/60 hover:text-text-body"
            >
              <Copy size={11} />
            </button>
          ) : null}
        </div>
        {decisionSource ? (
          <p className="mb-1.5 text-[11px] text-text-muted">
            {t('decisionCard.source.prefix', { defaultValue: 'From' })}{' '}
            <Link
              to={decisionSourcePath(decisionSource)}
              className="font-medium text-accent hover:underline"
            >
              {t(decisionSourceLabelKey(decisionSource), {
                defaultValue: decisionSource.type.replace('_', ' '),
              })}
            </Link>
          </p>
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
            {displaySubject ? (
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
            <div className="mt-2 overflow-hidden rounded-lg border border-border/60 bg-bg-elevated">
              <div className="px-3 py-2">
                <p className="whitespace-pre-wrap text-sm text-text-primary">{draftBody}</p>
              </div>
              {!resolved && isSuggestion ? (
                <div className="border-t border-border/40 px-3 py-2">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-text-muted">
                        {t('decisionCard.sendAs.signaturePreview')}
                      </span>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-text-muted">{t('decisionCard.sendAs.label')}</span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => chooseSendAs('user')}
                          className={cn(
                            'flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition-colors',
                            sendAs === 'user'
                              ? 'border-accent/50 bg-accent/10 text-text-primary'
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
                            'flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition-colors',
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
                      className="md-app-link inline-flex items-center gap-1 rounded-md border border-border/55 bg-bg-elevated px-1.5 py-0.5 text-[11px] font-medium text-accent no-underline transition-colors hover:border-accent/45 hover:bg-bg-hover/70"
                    >
                      {signatureIsDefault
                        ? t('decisionCard.sendAs.customizeSignature')
                        : t('decisionCard.sendAs.editSignature')}
                    </Link>
                  </div>
                  <div
                    className="prose prose-sm max-w-none text-xs text-text-secondary dark:prose-invert [&_a]:text-accent"
                    dangerouslySetInnerHTML={{ __html: signatureHtml }}
                  />
                </div>
              ) : null}
            </div>
            {moduleProposal ? <ModuleProposalBlock proposal={moduleProposal} /> : null}
            {internalNote ? (
              <div className="mt-3 border-l-2 border-border/70 pl-3">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-text-muted">
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
                  const primary =
                    option.id === 'send' ||
                    option.id === 'approve' ||
                    option.action_type === 'send_reply' ||
                    option.action_type === 'send_email' ||
                    option.action_type === 'close_thread' ||
                    option.action_type === 'approve' ||
                    isModuleSetupAction(option.action_type)
                  const quiet = option.action_type === 'defer' && isActionSuggestion
                  const activeText = option.input_type === 'text' && textOptionId === option.id
                  const labelKey = optionLabelKey(option)
                  return (
                    <Button
                      key={option.id}
                      type="button"
                      size="sm"
                      variant={primary ? 'ai' : quiet ? 'ghost' : activeText ? 'outline' : 'secondary'}
                      disabled={busy}
                      onClick={() => void onOptionClick(option)}
                    >
                      {labelKey ? t(`decisionCard.options.${labelKey}`) : option.label}
                    </Button>
                  )
                })}
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
        {!resolved && textOptionId ? (
          <div className="mt-3 space-y-2">
            <textarea
              value={responseText}
              onChange={(e) => setResponseText(e.target.value)}
              rows={3}
              autoFocus
              placeholder={
                options.find((o) => o.id === textOptionId)?.input_placeholder ??
                t('decisionCard.answerPlaceholder')
              }
              className="w-full resize-y rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/60"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy || !responseText.trim()}
                onClick={() =>
                  void resolve(
                    'approve',
                    textOptionId,
                    undefined,
                    t('decisionCard.toastAnswerSubmitted'),
                    responseText,
                  )
                }
              >
                {t('decisionCard.submitAnswer')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setTextOptionId(null)
                  setResponseText('')
                }}
              >
                {t('decisionCard.cancel')}
              </Button>
            </div>
          </div>
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
