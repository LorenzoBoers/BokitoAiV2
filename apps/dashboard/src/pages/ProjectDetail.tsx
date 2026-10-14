import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Copy,
  FolderInput,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react'
import { CANVAS_ICON } from '../lib/entity-icons'
import { toast } from 'sonner'
import { toastMovedToBin } from '../lib/bin-toast'
import { runFolderMoveUndo, setFolderMoveUndo } from '../lib/folder-move-undo'
import { PageContent } from '../components/layout/PageContent'
import { Button } from '../components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import FileInFolderDialog from '../components/inbox/FileInFolderDialog'
import { useConfirm } from '../components/ui/confirm-dialog'
import { TagSetPicker } from '../components/ui/TagSetPicker'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import ConfirmDeleteDialog from '../components/ui/ConfirmDeleteDialog'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { ProjectConversations } from '../components/projects/ProjectConversations'
import { ProjectDocs } from '../components/projects/ProjectDocs'
import { ProjectCanvasBoard } from '../components/projects/ProjectCanvasBoard'
import { ProjectFlowBoards } from '../components/projects/ProjectFlowBoards'
import { ProjectFolderGrid } from '../components/projects/ProjectFolderCards'
import { ProjectHome } from '../components/projects/ProjectHome'
import { WorkLogsTable } from '../components/workforce/WorkLogsTable'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { useAuth } from '../context/AuthContext'
import { projectHubPath } from '../lib/messages-paths'
import { withNavReveal } from '../lib/nav-reveal'
import { runThreadPath } from '../lib/open-entity'
import { listThreads, type InboxThread } from '../lib/inbox-api'
import {
  createProject,
  deleteProject,
  getProject,
  listFolderFiles,
  nestFolder,
  patchProject,
  type ProjectRow,
} from '../lib/projects-api'
import { useProjectDeleteConnectionImpact } from '../lib/use-project-delete-connection-impact'
import { listWorkLogs, type WorkLogRow } from '../lib/work-logs-api'
import {
  filtersetLocalNames,
  filtersetPlainLabel,
  previewNestMerge,
} from '../lib/folder-filter-tree'
import { notifyFoldersChanged } from '../lib/folders-bus'
import { FiltersetHeading } from '../components/folders/FiltersetHeading'

const PROJECT_TABS = ['home', 'conversations', 'tickets', 'canvas', 'docs', 'files'] as const
type ProjectTab = (typeof PROJECT_TABS)[number]

function parseProjectTab(raw: string | null): ProjectTab {
  if (raw === 'queue' || raw === 'settings') return 'home'
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
  const confirm = useConfirm()

  const [project, setProject] = useState<ProjectRow | null>(null)
  const [runs, setRuns] = useState<WorkLogRow[]>([])
  const [runsMore, setRunsMore] = useState(false)
  const [loadingMoreRuns, setLoadingMoreRuns] = useState(false)
  const [internalThreads, setInternalThreads] = useState<InboxThread[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshCount, setRefreshCount] = useState(0)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [folderOpen, setFolderOpen] = useState(false)
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
      const [runsResult, threadsResult, filesResult] = await Promise.allSettled([
        listWorkLogs({ project_id: projectId, limit: 10 }),
        token ? listThreads(token, { folder: 'internal', perPage: 80 }) : Promise.reject(new Error('signed out')),
        listFolderFiles(projectId),
      ])
      const runRows = runsResult.status === 'fulfilled' ? runsResult.value : []
      setRuns(runRows)
      setRunsMore(runRows.length === 10)
      setInternalThreads(threadsResult.status === 'fulfilled' ? threadsResult.value.items : [])
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

  const confirmDelete = async () => {
    if (!project) return
    setDeleting(true)
    try {
      await deleteProject(project.id, project.name)
      notifyFoldersChanged({ folderId: project.id })
      toastMovedToBin(t('projects.detail.deleted'), navigate)
      navigate('/folders')
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.detail.deleteError')))
    } finally {
      setDeleting(false)
    }
  }

  const folders = project?.children ?? []
  const hubHref = project ? withNavReveal(projectHubPath(project.id, 'open')) : '/communication'
  const ancestors = project?.ancestors ?? []
  const parentTagNames = ancestors.length
    ? (ancestors[ancestors.length - 1]?.tag_names ?? null)
    : null
  const crumbLabel = project
    ? project.tag_names?.length
      ? filtersetPlainLabel(filtersetLocalNames(project.tag_names, parentTagNames))
      : project.name.replace(/^#/, '')
    : ''

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
        {ancestors.map((ancestor, index) => {
          const parentNames = index > 0 ? ancestors[index - 1]?.tag_names : null
          const label = ancestor.tag_names?.length
            ? filtersetPlainLabel(filtersetLocalNames(ancestor.tag_names, parentNames))
            : (ancestor.name ?? '').replace(/^#/, '')
          return (
            <span key={ancestor.id} className="inline-flex min-w-0 items-center gap-1.5">
              <span aria-hidden>/</span>
              <Link to={`/folders/${ancestor.id}`} className="truncate hover:text-text-primary">
                {label}
              </Link>
            </span>
          )
        })}
        {project ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-text-heading">
            <span aria-hidden>/</span>
            <span className="truncate">{crumbLabel}</span>
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
            <div className="min-w-0 flex-1 space-y-2">
              <FiltersetHeading
                folderId={project.id}
                tagNames={project.tag_names ?? []}
                parentTagNames={parentTagNames}
                canEdit={isAdmin}
                onChanged={() => load({ silent: true })}
                size="lg"
              />
              <p className="text-xs text-text-muted">
                {t('projects.detail.filtersetTitleHint', {
                  defaultValue: 'Conversations match when they carry every tag. Click the tags to edit.',
                })}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                <span className="tabular-nums">
                  {t('projects.detail.folderCounts', {
                    open: project.open_count ?? 0,
                    closed: project.closed_count ?? 0,
                  })}
                </span>
                {folders.length > 0 ? (
                  <span className="tabular-nums">{t('projects.page.folders', { count: folders.length })}</span>
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
                        {t('projects.detail.nestUnder', { defaultValue: 'Nest under…' })}
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
            </TabsList>

            <TabsContent value="home" className="space-y-6">
              {folders.length > 0 || isAdmin ? (
                <section className="space-y-2" aria-labelledby="project-folders">
                  <div className="flex items-center justify-between gap-2">
                    <h2 id="project-folders" className="text-sm font-semibold text-text-heading">
                      {t('projects.detail.folders')}
                    </h2>
                    {folders.length === 0 ? (
                      <p className="text-xs text-text-muted">
                        {t('projects.detail.noNarrowerMaps', {
                          defaultValue:
                            'No narrower maps yet — drag a map onto this one, or New folder with extra tags.',
                        })}
                      </p>
                    ) : null}
                  </div>
                  <ProjectFolderGrid
                    folders={folders}
                    parentTagNames={project.tag_names}
                    onCreate={isAdmin ? () => setFolderOpen(true) : undefined}
                  />
                </section>
              ) : null}

              <ProjectHome project={project} canEdit={isAdmin} onChanged={() => load({ silent: true })} />

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
                projectName={project.name}
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
                    <p className="text-sm text-text-muted">
                      {t('projects.detail.filesEmpty', { defaultValue: 'No attachments in this folder yet.' })}
                    </p>
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
      {project ? (
        <TagSetPicker
          open={folderOpen}
          onOpenChange={setFolderOpen}
          mode="folder"
          title={t('projects.detail.newFolderTitle')}
          description={t('projects.detail.newFolderBody')}
          confirmLabel={t('projects.detail.newFolder')}
          lockedNames={project.tag_names ?? []}
          initialSelected={[]}
          onConfirm={async (tagNames) => {
            const created = await createProject({ tags: tagNames })
            notifyFoldersChanged({ folderId: created.id })
            toast.success(t('projects.detail.folderCreated'))
            navigate(`/folders/${created.id}`)
          }}
        />
      ) : null}
      {project ? (
        <FileInFolderDialog
          open={moveOpen}
          onOpenChange={setMoveOpen}
          title={t('projects.detail.nestTitle', { defaultValue: 'Nest under a broader map' })}
          description={t('projects.detail.nestBody', {
            defaultValue:
              'Nesting adds every tag from the map you choose. This map becomes more specific and sits under that broader filterset.',
          })}
          confirmLabel={t('projects.detail.nestConfirm', { defaultValue: 'Nest' })}
          excludeSubtreeOf={project.id}
          onConfirm={async (ontoId) => {
            if (!ontoId) return
            const previousTags = (project.tag_names ?? []).map((name) => name.replace(/^#/, '')).filter(Boolean)
            // Resolve target tags from children/ancestors when possible for confirm copy.
            const onto =
              project.children?.find((row) => row.id === ontoId) ??
              project.ancestors?.find((row) => row.id === ontoId) ??
              null
            const ontoTags = (onto?.tag_names ?? []).map((name) => name.replace(/^#/, '')).filter(Boolean)
            if (ontoTags.length) {
              const preview = previewNestMerge(previousTags, ontoTags)
              if (preview.addedNames.length > 0) {
                const ok = await confirm({
                  title: t('projects.detail.nestConfirmTitle', {
                    defaultValue: 'Nest under broader map?',
                  }),
                  description: preview.unrelated
                    ? t('projects.detail.nestConfirmUnrelated', {
                        defaultValue:
                          'These maps shared no tags. After nesting, matching conversations must also carry {{parent}}. Result: {{merged}} — sits under {{parent}}.',
                        parent: preview.parentLabel,
                        merged: preview.mergedLabel,
                      })
                    : t('projects.detail.nestConfirmBody', {
                        defaultValue:
                          'Becomes {{merged}} and sits under {{parent}}. Nesting adds the broader map\'s tags to this filterset.',
                        merged: preview.mergedLabel,
                        parent: preview.parentLabel,
                      }),
                  confirmLabel: t('projects.detail.nestConfirm', { defaultValue: 'Nest' }),
                  destructive: preview.unrelated,
                })
                if (!ok) return
              }
            }
            await nestFolder(project.id, ontoId)
            const label = t('projects.detail.nested', {
              defaultValue: 'Folder nested — it now requires the broader tags too.',
            })
            const undoLabel = t('projects.detail.undoMove', { defaultValue: 'Undo' })
            const run = async () => {
              if (!previousTags.length) return
              await patchProject(project.id, { tags: previousTags })
              await load({ silent: true })
            }
            const id = toast.success(label, {
              duration: 12_000,
              action: {
                label: undoLabel,
                onClick: () => {
                  void (async () => {
                    try {
                      const ran = await runFolderMoveUndo()
                      if (ran) {
                        toast.success(t('projects.detail.undoDone', { defaultValue: 'Move undone' }))
                      }
                    } catch (err) {
                      toast.error(formatApiErrorMessage(err, t('projects.detail.saveError')))
                    }
                  })()
                },
              },
            })
            setFolderMoveUndo({ label, run }, id)
            await load({ silent: true })
          }}
        />
      ) : null}
    </PageContent>
  )
}
