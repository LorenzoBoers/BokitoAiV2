import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowUpRight,
  Bot,
  FolderKanban,
  MessageSquare,
  Plus,
} from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { EmptyState } from '../components/ui/empty-state'
import { LoadingBlock } from '../components/ui/loading-block'
import { Badge } from '../components/ui/badge'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import { listWorkLogs, type WorkLogRow } from '../lib/work-logs-api'
import { projectWorkforceRunUrl } from '../lib/workforce-run-urls'
import { listMessages, type MessageRow } from '../lib/messages-api'
import { ProjectRequiredPoBanner } from '../components/project/ProjectRequiredPoBanner'
import { useProjectHubNav } from '../context/ProjectHubNavContext'
import { formatWorkLogSubject } from '../lib/work-log-labels'
import { repoStatusLabel, repoStatusVariant } from '../lib/repo-status'

function formatWhen(value?: string | number | null): string {
  if (value == null || value === '' || value === 0) return '-'
  const d = new Date(typeof value === 'number' ? value : value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString()
}

function projectIdFromMessage(msg: MessageRow): string | null {
  if (typeof msg.project_id === 'string' && msg.project_id) return msg.project_id
  const fromPayload = msg.payload?.project_id
  return typeof fromPayload === 'string' ? fromPayload : null
}

function sortProjectsByRecency(rows: ProjectRow[]): ProjectRow[] {
  return [...rows].sort((a, b) => {
    const aTs = (a as ProjectRow & { updated_at?: string }).updated_at
    const bTs = (b as ProjectRow & { updated_at?: string }).updated_at
    if (aTs && bTs) return new Date(bTs).getTime() - new Date(aTs).getTime()
    return (a.name ?? '').localeCompare(b.name ?? '')
  })
}

export default function ProjectHubOverview() {
  const { t } = useTranslation('nav')
  const { selectedProjectId, poAgent, workstreamsLoading, projects: hubProjects } = useProjectHubNav()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [runs, setRuns] = useState<WorkLogRow[]>([])
  const [pending, setPending] = useState<MessageRow[]>([])
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [loadingRuns, setLoadingRuns] = useState(true)
  const [loadingPending, setLoadingPending] = useState(true)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [runsError, setRunsError] = useState<string | null>(null)
  const [pendingError, setPendingError] = useState<string | null>(null)

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true)
    setProjectsError(null)
    try {
      const rows = await listProjects()
      setProjects(sortProjectsByRecency(rows))
    } catch (err) {
      setProjects([])
      setProjectsError(err instanceof Error ? err.message : 'Could not load projects.')
    } finally {
      setLoadingProjects(false)
    }
  }, [])

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true)
    setRunsError(null)
    try {
      setRuns(await listWorkLogs({ limit: 50 }))
    } catch (err) {
      setRuns([])
      setRunsError(err instanceof Error ? err.message : 'Could not load runs.')
    } finally {
      setLoadingRuns(false)
    }
  }, [])

  const loadPending = useCallback(async () => {
    setLoadingPending(true)
    setPendingError(null)
    try {
      const rows = await listMessages({ status: 'awaiting_human' })
      setPending(rows.slice(0, 5))
    } catch (err) {
      setPending([])
      setPendingError(err instanceof Error ? err.message : 'Could not load decisions.')
    } finally {
      setLoadingPending(false)
    }
  }, [])

  useEffect(() => {
    void loadProjects()
    void loadRuns()
    void loadPending()
  }, [loadProjects, loadRuns, loadPending])

  const topProjects = useMemo(() => projects.slice(0, 5), [projects])
  const selectedProject = useMemo(
    () => hubProjects.find((project) => project.id === selectedProjectId) ?? null,
    [hubProjects, selectedProjectId],
  )
  const needsOrchestratorSetup =
    Boolean(selectedProjectId) &&
    !workstreamsLoading &&
    !poAgent &&
    !selectedProject?.po_agent_id

  return (
    <div className="space-y-5">
      {needsOrchestratorSetup ? (
        <ProjectRequiredPoBanner projectId={selectedProjectId!} />
      ) : null}
      <section className="grid gap-3 sm:grid-cols-3">
        <Button asChild variant="secondary" size="sm" className="h-auto justify-start gap-2 py-3">
          <Link to="/projects/new">
            <Plus size={16} />
            {t('projectHub.quick.newProject')}
          </Link>
        </Button>
        <Button asChild variant="secondary" size="sm" className="h-auto justify-start gap-2 py-3">
          <Link to="/projects/docs">
            <FolderKanban size={16} />
            {t('projectHub.quick.openDocs')}
          </Link>
        </Button>
        <Button asChild variant="secondary" size="sm" className="h-auto justify-start gap-2 py-3">
          <Link to="/projects/communication">
            <MessageSquare size={16} />
            {t('projectHub.quick.openCommunication')}
          </Link>
        </Button>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base font-semibold">
              {t('projectHub.overview.activeProjectsTitle')}
            </CardTitle>
            {topProjects.length > 0 ? (
              <Button asChild variant="ghost" size="sm">
                <Link to={`/project/${topProjects[0].id}/overview`}>
                  {t('projectHub.overview.openFirstProject')}
                </Link>
              </Button>
            ) : null}
          </CardHeader>
          <CardContent>
            {loadingProjects ? (
              <LoadingBlock label={t('project.list.loading')} />
            ) : projectsError ? (
              <p className="text-sm text-destructive">{projectsError}</p>
            ) : topProjects.length === 0 ? (
              <EmptyState
                icon={FolderKanban}
                title={t('projectHub.overview.emptyProjects')}
                action={
                  <Button asChild size="sm">
                    <Link to="/projects/new">{t('project.list.create')}</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="space-y-2">
                {topProjects.map((p) => (
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
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base font-semibold">
              {t('projectHub.overview.pendingDecisionsTitle')}
            </CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/projects/communication">{t('projectHub.overview.viewAllDecisions')}</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {loadingPending ? (
              <LoadingBlock label={t('project.messages.loading')} />
            ) : pendingError ? (
              <p className="text-sm text-destructive">{pendingError}</p>
            ) : pending.length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title={t('projectHub.overview.emptyDecisions')}
              />
            ) : (
              <ul className="space-y-2">
                {pending.map((msg) => {
                  const projectId = projectIdFromMessage(msg)
                  const href = projectId
                    ? `/project/${projectId}/communication`
                    : '/projects/communication'
                  return (
                    <li key={msg.id}>
                      <Link
                        to={href}
                        className="group block rounded-lg border border-border/70 px-3 py-2 transition-colors hover:bg-bg-hover/50"
                      >
                        {msg.subject ? (
                          <p className="truncate text-sm font-medium text-text-primary">
                            {msg.subject}
                          </p>
                        ) : null}
                        <p className="mt-1 line-clamp-2 text-sm text-text-secondary">{msg.body}</p>
                        <p className="mt-1 text-xs text-text-muted">
                          {msg.created_at ? formatWhen(msg.created_at) : null}
                          {msg.message_type ? (
                            <span className="ml-2 capitalize">
                              {msg.message_type.replace(/_/g, ' ')}
                            </span>
                          ) : null}
                        </p>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">
              {t('projectHub.overview.recentRunsTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingRuns ? (
              <LoadingBlock label={t('workforce.runs.loading')} />
            ) : runsError ? (
              <p className="text-sm text-destructive">{runsError}</p>
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
                        {formatWorkLogSubject(run.task_subject, t('workforce.runs.fallbackSubject'))}
                      </span>
                      <span className="shrink-0 text-xs text-text-muted">
                        {formatWhen(run.started_at)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
