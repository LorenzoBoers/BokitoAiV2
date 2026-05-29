import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, Bot } from 'lucide-react'
import { Card, CardContent, CardHeader } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { EmptyState } from '../components/ui/empty-state'
import { LoadingBlock } from '../components/ui/loading-block'
import { Badge } from '../components/ui/badge'
import { ProjectShell } from '../components/project/ProjectShell'
import { useProjectContext } from '../context/ProjectContext'
import { listWorkLogs, type WorkLogRow } from '../lib/work-logs-api'
import { projectWorkforceRunUrl } from '../lib/workforce-run-urls'
import { formatWorkLogWhen } from '../lib/work-logs-format'
import { formatWorkLogSubject } from '../lib/work-log-labels'
import { humanizeSnakeCase } from '../lib/display-name'

function statusVariant(status: string): 'neutral' | 'success' | 'destructive' {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'destructive'
  return 'neutral'
}

/** Per-project workforce history: agent runs for this project only. */
export default function ProjectWorkforceHistory() {
  const { t } = useTranslation(['nav', 'common'])
  const { projectId } = useProjectContext()
  const [runs, setRuns] = useState<WorkLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      setRuns(await listWorkLogs({ project_id: projectId, limit: 25 }))
    } catch (err) {
      setRuns([])
      setError(err instanceof Error ? err.message : t('workforce.runs.loadError'))
    } finally {
      setLoading(false)
    }
  }, [projectId, t])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <ProjectShell>
      <Card>
        <CardHeader>
          <p className="text-sm text-text-muted">{t('project.workforce.description')}</p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingBlock label={t('workforce.runs.loading')} />
          ) : error ? (
            <div className="space-y-2">
              <p className="text-sm text-status-error">{error}</p>
              <Button size="sm" variant="secondary" onClick={() => void load()}>
                {t('common:actions.retry', { defaultValue: 'Retry' })}
              </Button>
            </div>
          ) : runs.length === 0 ? (
            <EmptyState icon={Bot} title={t('workforce.runs.empty')} />
          ) : (
            <ul className="divide-y divide-border/60">
              {runs.map((run) => (
                <li key={run.id}>
                  <Link
                    to={projectWorkforceRunUrl(projectId, run.id)}
                    className="group flex items-center justify-between gap-3 py-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-text-heading">
                        {formatWorkLogSubject(run.task_subject, t('workforce.runs.fallbackSubject'))}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge variant={statusVariant(run.status)} className="text-[10px]">
                          {humanizeSnakeCase(run.status)}
                        </Badge>
                        <span className="text-xs text-text-muted">
                          {formatWorkLogWhen(run.started_at)}
                        </span>
                      </div>
                    </div>
                    <ArrowUpRight
                      size={14}
                      className="shrink-0 text-text-muted group-hover:text-text-primary"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </ProjectShell>
  )
}
