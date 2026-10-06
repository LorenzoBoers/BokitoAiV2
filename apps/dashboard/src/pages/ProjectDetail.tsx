import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Bot,
  CalendarClock,
  Copy,
  FolderKanban,
  GitBranch,
  MessageSquare,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageContent } from '../components/layout/PageContent'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import ConfirmDeleteDialog from '../components/ui/ConfirmDeleteDialog'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { ProjectAgentsSection } from '../components/projects/ProjectAgentsSection'
import { ProjectDocs } from '../components/projects/ProjectDocs'
import { ProjectCanvasBoard } from '../components/projects/ProjectCanvasBoard'
import { ProjectHome } from '../components/projects/ProjectHome'
import { ProjectRepoSection } from '../components/projects/ProjectRepoSection'
import { ProjectResourcesSection } from '../components/projects/ProjectResourcesSection'
import { WorkLogsTable } from '../components/workforce/WorkLogsTable'
import { AutosaveStatus } from '../components/ui/AutosaveStatus'
import { useAutosave } from '../hooks/useAutosave'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { useAuth } from '../context/AuthContext'
import { formatAppTime } from '../lib/app-locale'
import { listAgents } from '../lib/agents-api'
import { runThreadPath } from '../lib/open-entity'
import { listThreads, type InboxThread } from '../lib/inbox-api'
import { projectHubPath } from '../lib/messages-paths'
import { withNavReveal } from '../lib/nav-reveal'
import {
  deleteProject,
  getProject,
  getProjectBudget,
  patchProject,
  type ProjectBudgetResponse,
  type ProjectRow,
} from '../lib/projects-api'
import { listWorkLogs, type WorkLogRow } from '../lib/work-logs-api'
import type { RuntimeAgent } from '../lib/workforce-api'

const PROJECT_TABS = ['home', 'canvas', 'docs', 'settings'] as const
type ProjectTab = (typeof PROJECT_TABS)[number]

function parseProjectTab(raw: string | null): ProjectTab {
  if (raw === 'queue') return 'home'
  if (raw === 'canvas' || raw === 'docs' || raw === 'settings') return raw
  return 'home'
}

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
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = parseProjectTab(searchParams.get('tab'))
  const isAdmin = useIsAdmin()
  const { token } = useAuth()

  const [project, setProject] = useState<ProjectRow | null>(null)
  const [budget, setBudget] = useState<ProjectBudgetResponse | null>(null)
  const [runs, setRuns] = useState<WorkLogRow[]>([])
  const [internalThreads, setInternalThreads] = useState<InboxThread[]>([])
  const [agents, setAgents] = useState<RuntimeAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!projectId) return
    if (!opts?.silent) setLoading(true)
    setError(null)
    try {
      const row = await getProject(projectId)
      setProject(row)
      setName(row.name)
      setDescription(row.description ?? '')
      // Secondary data may fail independently without blocking the page.
      const [budgetResult, runsResult, agentsResult, threadsResult] = await Promise.allSettled([
        getProjectBudget(projectId),
        listWorkLogs({ project_id: projectId, limit: 10 }),
        listAgents(),
        token ? listThreads(token, { folder: 'internal', perPage: 80 }) : Promise.reject(new Error('signed out')),
      ])
      setBudget(budgetResult.status === 'fulfilled' ? budgetResult.value : null)
      setRuns(runsResult.status === 'fulfilled' ? runsResult.value : [])
      setInternalThreads(threadsResult.status === 'fulfilled' ? threadsResult.value.items : [])
      setAgents(agentsResult.status === 'fulfilled' ? agentsResult.value : [])
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

  const saveAbout = useCallback(async () => {
    if (!project || !name.trim()) return
    try {
      const updated = await patchProject(project.id, {
        name: name.trim(),
        description: description.trim() || undefined,
      })
      setProject(updated)
      setName(updated.name)
      setDescription(updated.description ?? '')
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.detail.saveError')))
      throw err
    }
  }, [project, name, description, t])

  const { phase, lastSavedAt, error: autosaveError, flush } = useAutosave({
    dirty,
    enabled: isAdmin && Boolean(project),
    canSave: Boolean(name.trim()),
    save: saveAbout,
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
      if (!dirty || !name.trim()) return
      event.preventDefault()
      void flush()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, name, flush])

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
    ? withNavReveal(projectHubPath(project.id, 'open'))
    : '/communication'

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
              <div className="flex min-w-0 items-center gap-2">
                <FolderKanban size={18} className="shrink-0 text-text-muted" aria-hidden />
                <h1 className="truncate text-lg font-semibold tracking-[-0.01em] text-text-heading">
                  {project.name}
                </h1>
              </div>
              {project.description ? (
                <p className="mt-1 max-w-2xl text-sm text-text-muted">{project.description}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void load()}
                disabled={loading}
                aria-label={t('projects.detail.refresh')}
                title={
                  refreshedAt
                    ? t('projects.detail.refreshedAt', { time: formatAppTime(refreshedAt, i18n.language) })
                    : t('projects.detail.refresh')
                }
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
              </Button>
              <Button asChild type="button" size="sm" variant="outline">
                <Link to={threadsHref}>
                  <MessageSquare size={14} className="mr-1" />
                  {t('projects.detail.openInCommunication')}
                </Link>
              </Button>
              <Button asChild type="button" size="sm" variant="outline">
                <Link to={`/agenda?view=list&project=${encodeURIComponent(project.id)}`}>
                  <CalendarClock size={14} className="mr-1" />
                  {t('projects.home.agendaOpen')}
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

          <Tabs
            value={tab}
            onValueChange={(next) => {
              const parsed = parseProjectTab(next)
              const params = new URLSearchParams(searchParams)
              if (parsed === 'home') params.delete('tab')
              else params.set('tab', parsed)
              setSearchParams(params, { replace: true })
            }}
          >
            <TabsList>
              <TabsTrigger value="home">{t('projects.detail.tabHome')}</TabsTrigger>
              <TabsTrigger value="canvas">{t('projects.detail.tabCanvas')}</TabsTrigger>
              <TabsTrigger value="docs">{t('projects.detail.tabDocs')}</TabsTrigger>
              <TabsTrigger value="settings">{t('projects.detail.tabSettings')}</TabsTrigger>
            </TabsList>

            <TabsContent value="home" className="space-y-4">
              <ProjectHome
                project={project}
                budget={budget}
                agents={agents}
                canEdit={isAdmin}
                onChanged={() => load({ silent: true })}
              />
              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-text-heading">{t('projects.detail.activity')}</h2>
                  <Button asChild type="button" size="sm" variant="ghost">
                    <Link to={threadsHref}>{t('projects.detail.openInCommunication')}</Link>
                  </Button>
                </div>
                {runs.length === 0 ? (
                  <Card className="p-4">
                    <p className="text-sm text-text-muted">{t('projects.detail.noRuns')}</p>
                  </Card>
                ) : (
                  <WorkLogsTable
                    runs={runs}
                    projects={[project]}
                    runTo={(run) =>
                      runThreadPath(
                        run,
                        internalThreads.map((row) => ({
                          id: String(row.id),
                          emailSubject: row.emailSubject,
                          lastMessageAt: row.lastMessageAt,
                        })),
                      )
                    }
                    showProjectColumn={false}
                  />
                )}
              </section>
            </TabsContent>

            <TabsContent value="canvas">
              <ProjectCanvasBoard
                projectId={project.id}
                agentId={project.po_agent_id}
                canEdit={isAdmin}
              />
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
                <ProjectAgentsSection projectId={project.id} agents={agents} />
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
                  <p className="text-xs text-text-muted">{t('projects.detail.resourcesHint')}</p>
                  <ProjectResourcesSection projectId={project.id} canEdit={isAdmin} />
                </div>
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
                    <AutosaveStatus phase={phase} lastSavedAt={lastSavedAt} error={autosaveError} />
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </div>
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
