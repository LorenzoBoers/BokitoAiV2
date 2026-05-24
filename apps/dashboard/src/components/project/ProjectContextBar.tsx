import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight } from 'lucide-react'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { useProjectContext } from '../../context/ProjectContext'
import { repoStatusLabel, repoStatusVariant } from '../../lib/repo-status'

/**
 * Compact project context strip rendered above the main content area.
 * Replaces the heavy `ProjectHeader` card on individual pages: shows
 * project name, repo status, and primary actions inline. The full
 * `autonomous_scope` lives on the Settings page; we only show a short
 * one-liner here with a link to view details.
 */
export function ProjectContextBar() {
  const { t } = useTranslation('nav')
  const { project, projectId, loading } = useProjectContext()

  if (loading) {
    return (
      <div className="mb-4 h-12 animate-pulse rounded-xl border border-border/70 bg-bg-surface/60" />
    )
  }

  if (!project) {
    return (
      <div className="mb-4 rounded-xl border border-border/70 bg-bg-surface px-4 py-3 text-sm text-text-muted">
        {t('project.contextBar.notFound', { defaultValue: 'Project not found.' })}
      </div>
    )
  }

  const statusLabel = repoStatusLabel(project)
  const statusVariant = repoStatusVariant(project)
  const scopeOneLine =
    project.autonomous_scope?.replace(/\s+/g, ' ').trim() ?? ''

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
        <Button asChild size="sm" variant="secondary">
          <Link to={`/project/${projectId}/request`}>
            {t('project.contextBar.request', { defaultValue: 'Request a change' })}
          </Link>
        </Button>
        {!project.github_repo_full_name ? (
          <Button asChild size="sm">
            <Link to={`/project/${projectId}/settings`}>
              {t('project.contextBar.connect', { defaultValue: 'Connect code' })}
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  )
}
