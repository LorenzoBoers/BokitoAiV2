import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Bot,
  Copy,
  FileText,
  GitBranch,
  Loader2,
  MessageSquare,
  RefreshCw,
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
import { Switch } from '../components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import ConfirmDeleteDialog from '../components/ui/ConfirmDeleteDialog'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { ProjectAgentsSection } from '../components/projects/ProjectAgentsSection'
import type { AgentVisualFields } from '../components/ui/AgentOptionRow'
import { ProjectBudgetBar } from '../components/projects/ProjectBudgetBar'
import { ProjectDocs } from '../components/projects/ProjectDocs'
import { ProjectOrchestratorSection } from '../components/projects/ProjectOrchestratorSection'
import { ProjectQueue } from '../components/projects/ProjectQueue'
import { ProjectRepoSection } from '../components/projects/ProjectRepoSection'
import { ProjectResourcesSection } from '../components/projects/ProjectResourcesSection'
import { WorkLogsTable } from '../components/workforce/WorkLogsTable'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard'
import { useAuth } from '../context/AuthContext'
import { formatAppTime } from '../lib/app-locale'
import { formatAppNumber } from '../lib/app-number'
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
import { listWorkstreams, type WorkstreamRow } from '../lib/workstreams-api'
import { workstreamPath } from '../lib/workstream-ui'
import { CaseBindingsCard } from '../components/workstreams/CaseBindingsCard'

async function copyText(value: string, copied: string, copyError: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(copied)
  } catch {
    toast.error(copyError)
  }
}

export default function ProjectDetail() {
  const { t, i18n } = useTranslation('nav')
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()
  const { token } = useAuth()

  const [project, setProject] = useState<ProjectRow | null>(null)
  const [budget, setBudget] = useState<ProjectBudgetResponse | null>(null)
  const [workstreams, setWorkstreams] = useState<WorkstreamRow[]>([])
  const [runs, setRuns] = useState<WorkLogRow[]>([])
  const [internalThreads, setInternalThreads] = useState<InboxThread[]>([])
  const [agents, setAgents] = useState<AgentVisualFields[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [togglingAutonomy, setTogglingAutonomy] = useState(false)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)

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
        listWorkstreams({ projectId }),
        listWorkLogs({ project_id: projectId, limit: 10 }),
        listAgents(),
        token ? listThreads(token, { folder: 'internal', perPage: 80 }) : Promise.reject(new Error('signed out')),
      ])
      setBudget(budgetResult.status === 'fulfilled' ? budgetResult.value : null)
      setWorkstreams(streamsResult.status === 'fulfilled' ? streamsResult.value : [])
      setRuns(runsResult.status === 'fulfilled' ? runsResult.value : [])
      setInternalThreads(threadsResult.status === 'fulfilled' ? threadsResult.value.items : [])
      setAgents(
        agentsResult.status === 'fulfilled'
          ? agentsResult.value.map((a) => ({
              id: a.id,
              name: a.name,
              avatar_kind: a.avatar_kind,
              avatar_icon: a.avatar_icon,
              avatar_color: a.avatar_color,
              avatar_image_url: a.avatar_image_url,
            }))
          : [],
      )
      setRefreshedAt(new Date())
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
  useUnsavedChangesGuard(dirty && !saving, t('projects.detail.unsavedLeave'))

  const saveAbout = useCallback(async () => {
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
  }, [project, name, description, t])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
      if (!dirty || saving || !name.trim()) return
      event.preventDefault()
      void saveAbout()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, saving, name, saveAbout])

  const toggleAutonomy = async (checked: boolean) => {
    if (!project) return
    setTogglingAutonomy(true)
    try {
      const updated = await patchProject(project.id, { autonomous_mode: checked })
      setProject(updated)
      toast.success(
        checked
          ? t('projects.detail.autonomousModeOn')
          : t('projects.detail.autonomousModeOff'),
      )
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.detail.saveError')))
    } finally {
      setTogglingAutonomy(false)
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
        <CardGridSkeleton cards={4} className="lg:grid-cols-2" />
      ) : error || !project ? (
        <ApiErrorBanner message={error ?? t('projects.detail.notFound')} onRetry={() => void load()} />
      ) : (
        <>
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold text-text-heading">{project.name}</h1>
              </div>
              {project.description ? (
                <p className="mt-1 max-w-2xl text-sm text-text-muted">{project.description}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {refreshedAt ? (
                <span className="text-xs text-text-muted">
                  {t('projects.detail.refreshedAt', { time: formatAppTime(refreshedAt, i18n.language) })}
                </span>
              ) : null}
              <Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
                {t('projects.detail.refresh')}
              </Button>
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
              {isAdmin ? (
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
              ) : null}
            </div>
          </header>
          {!isAdmin ? (
            <p className="rounded-lg border border-border/60 bg-bg-input/40 px-3 py-2 text-xs text-text-muted">
              {t('projects.detail.readonlyBanner')}
            </p>
          ) : null}

          <Tabs defaultValue="queue">
            <TabsList>
              <TabsTrigger value="queue">{t('projects.detail.tabQueue')}</TabsTrigger>
              <TabsTrigger value="docs">{t('projects.detail.tabDocs')}</TabsTrigger>
              <TabsTrigger value="settings">{t('projects.detail.tabSettings')}</TabsTrigger>
            </TabsList>

            <TabsContent value="queue">
              <ProjectQueue projectId={project.id} canEdit={isAdmin} />
            </TabsContent>

            <TabsContent value="docs">
              <ProjectDocs projectId={project.id} canEdit={isAdmin} />
            </TabsContent>

            <TabsContent value="settings" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Bot size={16} className="text-text-muted" />
                  {t('projects.detail.orchestration')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <ProjectOrchestratorSection project={project} agents={agents} onChanged={load} canEdit={isAdmin} />
                <ProjectAgentsSection projectId={project.id} agents={agents} />
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs text-text-muted">
                    <Workflow size={12} />
                    {t('projects.detail.workstreams')}
                  </Label>
                  {workstreams.length === 0 ? (
                    <p className="text-sm text-text-muted">{t('projects.detail.noWorkstreams')}</p>
                  ) : (
                    <ul className="space-y-1">
                      {workstreams.map((stream) => (
                        <li key={stream.id}>
                          <Link
                            to={workstreamPath(stream.id)}
                            className="flex items-center justify-between gap-2 rounded-md border border-border/50 px-2.5 py-1.5 transition-colors hover:border-border hover:bg-bg-muted/40"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm text-text-primary">{stream.name}</span>
                              <span className="block text-[11px] text-text-muted">
                                {t('projects.detail.stepCount', { count: stream.steps_count ?? 0 })}
                              </span>
                            </span>
                            <Badge
                              variant={stream.enabled ? 'secondary' : 'outline'}
                              className="shrink-0 px-1.5 py-0 text-[10px]"
                            >
                              {flowStatusLabel(stream.enabled, t)}
                            </Badge>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Button type="button" size="sm" variant="outline" asChild>
                    <Link to="/workstreams">{t('projects.detail.openWorkstreams')}</Link>
                  </Button>
                </div>
                <CaseBindingsCard targetKind="project" targetId={project.id} canEdit={isAdmin} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <GitBranch size={16} className="text-text-muted" />
                  {t('projects.detail.repository')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <ProjectRepoSection project={project} onChanged={load} canEdit={isAdmin} />
                <div className="space-y-1.5 border-t border-border/40 pt-3">
                  <Label className="text-xs text-text-muted">{t('projects.detail.resources')}</Label>
                  <p className="text-[11px] text-text-muted">{t('projects.detail.resourcesHint')}</p>
                  <ProjectResourcesSection projectId={project.id} canEdit={isAdmin} />
                </div>
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
                        <p className="text-xs text-text-muted" title={t('projects.detail.budgetCapHint')}>
                          {t('projects.detail.remainingToday')}
                        </p>
                        <p className="font-medium text-text-heading" title={t('projects.detail.budgetCapHint')}>
                          {formatAppNumber(budget.remaining_today, i18n.language)} {t('projects.detail.tokensUnit')}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-text-muted" title={t('projects.detail.budgetCapHint')}>
                          {t('projects.detail.remainingHour')}
                        </p>
                        <p className="font-medium text-text-heading" title={t('projects.detail.budgetCapHint')}>
                          {formatAppNumber(budget.remaining_hour, i18n.language)} {t('projects.detail.tokensUnit')}
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
                  <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!isAdmin} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="project-description">{t('projects.detail.description')}</Label>
                  <Input
                    id="project-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('projects.detail.descriptionPlaceholder')}
                    disabled={!isAdmin}
                  />
                </div>
                <div className="flex items-start justify-between gap-3 rounded-lg border border-border/50 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-heading">
                      {t('projects.detail.autonomousMode')}
                    </p>
                    <p className="text-xs text-text-muted">{t('projects.detail.autonomousModeHint')}</p>
                  </div>
                  <Switch
                    checked={Boolean(project.autonomous_mode)}
                    disabled={!isAdmin || togglingAutonomy}
                    onCheckedChange={(checked) => void toggleAutonomy(checked)}
                    aria-label={t('projects.detail.autonomousMode')}
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
                  <button
                    type="button"
                    onClick={() =>
                      void copyText(
                        project.slug,
                        t('projects.detail.copied', { label: t('projects.detail.copySlug') }),
                        t('projects.detail.copyError', { label: t('projects.detail.copySlug') }),
                      )
                    }
                    className="inline-flex items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-text-primary"
                    title={project.slug}
                  >
                    <Copy size={12} />
                    {t('projects.detail.copySlug')}
                  </button>
                  {isAdmin ? (
                  <Button type="button" size="sm" disabled={!dirty || saving || !name.trim()} onClick={() => void saveAbout()}>
                    {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                    {t('projects.detail.save')}
                  </Button>
                  ) : null}
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
            </TabsContent>
          </Tabs>
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
