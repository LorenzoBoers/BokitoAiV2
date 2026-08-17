import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { BellOff, Sparkles } from 'lucide-react'
import { cn } from '../../lib/utils'
import {
  patchThread,
  resolveThreadDecision,
  type InboxEvent,
  type InboxMessage,
  type ThreadId,
} from '../../lib/inbox-api'
import { useAuth } from '../../context/AuthContext'
import { Button } from '../ui/button'

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
  onResolved?: () => void
  onEditDraft?: (draft: { body: string; subject?: string; decisionMessageId: string }) => void
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

/**
 * Known option ids/action types get a translated button label so the card
 * follows the user's platform language; unknown (agent-authored) options
 * keep the label the agent wrote.
 */
function optionLabelKey(option: DecisionOption): string | null {
  const byId: Record<string, string> = {
    send: 'send',
    edit: 'edit',
    escalate: 'escalate',
    close: 'closeThread',
    create_task: 'createTask',
    keep_open: 'keepOpen',
    approve: 'approve',
    reject: 'reject',
    later: 'later',
    defer: 'defer',
  }
  if (byId[option.id]) return byId[option.id]
  const byAction: Record<string, string> = {
    send_reply: 'send',
    send_email: 'send',
    draft: 'edit',
    escalate: 'escalate',
    close_thread: 'closeThread',
    create_task: 'createTask',
    approve: 'approve',
    defer: 'keepOpen',
    reject: 'reject',
  }
  if (option.action_type && byAction[option.action_type]) return byAction[option.action_type]
  return null
}

export default function DecisionRequestMessage({
  message,
  threadId,
  events,
  onResolved,
  onEditDraft,
}: Props) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [textOptionId, setTextOptionId] = useState<string | null>(null)
  const [responseText, setResponseText] = useState('')
  const resolved = isDecisionResolved(message, events)
  const options = useMemo(() => extractOptions(message), [message])
  const summary =
    message.bodyText?.trim() ||
    message.bodyPreview ||
    message.subject ||
    t('decisionCard.decisionNeeded')
  const draftBody = useMemo(() => draftBodyFromOptions(options, summary), [options, summary])
  const isSuggestion = options.some((o) => o.action_type === 'send_reply' || o.action_type === 'send_email' || o.id === 'send')
  // Automated/no-reply mail: the agent proposes an action instead of a reply.
  const isActionSuggestion = !isSuggestion && options.some((o) => o.action_type === 'close_thread')

  async function resolve(
    action: 'approve' | 'defer' | 'reject',
    optionId?: string,
    bodyOverride?: string,
    successLabel?: string,
    answerText?: string,
  ) {
    if (!token || resolved) return
    setBusy(true)
    setError(null)
    try {
      await resolveThreadDecision(token, threadId, message.id, action, {
        optionId,
        body: bodyOverride,
        responseText: answerText,
      })
      toast.success(
        successLabel ??
          (action === 'approve'
            ? t('decisionCard.toastApproved')
            : action === 'defer'
              ? t('decisionCard.toastDeferred')
              : t('decisionCard.toastRejected')),
      )
      onResolved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('decisionCard.resolveError'))
    } finally {
      setBusy(false)
    }
  }

  async function closeThreadInline() {
    if (!token) return
    setBusy(true)
    setError(null)
    try {
      await patchThread(token, threadId, { status: 'closed' })
      toast.success(t('decisionCard.toastClosed'))
      onResolved?.()
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
    if (option.action_type === 'close_thread') {
      await resolve('approve', option.id, undefined, t('decisionCard.toastClosed'))
      return
    }
    if (option.action_type === 'create_task') {
      await resolve('approve', option.id, undefined, t('decisionCard.toastTaskCreated'))
      return
    }
    if (option.id === 'edit' || option.action_type === 'draft') {
      onEditDraft?.({
        body: draftBody,
        subject: typeof option.payload?.subject === 'string' ? option.payload.subject : undefined,
        decisionMessageId: String(message.id),
      })
      return
    }
    if (option.id === 'send' || option.action_type === 'send_reply' || option.action_type === 'send_email') {
      await resolve('approve', option.id, draftBody, t('decisionCard.toastSent'))
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

  return (
    <div className="flex justify-start">
      <div
        className={cn(
          'w-full max-w-3xl min-w-0 rounded-2xl border px-4 py-3',
          resolved
            ? 'border-border/50 bg-bg-surface/80'
            : isActionSuggestion
              ? 'border-accent/20 bg-accent/5'
              : 'border-accent/30 bg-accent/5',
        )}
      >
        <div className="mb-1 flex items-center gap-2">
          {isActionSuggestion ? (
            <BellOff className={cn('h-3.5 w-3.5', resolved ? 'text-text-muted' : 'text-accent/80')} aria-hidden />
          ) : (
            <Sparkles className={cn('h-3.5 w-3.5', resolved ? 'text-text-muted' : 'text-accent')} aria-hidden />
          )}
          <span
            className={cn(
              'text-xs font-semibold uppercase tracking-wide',
              resolved ? 'text-text-muted' : 'text-accent/90',
            )}
          >
            {isActionSuggestion
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
        </div>
        {isActionSuggestion ? (
          <>
            <p className="text-sm text-text-primary">{t('decisionCard.automatedExplainer')}</p>
            {summary ? (
              <p className="mt-1.5 line-clamp-3 text-sm text-text-secondary">{summary}</p>
            ) : null}
          </>
        ) : (
          <>
            {message.subject ? (
              <h3 className="text-sm font-medium text-text-heading">{message.subject}</h3>
            ) : null}
            <div className="mt-2 rounded-lg border border-border/50 bg-bg-surface/60 px-3 py-2">
              <p className="whitespace-pre-wrap text-sm text-text-primary">{draftBody}</p>
            </div>
          </>
        )}
        {!resolved ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {options.length > 0 ? (
              <>
                {options.map((option) => {
                  const primary =
                    option.id === 'send' ||
                    option.action_type === 'send_reply' ||
                    option.action_type === 'send_email' ||
                    option.action_type === 'close_thread'
                  const quiet = option.action_type === 'defer' && isActionSuggestion
                  const activeText = option.input_type === 'text' && textOptionId === option.id
                  const labelKey = optionLabelKey(option)
                  return (
                    <Button
                      key={option.id}
                      type="button"
                      size="sm"
                      variant={primary ? 'default' : quiet ? 'ghost' : activeText ? 'outline' : 'secondary'}
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
                <Button type="button" size="sm" disabled={busy} onClick={() => void resolve('approve')}>
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
        {error ? <p className="mt-2 text-xs text-status-error">{error}</p> : null}
      </div>
    </div>
  )
}
