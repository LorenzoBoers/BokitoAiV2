import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, FolderKanban } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { EmptyState } from '../components/ui/empty-state'
import { LoadingBlock } from '../components/ui/loading-block'
import { PageContent } from '../components/layout/PageContent'
import { PageIntro } from '../components/layout/PageIntro'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import { repoStatusLabel, repoStatusVariant } from '../lib/repo-status'

export default function Projects() {
  const { t } = useTranslation('nav')
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <PageContent width="xl" className="space-y-6">
      <PageIntro
        description={t('project.list.description')}
        actions={
          <Button asChild size="sm">
            <Link to="/projects/new">{t('project.list.newProject')}</Link>
          </Button>
        }
      />
      {loading ? (
        <LoadingBlock label={t('project.list.loading')} />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={t('project.list.empty')}
          action={
            <Button asChild size="sm">
              <Link to="/projects/new">{t('project.list.create')}</Link>
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                to={`/project/${p.id}/overview`}
                className="group flex h-full flex-col rounded-2xl border border-border/80 bg-bg-surface/95 p-5 transition-colors hover:border-border hover:bg-bg-hover/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="truncate text-base font-semibold text-text-heading">
                    {p.name}
                  </span>
                  <ArrowUpRight
                    size={14}
                    className="shrink-0 text-text-muted transition-colors group-hover:text-text-primary"
                  />
                </div>
                {p.autonomous_scope ? (
                  <p className="mt-2 line-clamp-3 text-sm text-text-muted">
                    {p.autonomous_scope}
                  </p>
                ) : p.description ? (
                  <p className="mt-2 line-clamp-3 text-sm text-text-muted">{p.description}</p>
                ) : null}
                <div className="mt-4 flex items-center gap-2">
                  <Badge variant={repoStatusVariant(p)}>{repoStatusLabel(p)}</Badge>
                  {p.github_repo_full_name ? (
                    <span className="truncate text-xs text-text-muted">
                      {p.github_repo_full_name}
                    </span>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageContent>
  )
}
