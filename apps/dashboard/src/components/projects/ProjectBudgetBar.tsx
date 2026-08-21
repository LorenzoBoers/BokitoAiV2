import type { ProjectBudgetResponse } from '../../lib/projects-api'
import { cn } from '../../lib/utils'

/**
 * Compact daily token budget indicator: usage bar + numbers. Used on project
 * cards and the project detail page.
 */
export function ProjectBudgetBar({
  budget,
  className,
}: {
  budget: ProjectBudgetResponse
  className?: string
}) {
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
        <span>Tokens today</span>
        <span>
          {used.toLocaleString()} / {limit.toLocaleString()}
          {budget.blocked ? <span className="ml-1.5 font-medium text-status-error">Budget exhausted</span> : null}
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
