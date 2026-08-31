import { useTranslation } from 'react-i18next'
import type { AccountingProposal } from '../../lib/accounting-proposal'

/**
 * Compact field summary for an accounting write proposal, shared by the inbox
 * decision card and the agent-chat decision card.
 */
export function AccountingProposalBlock({ proposal }: { proposal: AccountingProposal }) {
  const { t } = useTranslation('communication')
  return (
    <div className="mt-2 rounded-lg border border-border/60 bg-bg-elevated px-3 py-2">
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
        {t(`decisionCard.accounting.kinds.${proposal.kind}`, {
          defaultValue: t('decisionCard.accounting.title'),
        })}
      </p>
      <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        {proposal.rows.map((row) => (
          <div key={row.label} className="flex min-w-0 gap-1.5">
            <dt className="shrink-0 text-text-muted">
              {t(`decisionCard.accounting.fields.${row.label}`, {
                defaultValue: row.label,
              })}
            </dt>
            <dd className="min-w-0 truncate text-text-primary" title={row.value}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
