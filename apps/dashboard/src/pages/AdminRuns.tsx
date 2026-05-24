import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LiveWorkLog } from '../components/observability/LiveWorkLog'
import { Card } from '../components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { LoadingBlock } from '../components/ui/loading-block'
import { EmptyState } from '../components/ui/empty-state'
import { PageContent } from '../components/layout/PageContent'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import { listWorkLogs, type WorkLogRow } from '../lib/work-logs-api'

function formatWhen(value?: string | number | null): string {
  if (value == null || value === '' || value === 0) return '-'
  const d = new Date(typeof value === 'number' ? value : value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString()
}

function projectName(projects: ProjectRow[], projectId: string): string {
  return projects.find((p) => p.id === projectId)?.name ?? projectId.slice(0, 8)
}

export default function AdminRuns() {
  const { t } = useTranslation('nav')
  const { workLogId } = useParams<{ workLogId?: string }>()
  const isAdmin = useIsAdmin()
  const [runs, setRuns] = useState<WorkLogRow[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(!workLogId)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (workLogId) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const runRows = await listWorkLogs({ limit: 50 })
        if (cancelled) return
        setRuns(runRows)
      } catch (e) {
        if (!cancelled) {
          setRuns([])
          setError(e instanceof Error ? e.message : t('workforce.runs.loadError'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }

      try {
        const projectRows = await listProjects()
        if (!cancelled) setProjects(projectRows)
      } catch {
        if (!cancelled) setProjects([])
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [workLogId, t])

  if (!isAdmin) {
    return <Navigate to="/messages" replace />
  }

  return (
    <PageContent width="xl" className="space-y-4 py-1">
      <p className="text-sm text-text-muted">{t('workforce.runs.description')}</p>

      {workLogId ? (
        <div className="space-y-3">
          <Link to="/admin/runs" className="text-sm text-accent hover:underline">
            {t('workforce.runs.back')}
          </Link>
          <LiveWorkLog workLogId={workLogId} />
        </div>
      ) : loading ? (
        <LoadingBlock label={t('workforce.runs.loading')} />
      ) : error ? (
        <Card className="p-4">
          <p className="text-sm text-status-error">{error}</p>
        </Card>
      ) : runs.length === 0 ? (
        <EmptyState title={t('workforce.runs.empty')} />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('workforce.runs.columns.subject')}</TableHead>
                <TableHead>{t('workforce.runs.columns.project')}</TableHead>
                <TableHead>{t('workforce.runs.columns.status')}</TableHead>
                <TableHead>{t('workforce.runs.columns.started')}</TableHead>
                <TableHead>{t('workforce.runs.columns.tokens')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <Link
                      to={`/admin/runs/${run.id}`}
                      className="font-medium text-accent hover:underline"
                    >
                      {run.task_subject || t('workforce.runs.fallbackSubject')}
                    </Link>
                  </TableCell>
                  <TableCell className="text-text-muted">
                    {projectName(projects, run.project_id)}
                  </TableCell>
                  <TableCell>{run.status}</TableCell>
                  <TableCell className="text-text-muted">{formatWhen(run.started_at)}</TableCell>
                  <TableCell className="text-text-muted">{run.tokens_used ?? 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </PageContent>
  )
}
