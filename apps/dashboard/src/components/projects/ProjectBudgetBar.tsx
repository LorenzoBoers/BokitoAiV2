import { useTranslation } from 'react-i18next'
import type { ProjectBudgetResponse } from '../../lib/projects-api'
import { formatAppNumber } from '../../lib/app-number'
import { cn } from '../../lib/utils'

/**
 * Compact daily token indicator: project usage measured against the
 * workspace-wide daily cap (there is no per-project budget). Used on project
 * cards and the project detail page.
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
  const barColor = budget.blocked
    ? 'bg-status-error'
    : ratio > 0.8
      ? 'bg-status-warning'
      : 'bg-accent'

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center justify-between text-xs text-text-muted">
        <span title={t('projects.detail.budgetBar.tokensToday')}>
          {t('projects.detail.budgetBar.tokensToday')}
        </span>
        <span>
          {formatAppNumber(used, i18n.language)} / {formatAppNumber(limit, i18n.language)}
          {budget.blocked ? (
            <span className="ml-1.5 font-medium text-status-error">
              {t('projects.detail.budgetBar.capReached')}
            </span>
          ) : null}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-elevated">
        <div
          className={cn('h-full rounded-full transition-[width] duration-300', barColor)}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
    </div>
  )
}

export default ProjectBudgetBar
