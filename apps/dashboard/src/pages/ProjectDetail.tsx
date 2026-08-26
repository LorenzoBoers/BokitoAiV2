import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Bot,
  Copy,
  FileText,
  GitBranch,
  Loader2,
  MessageSquare,
  Play,
  Plus,
  Trash2,
  Wallet,
  Workflow,
} from 'lucide-react'
import { toast } from 'sonner'
import { AGENDA_AUTOMATIONS_PATH } from '../lib/navigation'
import { PageContent } from '../components/layout/PageContent'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import ConfirmDeleteDialog from '../components/ui/ConfirmDeleteDialog'
import { LoadingBlock } from '../components/ui/loading-block'
import { ProjectAgentsSection } from '../components/projects/ProjectAgentsSection'
import { ProjectBudgetBar } from '../components/projects/ProjectBudgetBar'
import { ProjectOrchestratorSection } from '../components/projects/ProjectOrchestratorSection'
import { ProjectRepoSection } from '../components/projects/ProjectRepoSection'
import { WorkLogsTable } from '../components/workforce/WorkLogsTable'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { useAuth } from '../context/AuthContext'
import { listAgents } from '../lib/agents-api'
import { workLogRunsPath } from '../lib/agenda-thread'
import { listThreads, type InboxThread } from '../lib/inbox-api'
import { inboxPath } from '../lib/messages-paths'
import { flowStatusLabel } from '../lib/status-labels'
import {
  deleteProject,
  getProject,
  getProjectBudget,
  patchProject,
  type ProjectBudgetResponse,
  type ProjectRow,
} from '../lib/projects-api'
import { listWorkLogs, type WorkLogRow } from '../lib/work-logs-api'
import { workLogDetailUrl } from '../lib/workforce-run-urls'
import {
  createProjectWorkstream,
  listProjectWorkstreams,
  runProjectWorkstream,
  type ProjectWorkstreamRow,
} from '../lib/workstreams-api'

async function copyText(value: string, copied: string, copyError: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(copied)
  } catch {
    toast.error(copyError)
  }
}

export default function ProjectDetail() {
  const { t } = useTranslation('nav')
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()
  const { token } = useAuth()

  const [project, setProject] = useState<ProjectRow | null>(null)
  const [budget, setBudget] = useState<ProjectBudgetResponse | null>(null)
  const [workstreams, setWorkstreams] = useState<ProjectWorkstreamRow[]>([])
  const [runs, setRuns] = useState<WorkLogRow[]>([])
  const [internalThreads, setInternalThreads] = useState<InboxThread[]>([])
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [newStreamName, setNewStreamName] = useState('')
  const [creatingStream, setCreatingStream] = useState(false)
  const [runningStreamId, setRunningStreamId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const row = await getProject(projectId)
      setProject(row)
      setName(row.name)
      setDescription(row.description ?? '')
      // Secondary data may fail independently without blocking the page.
      const [budgetResult, streamsResult, runsResult, agentsResult, threadsResult] = await Promise.allSettled([
        getProjectBudget(projectId),
        listProjectWorkstreams(projectId),
        listWorkLogs({ project_id: projectId, limit: 10 }),
        listAgents(),
        token ? listThreads(token, { folder: 'internal', perPage: 80 }) : Promise.reject(new Error('signed out')),
      ])
      setBudget(budgetResult.status === 'fulfilled' ? budgetResult.value : null)
      setWorkstreams(streamsResult.status === 'fulfilled' ? streamsResult.value.items : [])
      setRuns(runsResult.status === 'fulfilled' ? runsResult.value : [])
      setInternalThreads(threadsResult.status === 'fulfilled' ? threadsResult.value.items : [])
      setAgents(
        agentsResult.status === 'fulfilled'
          ? agentsResult.value.map((a) => ({ id: a.id, name: a.name }))
          : [],
      )
    } catch (err) {
      setError(formatApiErrorMessage(err, t('projects.detail.loadError')))
    } finally {
      setLoading(false)
    }
  }, [projectId, t, token])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = useMemo(() => {
    if (!project) return false
    return name.trim() !== project.name || description.trim() !== (project.description ?? '')
  }, [project, name, description])

  const saveAbout = async () => {
    if (!project || !name.trim()) return
    setSaving(true)
    try {
      const updated = await patchProject(project.id, {
        name: name.trim(),
        description: description.trim() || undefined,
      })
      setProject(updated)
      setName(updated.name)
      setDescription(updated.description ?? '')
      toast.success(t('projects.detail.saved'))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.detail.saveError')))
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!project) return
    setDeleting(true)
    try {
      await deleteProject(project.id, project.name)
      toast.success(t('projects.detail.deleted'))
      navigate('/projects')
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.detail.deleteError')))
    } finally {
      setDeleting(false)
    }
  }

  if (!isAdmin) {
    return <Navigate to={inboxPath('all')} replace />
  }

  const threadsHref = project
    ? `${inboxPath('all')}?project_id=${encodeURIComponent(project.id)}`
    : inboxPath('all')

  return (
    <PageContent width="xl" className="space-y-4 py-1">
      <Link
        to="/projects"
        className="inline-flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-text-primary"
      >
        <ArrowLeft size={14} />
        {t('projects.detail.back')}
      </Link>

      {loading ? (
        <LoadingBlock label={t('projects.detail.loading')} />
      ) : error || !project ? (
        <ApiErrorBanner message={error ?? t('projects.detail.notFound')} onRetry={() => void load()} />
      ) : (
        <>
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold text-text-heading">{project.name}</h1>
                <Badge variant="outline">{project.slug}</Badge>
              </div>
              {project.description ? (
                <p className="mt-1 max-w-2xl text-sm text-text-muted">{project.description}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button asChild type="button" size="sm" variant="outline">
                <Link to={threadsHref}>
                  <MessageSquare size={14} className="mr-1" />
                  {t('projects.detail.viewThreads')}
                </Link>
              </Button>
              <Button asChild type="button" size="sm" variant="outline">
                <Link to="/knowledge">
                  <FileText size={14} className="mr-1" />
                  {t('projects.detail.openKnowledge')}
                </Link>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-status-error hover:text-status-error"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 size={14} className="mr-1" />
                {t('projects.detail.delete')}
              </Button>
            </div>
          </header>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Bot size={16} className="text-text-muted" />
                  {t('projects.detail.orchestration')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <ProjectOrchestratorSection project={project} agents={agents} onChanged={load} />
                <ProjectAgentsSection projectId={project.id} agents={agents} />
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs text-text-muted">
                    <Workflow size={12} />
                    {t('projects.detail.flows')}
                  </Label>
                  {workstreams.length === 0 ? (
                    <p className="text-sm text-text-muted">
                      {t('projects.detail.noFlows')}{' '}
                      <Link to={AGENDA_AUTOMATIONS_PATH} className="text-accent hover:underline">
                        {t('projects.detail.addOnAgenda')}
                      </Link>
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {workstreams.map((stream) => (
                        <li
                          key={stream.id}
                          className="flex items-center justify-between gap-2 rounded-md border border-border/50 px-2.5 py-1.5"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-text-primary">{stream.name}</span>
                            <span className="block text-[11px] text-text-muted">
                              {stream.steps_count > 0 ? (
                                t('projects.detail.stepCount', { count: stream.steps_count })
                              ) : (
                                <>
                                  {t('projects.detail.noSteps')}{' '}
                                  <Link to={AGENDA_AUTOMATIONS_PATH} className="text-accent hover:underline">
                                    {t('projects.detail.addOnAgenda')}
                                  </Link>
                                </>
                              )}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <Badge
                              variant={stream.enabled ? 'secondary' : 'outline'}
                              className="px-1.5 py-0 text-[10px]"
                            >
                              {flowStatusLabel(stream.enabled, t)}
                            </Badge>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1.5"
                              disabled={runningStreamId !== null || stream.steps_count === 0}
                              title={
                                stream.steps_count === 0
                                  ? t('projects.detail.addStepsFirst')
                                  : t('projects.detail.runFlow')
                              }
                              onClick={async () => {
                                setRunningStreamId(stream.id)
                                try {
                                  await runProjectWorkstream(stream.id)
                                  toast.success(t('projects.detail.started', { name: stream.name }))
                                  void load()
                                } catch (err) {
                                  toast.error(
                                    err instanceof Error ? err.message : t('projects.detail.startError'),
                                  )
                                } finally {
                                  setRunningStreamId(null)
                                }
                              }}
                            >
                              {runningStreamId === stream.id ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Play size={12} />
                              )}
                            </Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {isAdmin ? (
                    <div className="flex gap-2 pt-1">
                      <Input
                        value={newStreamName}
                        onChange={(e) => setNewStreamName(e.target.value)}
                        placeholder={t('projects.detail.newFlowName')}
                        className="h-8 text-sm"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={creatingStream || !newStreamName.trim()}
                        onClick={async () => {
                          if (!projectId) return
                          setCreatingStream(true)
                          try {
                            await createProjectWorkstream(projectId, { name: newStreamName.trim() })
                            setNewStreamName('')
                            toast.success(
                              <span>
                                {t('projects.detail.created')}{' '}
                                <Link to={AGENDA_AUTOMATIONS_PATH} className="font-medium underline">
                                  {t('projects.detail.addOnAgenda')}
                                </Link>
                              </span>,
                            )
                            void load()
                          } catch (err) {
                            toast.error(
                              err instanceof Error ? err.message : t('projects.detail.createError'),
                            )
                          } finally {
                            setCreatingStream(false)
                          }
                        }}
                      >
                        {creatingStream ? (
                          <Loader2 size={13} className="mr-1 animate-spin" />
                        ) : (
                          <Plus size={13} className="mr-1" />
                        )}
                        {t('projects.detail.add')}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <GitBranch size={16} className="text-text-muted" />
                  Repository
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ProjectRepoSection project={project} onChanged={load} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wallet size={16} className="text-text-muted" />
                  {t('projects.detail.budgetTitle')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {budget ? (
                  <>
                    <ProjectBudgetBar budget={budget} />
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-text-muted">{t('projects.detail.remainingToday')}</p>
                        <p className="font-medium text-text-heading">
                          {budget.remaining_today.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-text-muted">{t('projects.detail.remainingHour')}</p>
                        <p className="font-medium text-text-heading">
                          {budget.remaining_hour.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-text-muted">{t('projects.detail.noBudget')}</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('projects.detail.about')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="project-name">{t('projects.detail.name')}</Label>
                  <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="project-description">{t('projects.detail.description')}</Label>
                  <Input
                    id="project-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('projects.detail.descriptionPlaceholder')}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void copyText(
                        project.id,
                        t('projects.detail.copied', { label: t('projects.detail.copyId') }),
                        t('projects.detail.copyError', { label: t('projects.detail.copyId') }),
                      )
                    }
                    className="inline-flex items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-text-primary"
                    title={project.id}
                  >
                    <Copy size={12} />
                    {t('projects.detail.copyId')}
                  </button>
                  <Button type="button" size="sm" disabled={!dirty || saving || !name.trim()} onClick={() => void saveAbout()}>
                    {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                    {t('projects.detail.save')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-text-heading">{t('projects.detail.activity')}</h2>
              <Button asChild type="button" size="sm" variant="ghost">
                <Link to={threadsHref}>{t('projects.detail.openThreads')}</Link>
              </Button>
            </div>
            {runs.length === 0 ? (
              <Card className="p-4">
                <p className="text-sm text-text-muted">{t('projects.detail.noRuns')}</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <Link to={AGENDA_AUTOMATIONS_PATH} className="text-sm font-medium text-accent hover:underline">
                    {t('projects.detail.scheduleRun')}
                  </Link>
                  <Link to={threadsHref} className="text-sm font-medium text-accent hover:underline">
                    {t('projects.detail.openThreads')}
                  </Link>
                </div>
              </Card>
            ) : (
              <WorkLogsTable
                runs={runs}
                projects={[project]}
                runTo={(run) =>
                  workLogRunsPath(
                    run,
                    internalThreads.map((row) => ({
                      id: String(row.id),
                      emailSubject: row.emailSubject,
                      lastMessageAt: row.lastMessageAt,
                    })),
                    workLogDetailUrl(run),
                  )
                }
                showProjectColumn={false}
              />
            )}
          </section>
        </>
      )}

      {deleteOpen && project ? (
        <ConfirmDeleteDialog
          title={t('projects.detail.deleteTitle')}
          itemLabel={t('projects.detail.deleteItem')}
          itemName={project.name}
          impactText={t('projects.detail.deleteImpact')}
          isDeleting={deleting}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </PageContent>
  )
}
