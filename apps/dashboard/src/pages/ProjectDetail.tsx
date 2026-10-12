import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Bot,
  Copy,
  FolderInput,
  FolderKanban,
  GitBranch,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react'
import { CANVAS_ICON } from '../lib/entity-icons'
import { toast } from 'sonner'
import { toastMovedToBin } from '../lib/bin-toast'
import { PageContent } from '../components/layout/PageContent'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import FileInFolderDialog from '../components/inbox/FileInFolderDialog'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { AgentOptionRow } from '../components/ui/AgentOptionRow'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import ConfirmDeleteDialog from '../components/ui/ConfirmDeleteDialog'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { ProjectAgentsSection } from '../components/projects/ProjectAgentsSection'
import { ProjectConversations } from '../components/projects/ProjectConversations'
import { ProjectDocs } from '../components/projects/ProjectDocs'
import { ProjectCanvasBoard } from '../components/projects/ProjectCanvasBoard'
import { ProjectFlowBoards } from '../components/projects/ProjectFlowBoards'
import { ProjectFolderGrid } from '../components/projects/ProjectFolderCards'
import { ProjectHome } from '../components/projects/ProjectHome'
import { ProjectRepoSection } from '../components/projects/ProjectRepoSection'
import { ProjectResourcesSection } from '../components/projects/ProjectResourcesSection'
import { WorkLogsTable } from '../components/workforce/WorkLogsTable'
import { AutosaveStatus } from '../components/ui/AutosaveStatus'
import { useAutosave } from '../hooks/useAutosave'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { useAuth } from '../context/AuthContext'
import { listAgents } from '../lib/agents-api'
import { projectHubPath } from '../lib/messages-paths'
import { withNavReveal } from '../lib/nav-reveal'
import { runThreadPath } from '../lib/open-entity'
import { listThreads, type InboxThread } from '../lib/inbox-api'
import {
  createProject,
  deleteProject,
  getProject,
  getProjectBudget,
  listFolderFiles,
  patchProject,
  type ProjectBudgetResponse,
  type ProjectRow,
} from '../lib/projects-api'
import { useProjectDeleteConnectionImpact } from '../lib/use-project-delete-connection-impact'
import { listWorkLogs, type WorkLogRow } from '../lib/work-logs-api'
import type { RuntimeAgent } from '../lib/workforce-api'

const PROJECT_TABS = ['home', 'conversations', 'tickets', 'canvas', 'docs', 'files', 'settings'] as const
type ProjectTab = (typeof PROJECT_TABS)[number]

function parseProjectTab(raw: string | null): ProjectTab {
  if (raw === 'queue') return 'home'
  return (PROJECT_TABS as readonly string[]).includes(raw ?? '') ? (raw as ProjectTab) : 'home'
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
  const { t } = useTranslation('nav')
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = parseProjectTab(searchParams.get('tab'))
  const isAdmin = useIsAdmin()
  const { token } = useAuth()

  const [project, setProject] = useState<ProjectRow | null>(null)
  const [budget, setBudget] = useState<ProjectBudgetResponse | null>(null)
  const [runs, setRuns] = useState<WorkLogRow[]>([])
  const [runsMore, setRunsMore] = useState(false)
  const [loadingMoreRuns, setLoadingMoreRuns] = useState(false)
  const [internalThreads, setInternalThreads] = useState<InboxThread[]>([])
  const [agents, setAgents] = useState<RuntimeAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshCount, setRefreshCount] = useState(0)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [folderOpen, setFolderOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [files, setFiles] = useState<{ name: string; url?: string | null; signal_id: string; subject: string }[]>([])
  const widenedConnections = useProjectDeleteConnectionImpact(deleteOpen ? project?.id ?? null : null)

  const setTab = useCallback(
    (next: ProjectTab) => {
      const params = new URLSearchParams(searchParams)
      if (next === 'home') params.delete('tab')
      else params.set('tab', next)
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams],
  )

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
      const [budgetResult, runsResult, agentsResult, threadsResult, filesResult] = await Promise.allSettled([
        getProjectBudget(projectId),
        listWorkLogs({ project_id: projectId, limit: 10 }),
        listAgents(),
        token ? listThreads(token, { folder: 'internal', perPage: 80 }) : Promise.reject(new Error('signed out')),
        listFolderFiles(projectId),
      ])
      setBudget(budgetResult.status === 'fulfilled' ? budgetResult.value : null)
      const runRows = runsResult.status === 'fulfilled' ? runsResult.value : []
      setRuns(runRows)
      setRunsMore(runRows.length === 10)
      setInternalThreads(threadsResult.status === 'fulfilled' ? threadsResult.value.items : [])
      setAgents(agentsResult.status === 'fulfilled' ? agentsResult.value : [])
      setFiles(filesResult.status === 'fulfilled' ? filesResult.value : [])
      setRefreshCount((count) => count + 1)
    } catch (err) {
      setError(formatApiErrorMessage(err, t('projects.detail.loadError')))
    } finally {
      setLoading(false)
    }
  }, [projectId, t, token])

  useEffect(() => {
    void load()
  }, [load])

  const loadMoreRuns = useCallback(async () => {
    if (!projectId || loadingMoreRuns) return
    setLoadingMoreRuns(true)
    try {
      const page = await listWorkLogs({ project_id: projectId, limit: 10, offset: runs.length })
      setRuns((prev) => {
        const seen = new Set(prev.map((row) => row.id))
        return [...prev, ...page.filter((row) => !seen.has(row.id))]
      })
      setRunsMore(page.length === 10)
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.detail.loadError')))
    } finally {
      setLoadingMoreRuns(false)
    }
  }, [loadingMoreRuns, projectId, runs.length, t])

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
      toastMovedToBin(t('projects.detail.deleted'), navigate)
      navigate('/folders')
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.detail.deleteError')))
    } finally {
      setDeleting(false)
    }
  }

  const createFolder = async () => {
    if (!project) return
    const nextName = folderName.trim()
    const slug = nextName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    if (!nextName || !slug) return
    setCreatingFolder(true)
    try {
      const created = await createProject({
        name: nextName,
        slug,
        autonomous_scope: project.autonomous_scope || 'ops',
        parent_id: project.id,
      })
      setFolderName('')
      setFolderOpen(false)
      toast.success(t('projects.detail.folderCreated'))
      navigate(`/folders/${created.id}`)
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.page.createError')))
    } finally {
      setCreatingFolder(false)
    }
  }

  const folders = project?.children ?? []
  const hubHref = project ? withNavReveal(projectHubPath(project.id, 'open')) : '/communication'

  return (
    <PageContent width="xl" className="space-y-4 py-1">
      <nav
        aria-label={t('projects.detail.breadcrumb')}
        className="flex flex-wrap items-center gap-1.5 text-sm text-text-muted"
      >
        <Link
          to="/folders"
          className="inline-flex items-center gap-1.5 transition-colors hover:text-text-primary"
        >
          <ArrowLeft size={14} />
          {t('projects.detail.back')}
        </Link>
        {(project?.ancestors ?? []).map((ancestor) => (
          <span key={ancestor.id} className="inline-flex min-w-0 items-center gap-1.5">
            <span aria-hidden>/</span>
            <Link to={`/folders/${ancestor.id}`} className="truncate hover:text-text-primary">
              {ancestor.name}
            </Link>
          </span>
        ))}
        {project ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-text-heading">
            <span aria-hidden>/</span>
            <span className="truncate">{name.trim() || project.name}</span>
          </span>
        ) : null}
      </nav>

      {loading ? (
        <CardGridSkeleton cards={4} className="lg:grid-cols-2" />
      ) : error || !project ? (
        <ApiErrorBanner message={error ?? t('projects.detail.notFound')} onRetry={() => void load()} />
      ) : (
        <>
          <header className="panel flex flex-wrap items-start gap-4 p-4">
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"
              aria-hidden
            >
              <FolderKanban size={20} />
            </span>
            <div className="min-w-0 flex-1 space-y-1.5">
              {isAdmin ? (
                <input
                  id="project-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-label={t('projects.detail.name')}
                  className="-ml-1.5 w-full max-w-xl truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-lg font-semibold tracking-[-0.01em] text-text-heading outline-none hover:border-border/50 focus:border-border focus:bg-bg-input/60 focus:ring-1 focus:ring-border/60"
                />
              ) : (
                <h1 className="truncate text-lg font-semibold tracking-[-0.01em] text-text-heading">
                  {project.name}
                </h1>
              )}
              {isAdmin ? (
                <textarea
                  id="project-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('projects.detail.descriptionPlaceholder')}
                  aria-label={t('projects.detail.description')}
                  rows={description.length > 120 ? 2 : 1}
                  className="-ml-1.5 w-full max-w-2xl resize-none rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm leading-relaxed text-text-secondary outline-none placeholder:text-text-muted/50 hover:border-border/50 focus:border-border focus:bg-bg-input/60 focus:ring-1 focus:ring-border/60"
                />
              ) : project.description ? (
                <p className="max-w-2xl text-sm text-text-secondary">{project.description}</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-xs text-text-muted">
                <span className="tabular-nums">
                  {t('projects.detail.folderCounts', {
                    open: project.open_count ?? 0,
                    closed: project.closed_count ?? 0,
                  })}
                </span>
                {folders.length > 0 ? (
                  <span className="tabular-nums">{t('projects.page.folders', { count: folders.length })}</span>
                ) : null}
                {project.po_agent ? (
                  <Link
                    to={`/agents/${project.po_agent.id}`}
                    className="inline-flex items-center text-text-secondary hover:text-text-primary"
                  >
                    <AgentOptionRow
                      agent={{
                        id: project.po_agent.id,
                        name: project.po_agent.name,
                        avatar_kind: project.po_agent.avatar_kind,
                        avatar_icon: project.po_agent.avatar_icon,
                        avatar_color: project.po_agent.avatar_color,
                        avatar_image_url: project.po_agent.avatar_image_url,
                      }}
                      size={16}
                    />
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <Bot size={12} aria-hidden />
                    {t('projects.page.noLead')}
                  </span>
                )}
                {project.github_repo_full_name ? (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <GitBranch size={12} aria-hidden />
                    <span className="truncate">{project.github_repo_full_name}</span>
                  </span>
                ) : null}
                {isAdmin ? (
                  <AutosaveStatus phase={phase} lastSavedAt={lastSavedAt} error={autosaveError} />
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Button type="button" size="sm" variant="outline" asChild>
                <Link to={hubHref}>
                  <MessageSquare size={14} className="mr-1" aria-hidden />
                  {t('projects.detail.openInCommunication')}
                </Link>
              </Button>
              {isAdmin ? (
                <Button type="button" size="sm" variant="outline" onClick={() => setFolderOpen(true)}>
                  <Plus size={14} className="mr-1" aria-hidden />
                  {t('projects.detail.newFolder')}
                </Button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t('projects.detail.moreActions')}
                    title={t('projects.detail.moreActions')}
                  >
                    <MoreHorizontal size={15} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[200px]">
                  <DropdownMenuItem
                    onSelect={() =>
                      void copyText(
                        project.id,
                        t('projects.detail.copied', { label: t('projects.detail.copyId') }),
                        t('projects.detail.copyError', { label: t('projects.detail.copyId') }),
                      )
                    }
                  >
                    <Copy size={14} className="mr-2" aria-hidden />
                    {t('projects.detail.copyId')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      void copyText(
                        project.slug,
                        t('projects.detail.copied', { label: t('projects.detail.copySlug') }),
                        t('projects.detail.copyError', { label: t('projects.detail.copySlug') }),
                      )
                    }
                  >
                    <Copy size={14} className="mr-2" aria-hidden />
                    {t('projects.detail.copySlug')}
                  </DropdownMenuItem>
                  {isAdmin ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => setMoveOpen(true)}>
                        <FolderInput size={14} className="mr-2" aria-hidden />
                        {t('projects.detail.move')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-status-error focus:text-status-error"
                        onSelect={() => setDeleteOpen(true)}
                      >
                        <Trash2 size={14} className="mr-2" aria-hidden />
                        {t('projects.detail.delete')}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          {!isAdmin ? (
            <p className="rounded-lg border border-border/60 bg-bg-input/40 px-3 py-2 text-xs text-text-muted">
              {t('projects.detail.readonlyBanner')}
            </p>
          ) : null}

          <Tabs value={tab} onValueChange={(next) => setTab(parseProjectTab(next))}>
            <TabsList>
              <TabsTrigger value="home">{t('projects.detail.tabHome')}</TabsTrigger>
              <TabsTrigger value="conversations">
                {t('projects.detail.tabConversations')}
                {(project.open_count ?? 0) > 0 ? (
                  <span className="rounded-full bg-bg-muted/60 px-1.5 text-2xs tabular-nums text-text-muted">
                    {project.open_count}
                  </span>
                ) : null}
              </TabsTrigger>
              {(project.open_tickets_count ?? 0) > 0 || tab === 'tickets' ? (
                <TabsTrigger value="tickets">{t('projects.detail.tabTickets')}</TabsTrigger>
              ) : null}
              {(project.doc_sections_total ?? 0) > 0 || tab === 'docs' ? (
                <TabsTrigger value="docs">{t('projects.detail.tabDocs')}</TabsTrigger>
              ) : null}
              {files.length > 0 || tab === 'files' ? (
                <TabsTrigger value="files">{t('projects.detail.tabFiles', { defaultValue: 'Files' })}</TabsTrigger>
              ) : null}
              <TabsTrigger value="canvas">
                <CANVAS_ICON size={14} className="shrink-0 opacity-80" aria-hidden />
                {t('projects.detail.tabCanvas')}
              </TabsTrigger>
              <TabsTrigger value="settings">{t('projects.detail.tabSettings')}</TabsTrigger>
            </TabsList>

            <TabsContent value="home" className="space-y-6">
              {folders.length > 0 || isAdmin ? (
                <section className="space-y-2" aria-labelledby="project-folders">
                  <div className="flex items-center justify-between gap-2">
                    <h2 id="project-folders" className="text-sm font-semibold text-text-heading">
                      {t('projects.detail.folders')}
                    </h2>
                    {folders.length === 0 ? (
                      <p className="text-xs text-text-muted">{t('projects.detail.foldersEmpty')}</p>
                    ) : null}
                  </div>
                  <ProjectFolderGrid
                    folders={folders}
                    onCreate={isAdmin ? () => setFolderOpen(true) : undefined}
                  />
                </section>
              ) : null}

              <ProjectHome
                project={project}
                budget={budget}
                agents={agents}
                canEdit={isAdmin}
                onChanged={() => load({ silent: true })}
              />

              <ProjectConversations
                projectId={project.id}
                preview
                refreshKey={refreshCount}
                onShowAll={() => setTab('conversations')}
              />

              <section className="space-y-2" aria-labelledby="project-activity">
                <h2 id="project-activity" className="text-sm font-semibold text-text-heading">
                  {t('projects.detail.activity')}
                </h2>
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
                {runsMore ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={loadingMoreRuns}
                    onClick={() => void loadMoreRuns()}
                  >
                    {loadingMoreRuns ? t('projects.detail.loadingMoreRuns') : t('projects.detail.loadMoreRuns')}
                  </Button>
                ) : null}
              </section>
            </TabsContent>

            <TabsContent value="conversations">
              <ProjectConversations projectId={project.id} refreshKey={refreshCount} />
            </TabsContent>

            <TabsContent value="tickets">
              <Card>
                <CardHeader>
                  <CardTitle>{t('projects.home.ticketsBoard')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xs text-text-muted">{t('projects.home.ticketsHint')}</p>
                  <ProjectFlowBoards
                    projectId={project.id}
                    canEdit={isAdmin}
                    onFlowsChanged={() => void load({ silent: true })}
                  />
                </CardContent>
              </Card>
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

            <TabsContent value="files">
              <Card>
                <CardHeader>
                  <CardTitle>{t('projects.detail.tabFiles', { defaultValue: 'Files' })}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {files.length === 0 ? (
                    <p className="text-sm text-text-muted">{t('projects.detail.filesEmpty', { defaultValue: 'No attachments in this folder yet.' })}</p>
                  ) : (
                    files.map((file, index) => (
                      <div key={`${file.signal_id}-${index}`} className="flex items-center justify-between gap-2 text-sm">
                        {file.url ? (
                          <a href={file.url} className="truncate text-accent hover:underline" target="_blank" rel="noreferrer">
                            {file.name}
                          </a>
                        ) : (
                          <span className="truncate">{file.name}</span>
                        )}
                        <span className="shrink-0 text-xs text-text-muted">{file.subject}</span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
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
          impactText={
            widenedConnections.length > 0
              ? `${t('projects.detail.deleteImpact')} ${t('projects.work.deleteWidensConnections', {
                  names: widenedConnections.join(', '),
                })}`
              : t('projects.detail.deleteImpact')
          }
          isDeleting={deleting}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={confirmDelete}
        />
      ) : null}
      <Dialog open={folderOpen} onOpenChange={setFolderOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('projects.detail.newFolderTitle')}</DialogTitle>
            <DialogDescription>{t('projects.detail.newFolderBody')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="folder-name">{t('projects.page.name')}</Label>
            <Input
              id="folder-name"
              value={folderName}
              autoFocus
              onChange={(event) => setFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && folderName.trim()) void createFolder()
              }}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setFolderOpen(false)} disabled={creatingFolder}>
              {t('projects.page.cancel')}
            </Button>
            <Button type="button" onClick={() => void createFolder()} disabled={creatingFolder || !folderName.trim()}>
              {t('projects.detail.newFolder')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {project ? (
        <FileInFolderDialog
          open={moveOpen}
          onOpenChange={setMoveOpen}
          title={t('projects.detail.moveTitle')}
          description={t('projects.detail.moveBody')}
          confirmLabel={t('projects.detail.move')}
          allowRoot
          excludeSubtreeOf={project.id}
          onConfirm={async (parentId) => {
            await patchProject(project.id, { parent_id: parentId })
            toast.success(t('projects.detail.moved'))
            await load({ silent: true })
          }}
        />
      ) : null}
    </PageContent>
  )
}
