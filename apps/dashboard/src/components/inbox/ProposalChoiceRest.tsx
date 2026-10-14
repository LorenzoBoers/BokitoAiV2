import { useTranslation } from 'react-i18next'
import {
  decisionOptionLabelKey,
  type DecisionOption,
} from '../../lib/decision-options'
import { cn } from '../../lib/utils'
import { DecisionResolvedBy } from './DecisionResolvedBy'

export function displayDecisionOptionLabel(
  option: DecisionOption,
  t: (key: string) => string,
): string {
  const key = decisionOptionLabelKey(option)
  return key ? t(`decisionCard.options.${key}`) : option.label
}

export function labelsForChosenOptions(
  options: DecisionOption[],
  chosenIds: string[],
  t: (key: string) => string,
): string[] {
  const wanted = new Set(chosenIds.filter(Boolean))
  if (!wanted.size) return []
  return options
    .filter((option) => wanted.has(option.id))
    .map((option) => displayDecisionOptionLabel(option, t))
}

/**
 * After a choice, the options stay in the agent cloud as static chips.
 * Who resolved is shown on the cloud (not as a separate user bubble).
 */
export function ProposalChoiceRest({
  options,
  chosenIds,
  replaced = false,
  missing = false,
  resolvedStatus,
  resolvedByName,
  resolvedByMember,
  className,
}: {
  options: DecisionOption[]
  chosenIds: string[]
  replaced?: boolean
  missing?: boolean
  resolvedStatus?: 'approved' | 'rejected' | 'mixed' | string | null
  resolvedByName?: string | null
  resolvedByMember?: import('../../lib/inbox-api').InboxMember | null
  className?: string
}) {
  const { t } = useTranslation('communication')
  const chosen = new Set(chosenIds.filter(Boolean))
  const note = missing
    ? t('proposal.status.missing')
    : replaced
      ? t('proposal.status.superseded')
      : null

  return (
    <div className={cn('proposal-choice-rest space-y-1.5', className)} data-testid="proposal-choices">
      {note ? <p className="text-2xs text-text-muted">{note}</p> : null}
      {options.length ? (
        <div className="flex flex-wrap items-center gap-1.5" role="list" aria-label={t('proposal.choices')}>
          {options.map((option) => {
            const picked = chosen.has(option.id)
            return (
              <span
                key={option.id}
                role="listitem"
                data-chosen={picked || undefined}
                className={cn(
                  'proposal-choice-chip inline-flex max-w-full items-center rounded-lg px-2.5 py-1 text-xs leading-4',
                  picked
                    ? 'proposal-choice-chip-chosen bg-ai/15 font-medium text-ai-ink ring-1 ring-ai/35'
                    : 'bg-bg-elevated/80 text-text-muted ring-1 ring-border/50',
                )}
              >
                <span className="truncate-fade">{displayDecisionOptionLabel(option, t)}</span>
              </span>
            )
          })}
        </div>
      ) : null}
      {resolvedByName || resolvedByMember ? (
        <DecisionResolvedBy
          status={resolvedStatus || 'mixed'}
          name={resolvedByName}
          member={resolvedByMember}
        />
      ) : null}
    </div>
  )
}

export default ProposalChoiceRest
