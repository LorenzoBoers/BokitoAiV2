import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Copy,
  FolderInput,
  MessageSquare,
  MoreHorizontal,
  Trash2,
} from 'lucide-react'
import { CANVAS_ICON } from '../lib/entity-icons'
import { toast } from 'sonner'
import { toastMovedToBin } from '../lib/bin-toast'
import { runFolderMoveUndo, setFolderMoveUndo } from '../lib/folder-move-undo'
import { PageContent } from '../components/layout/PageContent'
import { OpenInGridButton } from '../components/org/OpenInGridButton'
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
import { CreateFolderDialog } from '../components/folders/CreateFolderDialog'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import ConfirmDeleteDialog from '../components/ui/ConfirmDeleteDialog'
import { FolderHomeSkeleton } from '../components/ui/skeleton'
import { ProjectConversations } from '../components/projects/ProjectConversations'
import { ProjectDocs } from '../components/projects/ProjectDocs'
import { ProjectCanvasBoard } from '../components/projects/ProjectCanvasBoard'
import { ProjectFlowBoards } from '../components/projects/ProjectFlowBoards'
import { ProjectFolderGrid } from '../components/projects/ProjectFolderCards'
import { ProjectHome } from '../components/projects/ProjectHome'
import { WorksInSection } from '../components/projects/WorksInSection'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { projectHubPath } from '../lib/messages-paths'
import { withNavReveal } from '../lib/nav-reveal'
import {
  deleteProject,
  getProject,
  listFolderFiles,
  nestFolder,
  type ProjectRow,
} from '../lib/projects-api'
import { useProjectDeleteConnectionImpact } from '../lib/use-project-delete-connection-impact'
import { filtersetPlainLabel } from '../lib/folder-filter-tree'
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
  const confirm = useConfirm()

  const [project, setProject] = useState<ProjectRow | null>(null)
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
      try {
        setFiles(await listFolderFiles(projectId))
      } catch {
        setFiles([])
      }
      setRefreshCount((count) => count + 1)
    } catch (err) {
      setError(formatApiErrorMessage(err, t('projects.detail.loadError')))
    } finally {
      setLoading(false)
    }
  }, [projectId, t])

  useEffect(() => {
    void load()
  }, [load])

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
  const crumbLabel = project
    ? project.name.replace(/^#/, '').trim() ||
      filtersetPlainLabel(project.tag_names ?? []) ||
      'Folder'
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
          const label =
            (ancestor.name ?? '').replace(/^#/, '').trim() ||
            filtersetPlainLabel(ancestor.tag_names ?? []) ||
            'Folder'
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
        <FolderHomeSkeleton />
      ) : error || !project ? (
        <ApiErrorBanner message={error ?? t('projects.detail.notFound')} onRetry={() => void load()} />
      ) : (
        <>
          <header className="panel flex flex-wrap items-start gap-4 p-4">
            <div className="min-w-0 flex-1 space-y-2">
              <FiltersetHeading
                folderId={project.id}
                name={project.name}
                tagNames={project.tag_names ?? []}
                canEdit={isAdmin}
                onChanged={() => load({ silent: true })}
                size="lg"
              />
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
              <OpenInGridButton kind="folder" id={project.id} />
              <Button type="button" size="sm" variant="outline" asChild>
                <Link to={hubHref}>
                  <MessageSquare size={14} className="mr-1" aria-hidden />
                  {t('projects.detail.openInCommunication')}
                </Link>
              </Button>
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
              <TabsTrigger value="tickets">{t('projects.detail.tabTickets')}</TabsTrigger>
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
              <WorksInSection projectId={project.id} canEdit={isAdmin} />

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

              <section className="space-y-2" aria-labelledby="project-flows" data-testid="project-folder-flows">
                <h2 id="project-flows" className="text-sm font-semibold text-text-heading">
                  {t('projects.detail.flows', { defaultValue: 'Flows' })}
                </h2>
                <ProjectFlowBoards
                  projectId={project.id}
                  canEdit={isAdmin}
                  onFlowsChanged={() => void load({ silent: true })}
                />
              </section>

              <ProjectHome project={project} canEdit={isAdmin} onChanged={() => load({ silent: true })} />

              <ProjectConversations
                projectId={project.id}
                preview
                refreshKey={refreshCount}
                onShowAll={() => setTab('conversations')}
              />
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
        <CreateFolderDialog
          open={folderOpen}
          onOpenChange={setFolderOpen}
          parentId={project.id}
          onCreated={(folderId) => {
            toast.success(t('projects.detail.folderCreated'))
            navigate(`/folders/${folderId}`)
          }}
        />
      ) : null}
      {project ? (
        <FileInFolderDialog
          open={moveOpen}
          onOpenChange={setMoveOpen}
          title={t('projects.detail.nestTitle', { defaultValue: 'Nest under another folder' })}
          description={t('projects.detail.nestBody', {
            defaultValue:
              'Places this folder under the one you choose. Labels stay the same — only the tree position changes.',
          })}
          confirmLabel={t('projects.detail.nestConfirm', { defaultValue: 'Nest' })}
          excludeSubtreeOf={project.id}
          onConfirm={async (ontoId) => {
            if (!ontoId) return
            const previousParent = project.parent_id ?? null
            await nestFolder(project.id, ontoId)
            const label = t('projects.detail.nested', {
              defaultValue: 'Folder nested',
            })
            const undoLabel = t('projects.detail.undoMove', { defaultValue: 'Undo' })
            const run = async () => {
              await nestFolder(project.id, previousParent)
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
