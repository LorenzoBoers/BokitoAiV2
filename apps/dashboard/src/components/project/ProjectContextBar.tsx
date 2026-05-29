import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight } from 'lucide-react'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { useProjectContext } from '../../context/ProjectContext'
import { useOptionalProjectHubNav } from '../../context/ProjectHubNavContext'
import { formatWorkerStatusLabel } from '../../lib/project-worker-status'
import { repoStatusLabel, repoStatusVariant } from '../../lib/repo-status'
import { WorkerStatusDot } from '../workers/WorkerStatusDot'
import type { ProjectWorkstreamRow } from '../../lib/workstreams-api'

function streamStatusVariant(
  status: ProjectWorkstreamRow['status'],
): 'secondary' | 'success' | 'warning' {
  if (status === 'active') return 'success'
  if (status === 'paused') return 'warning'
  return 'secondary'
}

/**
 * Compact context strip above project pages. On the workstream overview route
 * shows the active stream name and status; elsewhere shows project context.
 */
export function ProjectContextBar() {
  const { t, i18n } = useTranslation('nav')
  const { pathname } = useLocation()
  const [searchParams] = useSearchParams()
  const { project, projectId, loading, error, refresh } = useProjectContext()
  const hubNav = useOptionalProjectHubNav()

  const isWorkstreamOverview = /^\/project\/[^/]+\/overview$/.test(pathname)

  if (loading) {
    return (
      <div className="mb-4 h-12 animate-pulse rounded-xl border border-border/70 bg-bg-surface/60" />
    )
  }

  if (!project) {
    return (
      <div className="mb-4 rounded-xl border border-border/70 bg-bg-surface px-4 py-3 text-sm text-text-muted">
        {error ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-status-error">{error}</span>
            <Button size="sm" variant="secondary" onClick={() => void refresh()}>
              {t('common.retry', { defaultValue: 'Retry' })}
            </Button>
          </div>
        ) : (
          t('project.contextBar.notFound', { defaultValue: 'Project not found.' })
        )}
      </div>
    )
  }

  if (isWorkstreamOverview) {
    const streamSlug = searchParams.get('stream') ?? hubNav?.workstreams[0]?.slug ?? null
    const stream =
      hubNav?.workstreams.find((row) => row.slug === streamSlug) ?? hubNav?.workstreams[0] ?? null
    const workerStatus = hubNav?.getWorkerStatus(projectId) ?? null
    const workerLabel = workerStatus
      ? formatWorkerStatusLabel(workerStatus, t, i18n.language)
      : hubNav?.statusLoading
        ? t('backgroundWorkers.status.loading')
        : null

    return (
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-bg-surface/95 px-4 py-2.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
          {stream ? (
            <>
              <h1 className="truncate text-[15px] font-semibold text-text-heading" title={stream.name}>
                {stream.name}
              </h1>
              <Badge variant={streamStatusVariant(stream.status)} className="shrink-0 capitalize">
                {stream.status}
              </Badge>
            </>
          ) : (
            <h1 className="text-[15px] font-semibold text-text-heading">
              {t('project.overview.title', { defaultValue: 'Workstreams' })}
            </h1>
          )}
          {workerStatus && workerLabel ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
              <WorkerStatusDot primary={workerStatus.primary} badgeCount={workerStatus.badgeCount} />
              <span>{workerLabel}</span>
            </span>
          ) : null}
          {stream?.trigger_text ? (
            <p className="hidden min-w-0 flex-1 truncate text-xs text-text-muted lg:block">
              {stream.trigger_text}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link to={`/project/${projectId}/settings`}>
              {t('project.contextBar.details', { defaultValue: 'Details' })}
              <ArrowUpRight size={12} />
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  const statusLabel = repoStatusLabel(project)
  const statusVariant = repoStatusVariant(project)
  const scopeOneLine = project.autonomous_scope?.replace(/\s+/g, ' ').trim() ?? ''

  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-bg-surface/95 px-4 py-2.5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Link
          to={`/project/${projectId}/overview`}
          className="truncate text-[15px] font-semibold text-text-heading hover:text-accent"
          title={project.name}
        >
          {project.name}
        </Link>
        <Badge variant={statusVariant} className="shrink-0">
          {statusLabel}
        </Badge>
        {scopeOneLine ? (
          <p className="hidden min-w-0 flex-1 truncate text-xs text-text-muted md:block">
            {scopeOneLine}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button asChild size="sm" variant="ghost">
          <Link to={`/project/${projectId}/settings`}>
            {t('project.contextBar.details', { defaultValue: 'Details' })}
            <ArrowUpRight size={12} />
          </Link>
        </Button>
      </div>
    </div>
  )
}
