import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { MoreHorizontal, Plus, Search, Trash2 } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { toast } from 'sonner'
import { toastMovedToBin } from '../lib/bin-toast'
import { ENTITY_ICONS } from '../lib/entity-icons'
import { filtersetLocalNames, filtersetPlainLabel } from '../lib/folder-filter-tree'
import { PageContent } from '../components/layout/PageContent'
import ContentHeader from '../components/shell/ContentHeader'
import { PageRelatedLinks } from '../components/layout/PageRelatedLinks'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { HashtagMark } from '../components/ui/HashtagMark'
import { TagSetPicker } from '../components/ui/TagSetPicker'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import ConfirmDeleteDialog from '../components/ui/ConfirmDeleteDialog'
import { EmptyState } from '../components/ui/empty-state'
import { SearchField } from '../components/ui/search-field'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { useWorkspace } from '../context/WorkspaceContext'
import { projectHubPath } from '../lib/messages-paths'
import { withNavReveal } from '../lib/nav-reveal'
import { notifyFoldersChanged } from '../lib/folders-bus'
import { createProject, deleteProject, listProjects, type ProjectRow } from '../lib/projects-api'
import { useProjectDeleteConnectionImpact } from '../lib/use-project-delete-connection-impact'
import { workspaceBrandName } from '../lib/tenant-branding'

const FolderKanban = ENTITY_ICONS.project
const MessageSquare = ENTITY_ICONS.conversation

function stopCard(event: { stopPropagation: () => void }) {
  event.stopPropagation()
}

function displayName(project: ProjectRow): string {
  if (project.tag_names?.length) {
    const parentNames = project.ancestors?.length
      ? project.ancestors[project.ancestors.length - 1]?.tag_names
      : null
    return filtersetPlainLabel(filtersetLocalNames(project.tag_names, parentNames))
  }
  return project.name.replace(/^#/, '')
}

function ProjectCard({
  project,
  onDelete,
  canManage,
}: {
  project: ProjectRow
  onDelete: () => void
  canManage: boolean
}) {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const threadsHref = withNavReveal(projectHubPath(project.id, 'open'))
  const openCount = project.open_count ?? 0
  const title = displayName(project)

  return (
    <Card
      role="link"
      tabIndex={0}
      aria-label={t('projects.page.openProject', {
        defaultValue: 'Open folder {{name}}',
        name: title,
      })}
      onClick={() => navigate(`/folders/${project.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          navigate(`/folders/${project.id}`)
        }
      }}
      interactive
      className="group flex flex-col gap-3 p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {project.ancestors && project.ancestors.length > 0 ? (
            <p className="truncate text-2xs text-text-muted" data-testid="project-card-ancestors">
              {project.ancestors.map((ancestor, index) => (
                <span key={ancestor.id}>
                  {index > 0 ? ' / ' : null}
                  <Link
                    to={`/folders/${ancestor.id}`}
                    className="hover:text-accent hover:underline"
                    onClick={stopCard}
                    onKeyDown={stopCard}
                  >
                    {ancestor.name.replace(/^#/, '')}
                  </Link>
                </span>
              ))}
            </p>
          ) : null}
          <p className="flex min-w-0 items-center gap-1.5 truncate-fade font-medium text-text-heading group-hover:text-accent">
            <HashtagMark className="shrink-0 text-sm" />
            <span className="min-w-0 truncate">{title}</span>
          </p>
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={t('projects.page.actionsFor', { name: title })}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal size={15} />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-50 min-w-[180px] rounded-lg border border-border/60 bg-bg-surface p-1 shadow-overlay"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-text-secondary outline-none data-[highlighted]:bg-bg-hover"
                onSelect={() => navigate(threadsHref)}
              >
                <MessageSquare size={14} />
                {t('projects.page.openInCommunication')}
              </DropdownMenu.Item>
              {canManage ? (
                <>
                  <DropdownMenu.Separator className="my-1 h-px bg-border/60" />
                  <DropdownMenu.Item
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-status-error outline-none data-[highlighted]:bg-bg-hover"
                    onSelect={onDelete}
                  >
                    <Trash2 size={14} />
                    {t('projects.page.delete')}
                  </DropdownMenu.Item>
                </>
              ) : null}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <div className="mt-auto space-y-2 border-t border-border/50 pt-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
          <span className="tabular-nums">
            {t('projects.detail.folderCounts', {
              open: openCount,
              closed: project.closed_count ?? 0,
            })}
          </span>
          {(project.open_tickets_count ?? 0) > 0 ? (
            <Badge variant="info" className="px-1.5 py-0 text-2xs">
              {t('projects.page.openTickets', { count: project.open_tickets_count })}
            </Badge>
          ) : null}
        </div>
        <Link
          to={threadsHref}
          onClick={(event) => event.stopPropagation()}
          className="text-xs text-text-muted hover:text-text-primary hover:underline"
        >
          {t('projects.page.openInCommunication')}
        </Link>
      </div>
    </Card>
  )
}

export default function ProjectsPage() {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const { currentWorkspace } = useWorkspace()
  const [searchParams, setSearchParams] = useSearchParams()
  const isAdmin = useIsAdmin()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(() => searchParams.get('new') === '1')
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')

  const [deleteTarget, setDeleteTarget] = useState<ProjectRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const widenedConnections = useProjectDeleteConnectionImpact(deleteTarget?.id ?? null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setProjects(await listProjects())
    } catch (err) {
      setError(formatApiErrorMessage(err, t('projects.page.loadError')))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const fromUrl = searchParams.get('q') ?? ''
    setQuery((current) => (current === fromUrl ? current : fromUrl))
  }, [searchParams])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchParams((prev) => {
        const current = prev.get('q') ?? ''
        const nextValue = query.trim()
        if (current === nextValue) return prev
        const next = new URLSearchParams(prev)
        if (nextValue) next.set('q', nextValue)
        else next.delete('q')
        return next
      }, { replace: true })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query, setSearchParams])

  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    if (!isAdmin) return
    setCreateOpen(true)
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
  }, [isAdmin, searchParams, setSearchParams])

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteProject(deleteTarget.id, deleteTarget.name)
      notifyFoldersChanged({ folderId: deleteTarget.id })
      toastMovedToBin(t('projects.page.deleted'), navigate)
      setDeleteTarget(null)
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.page.deleteError')))
    } finally {
      setDeleting(false)
    }
  }

  const visibleProjects = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const roots = projects.filter((project) => !project.parent_id)
    if (!needle) return roots
    return projects.filter((project) => {
      const hay = [project.name, ...(project.tag_names ?? []), project.description]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(needle)
    })
  }, [projects, query])

  return (
    <PageContent width="xl" className="space-y-4 py-1">
      <ContentHeader
        title={t('projects.page.tenantTitle', { name: workspaceBrandName(currentWorkspace) })}
        subtitle={t('projects.page.subtitle')}
        className="mb-0"
        meta={
          isAdmin ? (
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('projects.page.new')}
            </Button>
          ) : null
        }
      />

      {error ? <ApiErrorBanner message={error} onRetry={() => void load()} /> : null}
      {!isAdmin ? (
        <p className="rounded-lg border border-border/60 bg-bg-input/40 px-3 py-2 text-xs text-text-muted">
          {t('projects.page.readonlyBanner')}
        </p>
      ) : null}
      {projects.length > 0 ? (
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={t('projects.page.searchPlaceholder')}
          aria-label={t('projects.page.searchPlaceholder')}
          className="max-w-sm"
        />
      ) : null}

      {loading ? (
        <CardGridSkeleton />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={t('projects.page.emptyTitle')}
          description={t('projects.page.emptyBody')}
          action={
            isAdmin ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1 h-4 w-4" aria-hidden />
                {t('projects.page.new')}
              </Button>
            ) : undefined
          }
          footer={
            <Link to="/docs/ai/folders" className="text-xs font-medium text-accent hover:underline">
              {t('pageGuides.learnMore')}
            </Link>
          }
        />
      ) : visibleProjects.length === 0 ? (
        <EmptyState
          icon={Search}
          title={t('projects.page.emptyFiltered')}
          description={t('projects.page.emptyFilteredHint')}
          action={
            <Button size="sm" variant="outline" onClick={() => setQuery('')}>
              {t('projects.page.clearSearch')}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleProjects.map((project, index) => (
            <div
              key={project.id}
              className="stagger-in"
              style={{ '--stagger': Math.min(index, 11) } as CSSProperties}
            >
              <ProjectCard project={project} canManage={isAdmin} onDelete={() => setDeleteTarget(project)} />
            </div>
          ))}
        </div>
      )}

      <TagSetPicker
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="folder"
        title={t('projects.page.dialogTitle')}
        description={t('projects.page.dialogBody')}
        confirmLabel={t('projects.page.create')}
        showParentPreview
        onConfirm={async (tagNames) => {
          const created = await createProject({ tags: tagNames })
          notifyFoldersChanged({ folderId: created.id })
          toast.success(t('projects.page.created'))
          navigate(`/folders/${created.id}`)
        }}
      />

      {deleteTarget ? (
        <ConfirmDeleteDialog
          title={t('projects.page.deleteTitle')}
          itemLabel={t('projects.page.deleteItem')}
          itemName={displayName(deleteTarget)}
          impactText={
            widenedConnections.length > 0
              ? `${t('projects.page.deleteImpact')} ${t('projects.work.deleteWidensConnections', {
                  names: widenedConnections.join(', '),
                })}`
              : t('projects.page.deleteImpact')
          }
          isDeleting={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      ) : null}

      <PageRelatedLinks
        links={[
          { to: '/workstreams', label: t('pageGuides.related.workstreams', { defaultValue: 'Flows' }) },
          { to: '/settings/action-tags', label: t('pageGuides.related.categories', { defaultValue: 'Action tags' }) },
          {
            to: '/communication/inbox/open',
            label: t('pageGuides.related.communication', { defaultValue: 'Communication' }),
          },
        ]}
      />
    </PageContent>
  )
}
