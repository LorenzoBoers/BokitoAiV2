import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { LoadingBlock } from '../components/ui/loading-block'
import { ProjectShell } from '../components/project/ProjectShell'
import { useProjectContext } from '../context/ProjectContext'
import { getProjectBudget, type ProjectBudgetResponse } from '../lib/projects-api'
import { getProjectUsageSummary, type ProjectUsageSummary } from '../lib/project-usage-api'

export default function ProjectUsage() {
  const { t } = useTranslation(['nav', 'common'])
  const { projectId } = useProjectContext()
  const [summary, setSummary] = useState<ProjectUsageSummary | null>(null)
  const [budget, setBudget] = useState<ProjectBudgetResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const [sum, bud] = await Promise.all([
        getProjectUsageSummary(projectId, '30d').catch(() => null),
        getProjectBudget(projectId).catch(() => null),
      ])
      setSummary(sum)
      setBudget(bud)
      if (!sum && !bud) {
        setError(t('project.usage.loadError'))
      }
    } finally {
      setLoading(false)
    }
  }, [projectId, t])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <ProjectShell>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <p className="text-sm text-text-muted">{t('project.usage.description')}</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <LoadingBlock label={t('workforce.runs.loading')} />
            ) : error && !summary && !budget ? (
              <div className="space-y-2">
                <p className="text-sm text-destructive">{error}</p>
                <Button size="sm" variant="secondary" onClick={() => void load()}>
                  {t('common.retry', { defaultValue: 'Retry' })}
                </Button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {summary ? (
                  <>
                    <StatTile
                      label={t('project.usage.metrics.totalRuns')}
                      value={summary.total_runs.toString()}
                    />
                    <StatTile
                      label={t('project.usage.metrics.runningRuns')}
                      value={summary.running_runs.toString()}
                    />
                    <StatTile
                      label={t('project.usage.metrics.totalTokens')}
                      value={summary.tokens_used.toLocaleString()}
                    />
                    <StatTile
                      label={t('project.usage.metrics.failedRuns')}
                      value={summary.failed_runs.toString()}
                    />
                  </>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        {budget ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('project.usage.budgetTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3">
                <StatTile
                  label={t('project.usage.budget.dailyLimit')}
                  value={budget.token_budget_daily.toLocaleString()}
                />
                <StatTile
                  label={t('project.usage.budget.usedToday')}
                  value={budget.token_used_today.toLocaleString()}
                />
                <StatTile
                  label={t('project.usage.budget.remainingToday')}
                  value={budget.remaining_today.toLocaleString()}
                />
              </div>
              {budget.blocked ? (
                <p className="mt-3 text-sm text-status-warning">{t('project.usage.budget.blocked')}</p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </ProjectShell>
  )
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-text-heading">{value}</p>
    </div>
  )
}
