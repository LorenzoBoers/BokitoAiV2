import { Card } from '../components/ui/card'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Copy, FolderInput, MoreHorizontal, Trash2 } from 'lucide-react'
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
import { ConfirmDialog } from '../components/ui/confirm-dialog'
import { CreateFolderDialog } from '../components/folders/CreateFolderDialog'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { FolderHomeSkeleton } from '../components/ui/skeleton'
import { CanvasHost } from '../components/project-canvas/CanvasHost'
import { FolderContents } from '../components/projects/FolderContents'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { deleteProject, getProject, nestFolder, type CountedProject } from '../lib/projects-api'
import { useProjectDeleteConnectionImpact } from '../lib/use-project-delete-connection-impact'
import { notifyFoldersChanged } from '../lib/folders-bus'
import { FiltersetHeading } from '../components/folders/FiltersetHeading'

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
  const canvasId = searchParams.get('canvas')
  const isAdmin = useIsAdmin()

  const [project, setProject] = useState<CountedProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshCount, setRefreshCount] = useState(0)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [folderOpen, setFolderOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const widenedConnections = useProjectDeleteConnectionImpact(deleteOpen ? project?.id ?? null : null)

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!projectId) return
    if (!opts?.silent) setLoading(true)
    setError(null)
    try {
      const row = await getProject(projectId)
      setProject(row)
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

  const ancestors = project?.ancestors ?? []
  const crumbLabel = project ? project.display_name || t('projects.page.unnamed') : ''

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
          const label = ancestor.display_name || t('projects.page.unnamed')
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
          <Card asChild padding="default">
            <header className="flex flex-wrap items-start gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <FiltersetHeading
                  folderId={project.id}
                  name={project.name}
                  tagNames={project.tag_names ?? []}
                  canEdit={isAdmin}
                  onChanged={() => load({ silent: true })}
                  size="lg"
                />
                <p className="text-xs tabular-nums text-text-muted">
                  {t('projects.detail.folderCounts', {
                    open: project.open_count,
                    closed: project.closed_count,
                  })}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <OpenInGridButton kind="folder" id={project.id} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={t('projects.detail.moreActions')}
                      title={t('projects.detail.moreActions')}
                    >
                      <MoreHorizontal size={16} />
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
          </Card>
          {!isAdmin ? (
            <p className="rounded-lg border border-border bg-bg-input/40 px-3 py-2 text-xs text-text-muted">
              {t('projects.detail.readonlyBanner')}
            </p>
          ) : null}

          {canvasId ? (
            <div className="space-y-3">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  const next = new URLSearchParams(searchParams)
                  next.delete('canvas')
                  setSearchParams(next, { replace: true })
                }}
              >
                <ArrowLeft size={14} aria-hidden />
                {t('projects.contents.backToFolder')}
              </Button>
              <CanvasHost ownerId={project.id} ownerLabel={project.name} canEdit={isAdmin} />
            </div>
          ) : (
            <FolderContents
              projectId={project.id}
              canEdit={isAdmin}
              refreshKey={refreshCount}
              onCreateFolder={isAdmin ? () => setFolderOpen(true) : undefined}
            />
          )}
        </>
      )}

      {deleteOpen && project ? (
        <ConfirmDialog
          open
          destructive
          title={t('projects.detail.deleteTitle')}
          typeToConfirm={project.name}
          description={
            widenedConnections.length > 0
              ? `${t('projects.detail.deleteImpact')} ${t('projects.work.deleteWidensConnections', {
                  names: widenedConnections.join(', '),
                })}`
              : t('projects.detail.deleteImpact')
          }
          busy={deleting}
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
