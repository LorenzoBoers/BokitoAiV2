import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { learnFromDecision, type LearnChoice } from '../../lib/agent-rules-api'
import type { DecisionOption } from '../../lib/decision-options'
import { isModuleSetupAction, setupIntegrationHref } from '../../lib/integration-setup-url'
import {
  patchThread,
  resolveThreadDecision,
  updateInboxRule,
  type InboxRuleSuggestion,
  type ProposalBundleEntry,
  type ReplySendAs,
  type ThreadId,
} from '../../lib/inbox-api'
import { bulkUpdateSignalThreads, resolveDecisionBundle, type BundleResolveRow } from '../../lib/signals-api'

export type DecisionAction = 'approve' | 'defer' | 'reject'

export type ResolveOptions = {
  optionId?: string
  optionIds?: string[]
  body?: string
  messages?: string[]
  responseText?: string
  sendAs?: ReplySendAs
  successLabel?: string
  closed?: boolean
}

/** What the operator just chose, before the thread reloads with the server state. */
export type LocalOutcome = {
  status: 'approved' | 'rejected' | 'deferred'
  optionId?: string
  optionIds?: string[]
  at: string
}

type Args = {
  threadId: ThreadId
  /** Message id of the decision card (the resolve endpoint is keyed on it). */
  cardMessageId: ThreadId | null
  decisionId: string | null
  resolved: boolean
  onResolved?: (info?: { closed?: boolean }) => void
}

/** Strip the "Review: " / "Approve: " prefix the server puts on action titles. */
export function actionTitle(title: string): string {
  for (const prefix of ['Review: ', 'Approve: ']) {
    if (title.startsWith(prefix)) return title.slice(prefix.length)
  }
  return title
}

/**
 * Resolve a DecisionRequest from any surface: the standalone card and the
 * inline proposal under an agent bubble route options the same way.
 */
export function useDecisionResolve({ threadId, cardMessageId, decisionId, resolved, onResolved }: Args) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<LocalOutcome | null>(null)
  const [textOptionId, setTextOptionId] = useState<string | null>(null)
  const [responseText, setResponseText] = useState('')
  const [ruleSuggestion, setRuleSuggestion] = useState<InboxRuleSuggestion | null>(null)
  const [ruleBusy, setRuleBusy] = useState(false)
  const [learned, setLearned] = useState<LearnChoice | null>(null)
  const [learnBusy, setLearnBusy] = useState(false)
  const done = resolved || outcome !== null

  async function resolve(action: DecisionAction, opts: ResolveOptions = {}) {
    if (!token || done || cardMessageId == null) return
    setBusy(true)
    setError(null)
    try {
      const result = await resolveThreadDecision(token, threadId, cardMessageId, action, {
        optionId: opts.optionId,
        optionIds: opts.optionIds,
        body: opts.messages ? undefined : opts.body,
        messages: opts.messages,
        responseText: opts.responseText,
        sendAs: opts.sendAs,
      })
      setOutcome({
        status: action === 'approve' ? 'approved' : action === 'defer' ? 'deferred' : 'rejected',
        optionId: opts.optionId,
        optionIds: opts.optionIds,
        at: new Date().toISOString(),
      })
      const toastLabel =
        opts.successLabel ??
        (action === 'approve'
          ? t('decisionCard.toastApproved')
          : action === 'defer'
            ? t('decisionCard.toastDeferredSnoozed')
            : t('decisionCard.toastRejected'))
      if (action === 'defer') {
        // Park-until-date retired: keep the thread in Open and mark unread.
        await patchThread(token, threadId, { status: 'open' })
        await bulkUpdateSignalThreads(token, [String(threadId)], 'unread')
      }
      toast.success(toastLabel, {
        action: result.taskId
          ? { label: t('decisionCard.openAgenda'), onClick: () => navigate('/agenda') }
          : undefined,
      })
      // Learning loop: after repeated identical choices the platform proposes
      // a per-sender rule (or reports it already activated itself).
      const suggestion = result.ruleSuggestion
      if (suggestion?.autoPromoted) {
        toast.info(
          t('decisionCard.rulePrompt.autoPromoted', { sender: suggestion.label || suggestion.matchValue }),
        )
      } else if (suggestion?.readyToActivate) {
        setRuleSuggestion(suggestion)
      }
      const closed = opts.closed || opts.optionId === 'close' || opts.optionId === 'close_thread'
      onResolved?.(closed ? { closed: true } : undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('decisionCard.resolveError'))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Route a clicked option to the right resolve call. Reply drafts (`send`,
   * `edit`) need composer state only the card has; it passes those handlers.
   */
  async function chooseOption(
    option: DecisionOption,
    handlers: { onEdit?: (option: DecisionOption) => void; onSend?: (option: DecisionOption) => Promise<void> } = {},
  ) {
    if (option.input_type === 'text') {
      setTextOptionId((current) => (current === option.id ? null : option.id))
      return
    }
    if (isModuleSetupAction(option.action_type)) {
      const provider = typeof option.payload?.provider === 'string' ? option.payload.provider.trim() : ''
      const moduleSlug = typeof option.payload?.module === 'string' ? option.payload.module.trim() : ''
      await resolve('approve', { optionId: option.id })
      navigate(setupIntegrationHref({ module: moduleSlug, provider }))
      return
    }
    if (option.action_type === 'close_thread') {
      await resolve('approve', { optionId: option.id, successLabel: t('decisionCard.toastClosed'), closed: true })
      return
    }
    if (option.action_type === 'create_task' || option.action_type === 'look_at') {
      await resolve('approve', { optionId: option.id, successLabel: t('decisionCard.toastTaskCreated') })
      return
    }
    if (option.action_type === 'create_queue_item') {
      await resolve('approve', { optionId: option.id, successLabel: t('decisionCard.toastQueueAdded') })
      return
    }
    if ((option.id === 'edit' || option.action_type === 'draft') && handlers.onEdit) {
      handlers.onEdit(option)
      return
    }
    if (
      (option.id === 'send' || option.action_type === 'send_reply' || option.action_type === 'send_email') &&
      handlers.onSend
    ) {
      await handlers.onSend(option)
      return
    }
    if (option.id === 'escalate' || option.action_type === 'escalate') {
      await resolve('reject', { optionId: option.id, successLabel: t('decisionCard.toastEscalated') })
      return
    }
    if (option.id === 'reject' || option.action_type === 'reject') {
      await resolve('reject', { optionId: option.id, successLabel: t('decisionCard.toastRejected') })
      return
    }
    if (option.id === 'later' || option.action_type === 'defer') {
      await resolve('defer', { optionId: option.id })
      return
    }
    await resolve('approve', { optionId: option.id })
  }

  async function submitText() {
    if (!textOptionId || !responseText.trim()) return
    await resolve('approve', {
      optionId: textOptionId,
      successLabel: t('decisionCard.toastAnswerSubmitted'),
      responseText,
    })
  }

  function cancelText() {
    setTextOptionId(null)
    setResponseText('')
  }

  async function teach(choice: LearnChoice, opts?: { approveOptionId?: string }) {
    if (!decisionId || learnBusy) return
    setLearnBusy(true)
    try {
      // "You may do this yourself" while the card is still open means this time
      // too — approve (and run the tool) before proposing the always-allow rule.
      if (choice === 'allow' && !done && opts?.approveOptionId && cardMessageId != null && token) {
        await resolveThreadDecision(token, threadId, cardMessageId, 'approve', {
          optionId: opts.approveOptionId,
        })
        setOutcome({
          status: 'approved',
          optionId: opts.approveOptionId,
          at: new Date().toISOString(),
        })
        onResolved?.(undefined)
      }
      const result = await learnFromDecision(decisionId, choice)
      setLearned(choice)
      toast.success(
        result.status === 'collected'
          ? t('decisionCard.learn.collected')
          : result.applied
            ? t('decisionCard.learn.applied')
            : t('decisionCard.learn.proposed'),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('decisionCard.learn.error'))
    } finally {
      setLearnBusy(false)
    }
  }

  /**
   * Resolve several action cards of one agent turn together. Rows that failed
   * stay open on the server and come back with `error`.
   */
  async function resolveBundle(
    entries: ProposalBundleEntry[],
    approve: 'all' | string[],
    reject: 'rest' | string[] = 'rest',
  ): Promise<BundleResolveRow[]> {
    if (!token || busy) return []
    const openIds = entries.filter((e) => e.status === 'awaiting_human').map((e) => e.decisionId)
    if (!openIds.length) return []
    setBusy(true)
    setError(null)
    try {
      const result = await resolveDecisionBundle(token, String(threadId), {
        decisionIds: openIds,
        approve: approve === 'all' ? 'all' : approve.filter((id) => openIds.includes(id)),
        reject,
      })
      const failed = result.results.filter((row) => row.error)
      const approved = result.results.filter((row) => row.status === 'approved').length
      const rejected = result.results.filter((row) => row.status === 'rejected').length
      if (failed.length) {
        toast.error(t('actionBundle.toastPartial', { count: failed.length }))
      } else if (approved && !rejected) {
        toast.success(t('actionBundle.toastApproved', { count: approved }))
      } else if (rejected && !approved) {
        toast.success(t('actionBundle.toastRejected', { count: rejected }))
      } else {
        toast.success(t('actionBundle.summary', { approved, rejected }))
      }
      onResolved?.(undefined)
      return result.results
    } catch (err) {
      setError(err instanceof Error ? err.message : t('decisionCard.resolveError'))
      return []
    } finally {
      setBusy(false)
    }
  }

  /** Teach a rule for one action row (allow / ask / deny); independent of this hook's decision. */
  async function teachEntry(entry: ProposalBundleEntry, choice: LearnChoice) {
    if (learnBusy) return null
    setLearnBusy(true)
    try {
      const result = await learnFromDecision(entry.decisionId, choice)
      toast.success(
        result.status === 'collected'
          ? t('decisionCard.learn.collected')
          : result.applied
            ? t('decisionCard.learn.applied')
            : t('decisionCard.learn.proposed'),
      )
      return result
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('decisionCard.learn.error'))
      return null
    } finally {
      setLearnBusy(false)
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

  return {
    busy,
    setBusy,
    error,
    setError,
    outcome,
    resolve,
    chooseOption,
    textOptionId,
    setTextOptionId,
    responseText,
    setResponseText,
    submitText,
    cancelText,
    teach,
    teachEntry,
    resolveBundle,
    learned,
    learnBusy,
    ruleSuggestion,
    setRuleSuggestion,
    ruleBusy,
    activateRule,
  }
}
