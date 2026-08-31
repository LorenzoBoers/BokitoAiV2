import { useTranslation } from 'react-i18next'
import type { ModuleProposal } from '../../lib/module-proposal'

function humanize(key: string): string {
  const text = key.replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Compact, schema-driven field summary for a module write proposal, shared by
 * the inbox decision card and the agent-chat decision card. Renders whatever
 * fields the approve payload carries, for any module.
 */
export function ModuleProposalBlock({ proposal }: { proposal: ModuleProposal }) {
  const { t } = useTranslation('communication')
  return (
    <div className="mt-2 rounded-lg border border-border/60 bg-bg-elevated px-3 py-2">
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
        {t(`decisionCard.module.kinds.${proposal.kind}`, {
          defaultValue: t('decisionCard.module.title', {
            defaultValue: `${humanize(proposal.module)} write`,
            module: humanize(proposal.module),
          }),
        })}
      </p>
      <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        {proposal.rows.map((row) => (
          <div key={row.label} className="flex min-w-0 gap-1.5">
            <dt className="shrink-0 text-text-muted">
              {t(`decisionCard.module.fields.${row.label}`, {
                defaultValue: humanize(row.label),
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
