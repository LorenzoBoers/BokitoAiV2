import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowUpRight,
  Bot,
  FolderKanban,
  Inbox,
  Link2,
  MessageSquare,
  Plus,
  Sparkles,
} from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { EmptyState } from '../components/ui/empty-state'
import { LoadingBlock } from '../components/ui/loading-block'
import { PageContent } from '../components/layout/PageContent'
import { ASSISTENT_DEFAULT_PATH } from '../lib/assistent-settings-path'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import { listWorkLogs, type WorkLogRow } from '../lib/work-logs-api'
import { projectWorkforceRunUrl } from '../lib/workforce-run-urls'
import { repoStatusLabel, repoStatusVariant } from '../lib/repo-status'
import { Badge } from '../components/ui/badge'

function formatWhen(value?: string | number | null): string {
  if (value == null || value === '' || value === 0) return '-'
  const d = new Date(typeof value === 'number' ? value : value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString()
}

export default function HomeDashboard() {
  const { t } = useTranslation('nav')
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [runs, setRuns] = useState<WorkLogRow[]>([])
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [loadingRuns, setLoadingRuns] = useState(true)

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]))
      .finally(() => setLoadingProjects(false))
  }, [])

  useEffect(() => {
    listWorkLogs({ limit: 5 })
      .then(setRuns)
      .catch(() => setRuns([]))
      .finally(() => setLoadingRuns(false))
  }, [])

  const recentProjects = projects.slice(0, 5)

  return (
    <PageContent width="xl" className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-text-heading">{t('home.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('home.description')}</p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Button asChild variant="secondary" size="sm" className="h-auto justify-start gap-2 py-3">
          <Link to="/projects/new">
            <Plus size={16} />
            {t('home.quick.newProject')}
          </Link>
        </Button>
        <Button asChild variant="secondary" size="sm" className="h-auto justify-start gap-2 py-3">
          <Link to="/support/inbox/all">
            <Inbox size={16} />
            {t('home.quick.openInbox')}
          </Link>
        </Button>
        <Button asChild variant="secondary" size="sm" className="h-auto justify-start gap-2 py-3">
          <Link to="/integrations/marketplace">
            <Link2 size={16} />
            {t('home.quick.integrations')}
          </Link>
        </Button>
        <Button asChild variant="secondary" size="sm" className="h-auto justify-start gap-2 py-3">
          <Link to={ASSISTENT_DEFAULT_PATH}>
            <Sparkles size={16} />
            {t('home.quick.assistent')}
          </Link>
        </Button>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base font-semibold">{t('home.recentProjects.title')}</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/projects">{t('home.recentProjects.viewAll')}</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {loadingProjects ? (
              <LoadingBlock label={t('project.list.loading')} />
            ) : recentProjects.length === 0 ? (
              <EmptyState
                icon={FolderKanban}
                title={t('home.recentProjects.empty')}
                action={
                  <Button asChild size="sm">
                    <Link to="/projects/new">{t('project.list.create')}</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="space-y-2">
                {recentProjects.map((p) => (
                  <li key={p.id}>
                    <Link
                      to={`/project/${p.id}/overview`}
                      className="group flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2 transition-colors hover:bg-bg-hover/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-text-heading">{p.name}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge variant={repoStatusVariant(p)} className="text-[10px]">
                            {repoStatusLabel(p)}
                          </Badge>
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

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">{t('home.inbox.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-text-muted">{t('home.inbox.description')}</p>
            <Button asChild variant="secondary" size="sm" className="w-full justify-start gap-2">
              <Link to="/support/inbox/unassigned">
                <MessageSquare size={14} />
                {t('support.links.unassigned')}
              </Link>
            </Button>
            <Button asChild variant="secondary" size="sm" className="w-full justify-start gap-2">
              <Link to="/support/inbox/my">
                <Inbox size={14} />
                {t('support.links.myInbox')}
              </Link>
            </Button>
            <Button asChild variant="secondary" size="sm" className="w-full justify-start gap-2">
              <Link to="/support/inbox/all">
                <MessageSquare size={14} />
                {t('support.links.allMessages')}
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base font-semibold">{t('home.agentRuns.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingRuns ? (
              <LoadingBlock label={t('workforce.runs.loading')} />
            ) : runs.length === 0 ? (
              <EmptyState icon={Bot} title={t('home.agentRuns.empty')} />
            ) : (
              <ul className="divide-y divide-border/60">
                {runs.map((run) => (
                  <li key={run.id}>
                    <Link
                      to={projectWorkforceRunUrl(run.project_id, run.id)}
                      className="flex items-center justify-between gap-3 py-2 text-sm hover:text-accent"
                    >
                      <span className="truncate font-medium text-text-heading">
                        {run.task_subject?.trim() || t('workforce.runs.fallbackSubject')}
                      </span>
                      <span className="shrink-0 text-xs text-text-muted">{formatWhen(run.started_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContent>
  )
}
