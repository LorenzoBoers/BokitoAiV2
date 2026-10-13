import { useTranslation } from 'react-i18next'
import { formatAppNumber } from '../../lib/app-number'
import { CapBar } from '../ui/cap-bar'

export type ProjectBudgetResponse = {
  token_budget_daily: number
  token_used_today: number
  blocked: boolean
}

/**
 * @deprecated Folder budgets were removed; kept for legacy imports only.
 */
export function ProjectBudgetBar({
  budget,
  className,
}: {
  budget: ProjectBudgetResponse
  className?: string
}) {
  const { t, i18n } = useTranslation('nav')
  const limit = Math.max(budget.token_budget_daily, 0)
  const used = Math.max(budget.token_used_today, 0)
  const ratio = limit > 0 ? Math.min(used / limit, 1) : 0

  return (
    <CapBar
      className={className}
      label={t('projects.detail.budgetBar.tokensToday')}
      value={
        <>
          {formatAppNumber(used, i18n.language)} / {formatAppNumber(limit, i18n.language)}
          {budget.blocked ? (
            <span className="ml-1.5 font-medium text-status-error">
              {t('projects.detail.budgetBar.capReached')}
            </span>
          ) : null}
        </>
      }
      ratio={ratio}
      exceeded={budget.blocked}
    />
  )
}

export default ProjectBudgetBar
