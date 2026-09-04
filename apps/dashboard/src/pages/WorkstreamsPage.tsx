import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ChevronRight, Loader2, Plus, Workflow } from 'lucide-react'
import { PageContent } from '../components/layout/PageContent'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { TableRowsSkeleton } from '../components/ui/skeleton'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { formatAppDateTime } from '../lib/app-locale'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import {
  createWorkstream,
  listWorkstreamRuns,
  listWorkstreams,
  type WorkstreamRow,
  type WorkstreamRunRow,
} from '../lib/workstreams-api'
import { runStatusBadgeVariant, workstreamRunPath, workstreamPath } from '../lib/workstream-ui'
import { CaseTypesCard } from '../components/workstreams/CaseTypesCard'

export default function WorkstreamsPage() {
  const { t, i18n } = useTranslation('nav')
  const isAdmin = useIsAdmin()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workstreams, setWorkstreams] = useState<WorkstreamRow[]>([])
  const [runs, setRuns] = useState<WorkstreamRunRow[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [wsRows, runRows, projectRows] = await Promise.all([
        listWorkstreams(),
        listWorkstreamRuns({ limit: 25 }).catch(() => []),
        listProjects().catch(() => []),
      ])
      setWorkstreams(wsRows)
      setRuns(runRows)
      setProjects(projectRows)
    } catch (err) {
      setError(formatApiErrorMessage(err, t('workstreamsPage.loadError')))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const projectNames = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  )

  const create = async () => {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      await createWorkstream({ name })
      setNewName('')
      toast.success(t('workstreamsPage.created'))
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('workstreamsPage.createError')))
    } finally {
      setCreating(false)
    }
  }

  return (
    <PageContent width="xl" className="space-y-4 py-1">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-text-heading">
            <Workflow size={22} className="text-text-muted" />
            {t('workstreamsPage.title')}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">{t('workstreamsPage.subtitle')}</p>
        </div>
        {isAdmin ? (
          <div className="flex items-center gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create()
              }}
              placeholder={t('workstreamsPage.newPlaceholder')}
              className="h-9 w-56 text-sm"
            />
            <Button type="button" size="sm" disabled={creating || !newName.trim()} onClick={() => void create()}>
              {creating ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Plus size={13} className="mr-1" />}
              {t('workstreamsPage.create')}
            </Button>
          </div>
        ) : null}
      </header>

      {error ? <ApiErrorBanner message={error} onRetry={() => void load()} /> : null}

      {loading ? (
        <TableRowsSkeleton rows={6} />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('workstreamsPage.allWorkstreams')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {workstreams.length === 0 ? (
                <p className="text-sm text-text-muted">{t('workstreamsPage.empty')}</p>
              ) : (
                workstreams.map((ws) => (
                  <Link
                    key={ws.id}
                    to={workstreamPath(ws.id)}
                    className="row-interactive flex items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2.5 text-sm transition-colors hover:border-border hover:bg-bg-muted/40"
                  >
                    <span className="min-w-0">
                      <span
                        className={
                          ws.enabled
                            ? 'block truncate font-medium text-text-heading'
                            : 'block truncate font-medium text-text-muted opacity-70'
                        }
                      >
                        {ws.name}
                      </span>
                      <span className="block truncate text-xs text-text-muted">
                        {t('workstreamsPage.stepCount', { count: ws.steps_count ?? 0 })}
                        {ws.project_id && projectNames.get(ws.project_id)
                          ? ` · ${projectNames.get(ws.project_id)}`
                          : ''}
                        {ws.description ? ` · ${ws.description}` : ''}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {ws.is_default ? (
                        <Badge variant="outline" className="text-[10px]">
                          {t('workstreamsPage.default')}
                        </Badge>
                      ) : null}
                      {!ws.enabled ? (
                        <Badge variant="outline" className="border-border text-[10px] text-text-muted">
                          {t('workstreamsPage.paused')}
                        </Badge>
                      ) : null}
                      <ChevronRight size={14} className="text-text-muted" />
                    </span>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          {isAdmin ? <CaseTypesCard /> : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('workstreamsPage.recentRuns')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {runs.length === 0 ? (
                <p className="text-sm text-text-muted">{t('workstreamsPage.noRuns')}</p>
              ) : (
                runs.map((run) => (
                  <Link
                    key={run.id}
                    to={workstreamRunPath(run.id)}
                    className="row-interactive flex items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2 text-sm transition-colors hover:border-border hover:bg-bg-muted/40"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-text-heading">
                        {run.workstream_name || t('workstreamsPage.runFallbackTitle')}
                      </span>
                      <span className="block truncate text-xs text-text-muted">
                        {run.started_at
                          ? formatAppDateTime(new Date(run.started_at), i18n.language)
                          : ''}
                        {run.summary ? ` · ${run.summary}` : run.input_text ? ` · ${run.input_text}` : ''}
                      </span>
                    </span>
                    <Badge variant={runStatusBadgeVariant(run.status)} className="shrink-0">
                      {t(`workstreamsPage.status.${run.status}`, { defaultValue: run.status })}
                    </Badge>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </PageContent>
  )
}
