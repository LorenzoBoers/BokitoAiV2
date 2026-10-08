import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, MoreHorizontal, X } from 'lucide-react'
import {
  decisionOptionLabelKey,
  isPrimaryDecisionOption,
  isRejectDecisionOption,
  parseDecisionOptions,
  type DecisionOption,
} from '../../lib/decision-options'
import type { MessageProposal, ThreadId } from '../../lib/inbox-api'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { useDecisionResolve } from './useDecisionResolve'

/** Free-text answer for a decision option with `input_type: text`. */
export function DecisionTextAnswer({
  value,
  onChange,
  placeholder,
  busy,
  onSubmit,
  onCancel,
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  busy: boolean
  onSubmit: () => void
  onCancel: () => void
  className?: string
}) {
  const { t } = useTranslation('communication')
  return (
    <div className={cn('space-y-2', className)}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        autoFocus
        placeholder={placeholder ?? t('decisionCard.answerPlaceholder')}
        className="w-full resize-y rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/60"
      />
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={busy || !value.trim()} onClick={onSubmit}>
          {t('decisionCard.submitAnswer')}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          {t('decisionCard.cancel')}
        </Button>
      </div>
    </div>
  )
}

function timeLabel(iso: string | null | undefined, locale: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay
    ? date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function optionLabel(option: DecisionOption, t: (key: string) => string): string {
  const key = decisionOptionLabelKey(option)
  return key ? t(`decisionCard.options.${key}`) : option.label
}

/**
 * The buttons of an agent proposal, under the agent's bubble. Once answered
 * they collapse into one quiet status line (the chosen answer is a chat bubble).
 */
export function ProposalActions({
  proposal,
  threadId,
  onResolved,
  picked,
  setPicked,
  chooseOptionRef,
}: {
  proposal: MessageProposal
  threadId: ThreadId
  onResolved?: (info?: { closed?: boolean }) => void
  picked?: string[]
  setPicked?: (next: string[] | ((prev: string[]) => string[])) => void
  /** Optional ref filled with choose-by-option-id for showcase clicks. */
  chooseOptionRef?: { current: ((optionId: string) => void) | null }
}) {
  const { t, i18n } = useTranslation('communication')
  const options = useMemo(() => parseDecisionOptions(proposal.options), [proposal.options])
  const multi = proposal.selection === 'multiple'
  const [localPicked, setLocalPicked] = useState<string[]>([])
  const selected = picked ?? localPicked
  const updatePicked = setPicked ?? setLocalPicked
  const serverResolved = proposal.status !== 'awaiting_human' && proposal.status !== 'pending'
  const {
    busy,
    error,
    outcome,
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
  } = useDecisionResolve({
    threadId,
    cardMessageId: proposal.cardMessageId,
    decisionId: proposal.decisionId,
    resolved: serverResolved,
    onResolved,
  })
  const learnFrom = options.find((o) => o.learn)?.learn ?? null
  const approveOptionId =
    options.find((o) => o.learn)?.id ??
    options.find((o) => isPrimaryDecisionOption(o) && o.action_type && o.action_type !== 'reject')?.id ??
    'approve'

  useEffect(() => {
    if (!chooseOptionRef) return
    chooseOptionRef.current = (optionId: string) => {
      const option = options.find((o) => o.id === optionId)
      if (!option) return
      if (multi && !isRejectDecisionOption(option)) {
        updatePicked((prev) =>
          prev.includes(optionId) ? prev.filter((id) => id !== optionId) : [...prev, optionId],
        )
        return
      }
      void chooseOption(option)
    }
    return () => {
      chooseOptionRef.current = null
    }
  }, [chooseOptionRef, options, multi, updatePicked, chooseOption])

  const status = outcome?.status ?? proposal.status
  if (outcome || serverResolved) {
    const when = timeLabel(outcome?.at ?? proposal.resolvedAt, i18n.language)
    let line = t('proposal.status.answered')
    if (status === 'deferred' && (outcome?.optionId ?? proposal.chosenOptionId) === 'superseded') {
      line = t('proposal.status.superseded')
    } else if (status === 'missing') {
      line = t('proposal.status.missing')
    } else if (status === 'deferred' || status === 'rejected') {
      // Keep a short cue; the operator bubble carries the label.
      line = status === 'rejected' ? t('proposal.status.rejected') : t('proposal.status.setAside')
    }
    const Icon = status === 'approved' ? Check : status === 'rejected' ? X : null
    return (
      <p className="flex items-center gap-1.5 text-xs text-text-muted" data-testid="proposal-status">
        {Icon ? <Icon size={12} aria-hidden /> : null}
        <span>
          {line}
          {when ? ` · ${when}` : ''}
        </span>
      </p>
    )
  }

  const primary = options.filter(isPrimaryDecisionOption)
  const rejects = options.filter(isRejectDecisionOption)
  const others = options.filter((o) => !isPrimaryDecisionOption(o) && !isRejectDecisionOption(o))
  const ordered = [...primary, ...others, ...rejects]

  return (
    <div className="space-y-2" data-testid="proposal-actions">
      <div className="flex flex-wrap items-center gap-1.5">
        {ordered.map((option) => {
          const isPrimary = isPrimaryDecisionOption(option)
          const isReject = isRejectDecisionOption(option)
          const activeText = option.input_type === 'text' && textOptionId === option.id
          const isSelected = multi && selected.includes(option.id)
          return (
            <Button
              key={option.id}
              type="button"
              size="sm"
              variant={
                isSelected
                  ? 'ai'
                  : isPrimary
                    ? 'ai'
                    : isReject
                      ? 'secondary'
                      : activeText
                        ? 'outline'
                        : 'ghost'
              }
              disabled={busy}
              aria-pressed={multi && !isReject ? isSelected : undefined}
              onClick={() => {
                if (multi && !isReject) {
                  updatePicked((prev) =>
                    prev.includes(option.id) ? prev.filter((id) => id !== option.id) : [...prev, option.id],
                  )
                  return
                }
                void chooseOption(option)
              }}
            >
              {optionLabel(option, t)}
            </Button>
          )
        })}
        {multi ? (
          <Button
            type="button"
            size="sm"
            variant="ai"
            disabled={busy || selected.length === 0}
            onClick={() =>
              void resolve('approve', {
                optionId: selected[0],
                optionIds: selected,
                successLabel: t('proposal.confirmed'),
              })
            }
          >
            {t('proposal.confirm')}
          </Button>
        ) : null}
        {learnFrom ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="iconSm"
                variant="ghost"
                aria-label={t('proposal.more')}
                disabled={busy || learnBusy}
                data-testid="proposal-more"
              >
                <MoreHorizontal size={14} aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel className="text-2xs font-medium text-text-muted">
                {learned ? t(`decisionCard.learn.done.${learned}`) : t('decisionCard.learn.label')}
              </DropdownMenuLabel>
              {(['allow', 'ask', 'unsure'] as const).map((choice) => (
                <DropdownMenuItem
                  key={choice}
                  disabled={learnBusy || learned !== null}
                  onSelect={() =>
                    void teach(choice, {
                      approveOptionId: choice === 'allow' ? approveOptionId : undefined,
                    })
                  }
                >
                  {t(`decisionCard.learn.${choice}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {learnFrom && !learned ? (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted"
          data-testid="proposal-next-time"
        >
          <span className="font-medium text-text-secondary">{t('decisionCard.learn.label')}</span>
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
        </div>
      ) : null}
      {learned ? (
        <p className="text-xs text-text-muted" data-testid="proposal-learned">
          {t(`decisionCard.learn.done.${learned}`)}
        </p>
      ) : null}
      {textOptionId ? (
        <DecisionTextAnswer
          value={responseText}
          onChange={setResponseText}
          placeholder={options.find((o) => o.id === textOptionId)?.input_placeholder}
          busy={busy}
          onSubmit={() => void submitText()}
          onCancel={cancelText}
        />
      ) : null}
      {error ? <p className="text-xs text-status-error">{error}</p> : null}
    </div>
  )
}

export default ProposalActions
